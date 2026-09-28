package api

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/evalprecompute"
)

// refreshResultJSON is one repertoire's outcome from a batch run. On success
// (a "refreshed" entry) Chapters carries the same per-chapter breakdown
// GET /api/repertoires/{id} already exposes (id, name, card count, line
// count) — useful for a cron log to show which chapters exist post-refresh,
// e.g. confirming a newly-added chapter actually landed, not just an overall
// count. Skipped/failed entries have no chapters; Reason explains why instead.
type refreshResultJSON struct {
	ID       string                         `json:"id"`
	Name     string                         `json:"name"`
	Chapters []RepertoireChapterSummaryJSON `json:"chapters,omitempty"`
	Lines    int                            `json:"lines,omitempty"`
	Reason   string                         `json:"reason,omitempty"`
}

type RefreshAllRepertoiresResponse struct {
	Refreshed  []refreshResultJSON `json:"refreshed"`
	Skipped    []refreshResultJSON `json:"skipped"`
	Failed     []refreshResultJSON `json:"failed"`
	DurationMS int64               `json:"durationMs"`
}

// pauseBetweenRefreshes is a courtesy delay between successive Lichess study
// exports, same spirit as line_importance.go's explorer-call throttle — this
// endpoint can walk every managed repertoire in one run, and Lichess is a
// shared public API, not infrastructure this app owns.
const pauseBetweenRefreshes = 500 * time.Millisecond

// RefreshAllRepertoires re-downloads and rebuilds every repertoire that has a
// saved Lichess study source (DB-managed or file-based-with-config), in one
// pass — the batch counterpart to the single-repertoire RefreshRepertoire,
// meant to be hit once a day by an external cron job/scheduler rather than a
// signed-in user, so it does not sit behind the user JWT middleware. Guarded
// instead by a shared secret (CRON_SECRET) compared in constant time; if that
// secret isn't configured the endpoint refuses outright rather than running
// open, same "refuse to run insecurely" stance as AUTH_USERNAME/PASSWORD.
func (h *Handler) RefreshAllRepertoires(w http.ResponseWriter, r *http.Request) {
	// Checked before anything else, including whether a database is
	// configured — an unauthenticated caller shouldn't be able to learn
	// this backend's configuration state from the response.
	secret := os.Getenv("CRON_SECRET")
	if secret == "" {
		http.Error(w, "cron refresh is not configured (CRON_SECRET unset)", http.StatusServiceUnavailable)
		return
	}
	given := r.Header.Get("X-Cron-Secret")
	if subtle.ConstantTimeCompare([]byte(given), []byte(secret)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.db == nil {
		http.Error(w, "repertoire management requires database sync", http.StatusServiceUnavailable)
		return
	}

	// Generous ceiling for a batch that may walk a dozen-plus studies, each
	// its own network fetch + parse; still bounded so a hung Lichess request
	// can't wedge the endpoint forever.
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Minute)
	defer cancel()
	r = r.WithContext(ctx)

	started := time.Now()
	resp := RefreshAllRepertoiresResponse{
		Refreshed: []refreshResultJSON{},
		Skipped:   []refreshResultJSON{},
		Failed:    []refreshResultJSON{},
	}

	all := h.repertoires.List()
	log.Printf("cron: refreshing %d repertoire(s)", len(all))
	for i, rep := range all {
		if i > 0 {
			select {
			case <-ctx.Done():
			case <-time.After(pauseBetweenRefreshes):
			}
		}

		cfg, ok, err := h.managedConfig(r, rep.ID)
		if err != nil {
			log.Printf("cron: %s — could not resolve config: %v", rep.ID, err)
			resp.Failed = append(resp.Failed, refreshResultJSON{ID: rep.ID, Name: rep.Name, Reason: err.Error()})
			continue
		}
		if !ok {
			resp.Skipped = append(resp.Skipped, refreshResultJSON{ID: rep.ID, Name: rep.Name, Reason: "no Lichess study source"})
			continue
		}

		updated, err := h.fetchAndSaveRepertoire(r, cfg)
		if err != nil {
			log.Printf("cron: %s — refresh failed: %v", rep.ID, err)
			resp.Failed = append(resp.Failed, refreshResultJSON{ID: rep.ID, Name: rep.Name, Reason: err.Error()})
			continue
		}
		summary := toRepertoireSummary(updated)
		log.Printf("cron: %s — refreshed (%d chapters, %d lines)", rep.ID, len(summary.Chapters), summary.LineCount)
		resp.Refreshed = append(resp.Refreshed, refreshResultJSON{ID: updated.ID, Name: updated.Name, Chapters: summary.Chapters, Lines: summary.LineCount})
	}

	resp.DurationMS = time.Since(started).Milliseconds()
	log.Printf("cron: done in %dms — %d refreshed, %d skipped, %d failed", resp.DurationMS, len(resp.Refreshed), len(resp.Skipped), len(resp.Failed))
	respondJSON(w, http.StatusOK, resp)
}

// precomputeBudget bounds one background precompute run. The HTTP request
// that starts it returns immediately (202), so this is no longer tied to any
// request/scheduler timeout — it just caps how long a single run can hold the
// (dedicated) Stockfish instance before the next hourly tick takes over.
// Render's free tier only spins an instance down after ~15 minutes with no
// inbound traffic, and the tick that starts a run is itself inbound traffic,
// so a run this long can't be cut short by an idle spin-down.
const precomputeBudget = 5 * time.Minute

// maxConsecutiveComputeFailures ends a run early when this many positions in
// a row fail to compute — see the check in runPrecompute.
const maxConsecutiveComputeFailures = 5

type precomputeFailureJSON struct {
	FENKey string `json:"fenKey"`
	Reason string `json:"reason"`
}

type PrecomputeEvalsResponse struct {
	Processed  int                     `json:"processed"`
	Remaining  int                     `json:"remaining"`
	Failed     []precomputeFailureJSON `json:"failed,omitempty"`
	DurationMS int64                   `json:"durationMs"`
}

// precomputeStartedResponse is what the cron endpoint answers with: the work
// itself happens after the response, so this only says whether a run was
// started, plus the summary of the most recent *finished* run (nil until one
// has finished since this process booted) — the only way a scheduler's logs
// can see backlog progress now that the request no longer waits for it.
type precomputeStartedResponse struct {
	Status  string                   `json:"status"` // "started" | "already-running"
	LastRun *PrecomputeEvalsResponse `json:"lastRun,omitempty"`
}

// PrecomputeEvals kicks off a background fill of the internal/evalprecompute
// eval cache — positions that appear in some currently-loaded repertoire but
// have no position_evals row yet (freshly added by the daily
// refresh-repertoires run, or never backfilled) — and returns 202 straight
// away. Same CRON_SECRET-guarded, outside-the-JWT-group shape as
// RefreshAllRepertoires above; meant to be hit repeatedly (every 15–60 min)
// by the same external scheduler.
//
// Responding first matters because the scheduler hard-times-out at ~40s
// (and a cold Render instance can burn part of that just waking up), while a
// deep MultiPV-5 run takes minutes. Safe to call repeatedly: only one run
// executes at a time (an overlapping call gets "already-running" and does
// nothing), every finished position is saved individually, and each run
// recomputes its backlog from the table, so a run cut short by a deploy or
// crash just resumes from wherever the last one stopped.
func (h *Handler) PrecomputeEvals(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("CRON_SECRET")
	if secret == "" {
		http.Error(w, "cron precompute is not configured (CRON_SECRET unset)", http.StatusServiceUnavailable)
		return
	}
	given := r.Header.Get("X-Cron-Secret")
	if subtle.ConstantTimeCompare([]byte(given), []byte(secret)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.db == nil {
		http.Error(w, "eval precompute requires database sync", http.StatusServiceUnavailable)
		return
	}

	h.precomputeMu.Lock()
	last := h.lastPrecompute
	h.precomputeMu.Unlock()

	if !h.precomputeRunning.CompareAndSwap(false, true) {
		respondJSON(w, http.StatusAccepted, precomputeStartedResponse{Status: "already-running", LastRun: last})
		return
	}
	go func() {
		defer h.precomputeRunning.Store(false)
		// Deliberately not derived from r.Context(), which is cancelled the
		// moment the 202 below is written.
		ctx, cancel := context.WithTimeout(context.Background(), precomputeBudget+time.Minute)
		defer cancel()
		res := h.runPrecompute(ctx)
		h.precomputeMu.Lock()
		h.lastPrecompute = &res
		h.precomputeMu.Unlock()
	}()
	respondJSON(w, http.StatusAccepted, precomputeStartedResponse{Status: "started", LastRun: last})
}

// runPrecompute is one bounded batch: diff every repertoire position against
// the cache, then compute until the backlog is empty or precomputeBudget runs
// out. Called only from PrecomputeEvals' single-flight goroutine.
//
// Every run is also recorded in precompute_runs (one row) and
// precompute_run_positions (one row per position attempted) for observability.
// That bookkeeping is best-effort — a failed write is logged and never stops
// or fails the actual precompute work.
func (h *Handler) runPrecompute(ctx context.Context) PrecomputeEvalsResponse {
	started := time.Now()
	resp := PrecomputeEvalsResponse{}

	runID, err := h.db.StartPrecomputeRun(ctx, precomputeBudget.Milliseconds(), h.precomputeEngine != nil)
	if err != nil {
		log.Printf("cron precompute: could not record run start (continuing unrecorded): %v", err)
		runID = 0
	}
	var stats db.PrecomputeRunStats
	finish := func(status, runErr string) {
		resp.DurationMS = time.Since(started).Milliseconds()
		if runID == 0 {
			return
		}
		// Fresh context: ctx may be the very thing that expired.
		fctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := h.db.FinishPrecomputeRun(fctx, runID, status, stats, runErr); err != nil {
			log.Printf("cron precompute: could not record run finish: %v", err)
		}
	}

	all := evalprecompute.EnumeratePositions(h.repertoires.List())
	existing, err := h.db.AllPositionEvalKeys(ctx)
	if err != nil {
		log.Printf("cron precompute: failed to load existing evals: %v", err)
		stats.TotalPositions = len(all)
		finish(db.PrecomputeRunFailed, "failed to load existing evals: "+err.Error())
		return resp
	}

	var backlog []string
	for _, key := range all {
		if !existing[key] {
			backlog = append(backlog, key)
		}
	}
	log.Printf("cron precompute: %d total position(s), %d in backlog", len(all), len(backlog))
	stats.TotalPositions, stats.BacklogSize, stats.Remaining = len(all), len(backlog), len(backlog)
	if runID != 0 {
		if err := h.db.UpdatePrecomputeRunProgress(ctx, runID, stats); err != nil {
			log.Printf("cron precompute: %v", err)
		}
	}

	logPosition := func(l db.PrecomputePositionLog) {
		if runID == 0 {
			return
		}
		l.RunID = runID
		// Not tied to ctx's remaining time, so the last position still gets logged.
		pctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := h.db.InsertPrecomputePositionLog(pctx, l); err != nil {
			log.Printf("cron precompute: %v", err)
		}
		stats.Remaining = stats.BacklogSize - stats.Attempted
		if err := h.db.UpdatePrecomputeRunProgress(pctx, runID, stats); err != nil {
			log.Printf("cron precompute: %v", err)
		}
	}

	deadline := started.Add(precomputeBudget)
	consecutiveFailures := 0
	abortErr := ""
	for _, key := range backlog {
		if time.Now().After(deadline) || ctx.Err() != nil {
			break
		}
		stats.Attempted++
		posStart := time.Now()
		result, err := evalprecompute.ComputeWithMoveTime(h.precomputeEngine, key, evalprecompute.CronStockfishMoveTime)
		if err != nil {
			// Not retried within this run — a position that keeps failing
			// (e.g. no cloud hit and Stockfish unavailable) would otherwise
			// eat the whole budget every tick without making progress. It
			// stays in the backlog and gets tried again next tick, same
			// "log and move on" stance as RefreshAllRepertoires above.
			log.Printf("cron precompute: %s — %v", key, err)
			resp.Failed = append(resp.Failed, precomputeFailureJSON{FENKey: key, Reason: err.Error()})
			stats.Failed++
			logPosition(db.PrecomputePositionLog{FENKey: key, Status: "compute_failed", DurationMS: time.Since(posStart).Milliseconds(), Error: err.Error()})
			// A broken engine (or an unreachable Lichess) fails every
			// remaining position too; stop instead of grinding the whole
			// budget away on it. The next tick retries from scratch.
			consecutiveFailures++
			if consecutiveFailures >= maxConsecutiveComputeFailures {
				abortErr = fmt.Sprintf("aborted after %d consecutive compute failures, last: %v", consecutiveFailures, err)
				log.Printf("cron precompute: %s", abortErr)
				break
			}
			continue
		}
		if err := h.db.UpsertPositionEval(ctx, result); err != nil {
			log.Printf("cron precompute: %s — save failed: %v", key, err)
			resp.Failed = append(resp.Failed, precomputeFailureJSON{FENKey: key, Reason: err.Error()})
			stats.Failed++
			logPosition(db.PrecomputePositionLog{FENKey: key, Status: "save_failed", EngineName: result.EngineName, DurationMS: time.Since(posStart).Milliseconds(), Error: err.Error()})
			continue
		}
		consecutiveFailures = 0
		resp.Processed++
		stats.Processed++
		logPosition(db.PrecomputePositionLog{FENKey: key, Status: "ok", EngineName: result.EngineName, Depth: result.Depth, DurationMS: time.Since(posStart).Milliseconds()})
	}
	stats.Remaining = stats.BacklogSize - stats.Attempted
	resp.Remaining = stats.Remaining
	status := db.PrecomputeRunCompleted
	if abortErr != "" {
		status = db.PrecomputeRunFailed
	} else if stats.Remaining > 0 {
		status = db.PrecomputeRunBudgetExhausted
	}
	finish(status, abortErr)
	log.Printf("cron precompute: done in %dms — %d processed, %d remaining, %d failed", resp.DurationMS, resp.Processed, resp.Remaining, len(resp.Failed))
	return resp
}

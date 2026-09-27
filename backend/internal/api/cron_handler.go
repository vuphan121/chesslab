package api

import (
	"context"
	"crypto/subtle"
	"log"
	"net/http"
	"os"
	"time"

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

// precomputeBudget bounds one PrecomputeEvals call well under both Render's
// 3-minute HTTP WriteTimeout and a typical external scheduler's own function
// timeout (e.g. Vercel's) — the endpoint is meant to be hit every 15–60 min
// and just grind through whatever backlog exists, resuming from wherever it
// left off on the next tick rather than ever risking a mid-request timeout.
const precomputeBudget = 90 * time.Second

type precomputeFailureJSON struct {
	FENKey string `json:"fenKey"`
	Reason string `json:"reason"`
}

type PrecomputeEvalsResponse struct {
	Processed  int                      `json:"processed"`
	Remaining  int                      `json:"remaining"`
	Failed     []precomputeFailureJSON `json:"failed,omitempty"`
	DurationMS int64                    `json:"durationMs"`
}

// PrecomputeEvals fills in the backlog of the internal/evalprecompute eval
// cache — positions that appear in some currently-loaded repertoire but
// have no position_evals row yet (freshly added by the daily
// refresh-repertoires run, or never backfilled). Same CRON_SECRET-guarded,
// outside-the-JWT-group shape as RefreshAllRepertoires above; meant to be
// hit repeatedly (every 15–60 min) by the same external scheduler rather
// than once a day, since a single call only has a bounded time budget (see
// precomputeBudget) to spend on what can be a large backlog right after a
// repertoire refresh. A call that finds nothing new is a cheap no-op.
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

	started := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	all := evalprecompute.EnumeratePositions(h.repertoires.List())
	existing, err := h.db.AllPositionEvalKeys(ctx)
	if err != nil {
		http.Error(w, "failed to load existing evals: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var backlog []string
	for _, key := range all {
		if !existing[key] {
			backlog = append(backlog, key)
		}
	}
	log.Printf("cron precompute: %d total position(s), %d in backlog", len(all), len(backlog))

	resp := PrecomputeEvalsResponse{}
	deadline := started.Add(precomputeBudget)
	attempted := 0
	for _, key := range backlog {
		if time.Now().After(deadline) {
			break
		}
		attempted++
		result, err := evalprecompute.Compute(h.precomputeEngine, key)
		if err != nil {
			// Not retried within this call — a position that keeps failing
			// (e.g. no cloud hit and Stockfish unavailable) would otherwise
			// eat the whole budget every tick without making progress. It
			// stays in the backlog and gets tried again next tick, same
			// "log and move on" stance as RefreshAllRepertoires above.
			log.Printf("cron precompute: %s — %v", key, err)
			resp.Failed = append(resp.Failed, precomputeFailureJSON{FENKey: key, Reason: err.Error()})
			continue
		}
		if err := h.db.UpsertPositionEval(ctx, result); err != nil {
			log.Printf("cron precompute: %s — save failed: %v", key, err)
			resp.Failed = append(resp.Failed, precomputeFailureJSON{FENKey: key, Reason: err.Error()})
			continue
		}
		resp.Processed++
	}
	resp.Remaining = len(backlog) - attempted
	resp.DurationMS = time.Since(started).Milliseconds()
	log.Printf("cron precompute: done in %dms — %d processed, %d remaining, %d failed", resp.DurationMS, resp.Processed, resp.Remaining, len(resp.Failed))
	respondJSON(w, http.StatusOK, resp)
}

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

const pauseBetweenRefreshes = 500 * time.Millisecond

func (h *Handler) RefreshAllRepertoires(w http.ResponseWriter, r *http.Request) {
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

const precomputeBudget = 45 * time.Minute

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

type precomputeStartedResponse struct {
	Status  string                   `json:"status"`
	LastRun *PrecomputeEvalsResponse `json:"lastRun,omitempty"`
}

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
		ctx, cancel := context.WithTimeout(context.Background(), precomputeBudget+evalprecompute.CronStockfishMoveTime+2*time.Minute)
		defer cancel()
		res := h.runPrecompute(ctx)
		h.precomputeMu.Lock()
		h.lastPrecompute = &res
		h.precomputeMu.Unlock()
	}()
	respondJSON(w, http.StatusAccepted, precomputeStartedResponse{Status: "started", LastRun: last})
}

func (h *Handler) runPrecompute(ctx context.Context) PrecomputeEvalsResponse {
	started := time.Now()
	resp := PrecomputeEvalsResponse{}

	runID, err := h.db.StartPrecomputeRun(ctx, precomputeBudget.Milliseconds(), h.precomputeAvailable())
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

	engineFor, releaseEngine := h.lazyPrecomputeEngine()
	defer releaseEngine()

	deadline := started.Add(precomputeBudget)
	consecutiveFailures := 0
	abortErr := ""
	for _, key := range backlog {
		if time.Now().After(deadline) || ctx.Err() != nil {
			break
		}
		stats.Attempted++
		posStart := time.Now()
		result, err := evalprecompute.ComputeWithProvider(engineFor, key, evalprecompute.CronStockfishMoveTime)
		if err != nil {
			log.Printf("cron precompute: %s — %v", key, err)
			resp.Failed = append(resp.Failed, precomputeFailureJSON{FENKey: key, Reason: err.Error()})
			stats.Failed++
			logPosition(db.PrecomputePositionLog{FENKey: key, Status: "compute_failed", DurationMS: time.Since(posStart).Milliseconds(), Error: err.Error()})
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

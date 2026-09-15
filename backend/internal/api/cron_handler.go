package api

import (
	"context"
	"crypto/subtle"
	"log"
	"net/http"
	"os"
	"time"
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

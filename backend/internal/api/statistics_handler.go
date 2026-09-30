package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/lichess"
)

const (
	puzzleBackfillWindow = 365 * 24 * time.Hour
	puzzleFetchMax       = 5000
	learnedBox           = 4
	leitnerBoxes         = 6
)

type statsCoverage struct {
	Learned   int `json:"learned"`
	Shaky     int `json:"shaky"`
	Untouched int `json:"untouched"`
}

type statsPuzzleSync struct {
	Configured      bool       `json:"configured"`
	LichessUsername string     `json:"lichessUsername,omitempty"`
	SyncedAt        *time.Time `json:"syncedAt,omitempty"`
}

type statsRating struct {
	Current *int                  `json:"current"`
	Delta   *int                  `json:"delta"`
	Points  []db.StatsRatingPoint `json:"points"`
}

type StatisticsResponse struct {
	Days       int             `json:"days"`
	EndDate    string          `json:"endDate"`
	Daily      []db.StatsDay   `json:"daily"`
	Totals     db.StatsTotals  `json:"totals"`
	Streak     int             `json:"streak"`
	BestStreak int             `json:"bestStreak"`
	Rating     statsRating     `json:"rating"`
	ThemeDays  int             `json:"themeDays"`
	Themes     []db.StatsTheme `json:"themes"`
	Weekly     []db.StatsWeek  `json:"weekly"`
	Boxes      []int           `json:"boxes"`
	Coverage   statsCoverage   `json:"coverage"`
	PuzzleSync statsPuzzleSync `json:"puzzleSync"`
}

func (h *Handler) GetStatistics(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "statistics require database sync", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	days := 30
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v >= 7 && v <= 365 {
		days = v
	}
	clock := currentRequestClock(r)
	ctx := r.Context()

	resp := StatisticsResponse{Days: days, EndDate: clock.date}
	var err error
	if resp.Daily, resp.Totals, err = h.db.StatsDaily(ctx, username, clock.timeZone, clock.date, days); err != nil {
		statsError(w, err)
		return
	}
	activity, err := h.db.ActivityDays(ctx, username, clock.timeZone, clock.date)
	if err != nil {
		statsError(w, err)
		return
	}
	resp.Streak, resp.BestStreak = streaks(activity, clock.date)

	resp.Rating.Points, err = h.db.StatsRating(ctx, username, clock.date, days)
	if err != nil {
		statsError(w, err)
		return
	}
	if current, err := h.db.LastRatingAtOrBefore(ctx, username, clock.date); err != nil {
		statsError(w, err)
		return
	} else if current != nil {
		resp.Rating.Current = current
		start := startDate(clock.date, days)
		if base, err := h.db.LastRatingAtOrBefore(ctx, username, start); err != nil {
			statsError(w, err)
			return
		} else if base != nil {
			delta := *current - *base
			resp.Rating.Delta = &delta
		} else if len(resp.Rating.Points) > 0 {
			delta := *current - resp.Rating.Points[0].Rating
			resp.Rating.Delta = &delta
		}
	}

	resp.ThemeDays = days
	if resp.ThemeDays < 30 {
		resp.ThemeDays = 30
	}
	if resp.Themes, err = h.db.StatsThemes(ctx, username, clock.timeZone, clock.date, resp.ThemeDays); err != nil {
		statsError(w, err)
		return
	}
	if resp.Weekly, err = h.db.StatsWeekly(ctx, username, clock.timeZone, clock.date, 8); err != nil {
		statsError(w, err)
		return
	}

	resp.Boxes = make([]int, leitnerBoxes)
	seen, err := h.db.SeenCardBoxes(ctx, username)
	if err != nil {
		statsError(w, err)
		return
	}
	for _, rep := range h.repertoires.List() {
		progress := seen[rep.ID]
		for _, card := range rep.Cards {
			box, ok := progress[card.ID]
			if !ok {
				resp.Coverage.Untouched++
				continue
			}
			if box < 0 {
				box = 0
			}
			if box >= leitnerBoxes {
				box = leitnerBoxes - 1
			}
			resp.Boxes[box]++
			if box >= learnedBox {
				resp.Coverage.Learned++
			} else {
				resp.Coverage.Shaky++
			}
		}
	}

	resp.PuzzleSync.Configured = puzzleSyncConfigured()
	if st, err := h.db.GetPuzzleSyncState(ctx, username); err == nil && st != nil {
		resp.PuzzleSync.LichessUsername = st.LichessUsername
		resp.PuzzleSync.SyncedAt = &st.SyncedAt
	}
	respondJSON(w, http.StatusOK, resp)
}

func statsError(w http.ResponseWriter, err error) {
	log.Printf("statistics: %v", err)
	http.Error(w, "failed to load statistics: "+err.Error(), http.StatusInternalServerError)
}

func startDate(endDate string, days int) string {
	end, err := time.Parse(time.DateOnly, endDate)
	if err != nil {
		return endDate
	}
	return end.AddDate(0, 0, -days).Format(time.DateOnly)
}

func streaks(activityDays []string, today string) (current, best int) {
	have := make(map[string]bool, len(activityDays))
	for _, d := range activityDays {
		have[d] = true
	}
	end, err := time.Parse(time.DateOnly, today)
	if err != nil {
		return 0, 0
	}
	run := 0
	for _, d := range activityDays {
		t, err := time.Parse(time.DateOnly, d)
		if err != nil {
			continue
		}
		if have[t.AddDate(0, 0, -1).Format(time.DateOnly)] {
			run++
		} else {
			run = 1
		}
		if run > best {
			best = run
		}
	}
	cursor := end
	if !have[cursor.Format(time.DateOnly)] {
		cursor = cursor.AddDate(0, 0, -1)
	}
	for have[cursor.Format(time.DateOnly)] {
		current++
		cursor = cursor.AddDate(0, 0, -1)
	}
	return current, best
}

func puzzleSyncConfigured() bool {
	return os.Getenv("LICHESS_PUZZLE_TOKEN") != "" && os.Getenv("LICHESS_USERNAME") != ""
}

type PuzzleSyncResponse struct {
	Added      int   `json:"added"`
	DurationMS int64 `json:"durationMs"`
}

var puzzleSyncMu sync.Mutex

var errPuzzleSyncNotConfigured = errors.New("puzzle sync is not configured (LICHESS_PUZZLE_TOKEN and LICHESS_USERNAME)")

func syncErrorStatus(err error) int {
	if errors.Is(err, errPuzzleSyncNotConfigured) {
		return http.StatusServiceUnavailable
	}
	return http.StatusBadGateway
}

func (h *Handler) syncPuzzles(ctx context.Context, username string) (int, error) {
	token := os.Getenv("LICHESS_PUZZLE_TOKEN")
	lichessUser := os.Getenv("LICHESS_USERNAME")
	if token == "" || lichessUser == "" {
		return 0, errPuzzleSyncNotConfigured
	}
	if !puzzleSyncMu.TryLock() {
		return 0, fmt.Errorf("puzzle sync already running")
	}
	defer puzzleSyncMu.Unlock()

	latest, err := h.db.LatestPuzzleAttempt(ctx, username)
	if err != nil {
		return 0, err
	}
	since := time.Now().Add(-puzzleBackfillWindow)
	if !latest.IsZero() {
		since = latest.Add(-time.Hour)
	}
	attempts, err := lichess.FetchPuzzleActivity(ctx, token, since, puzzleFetchMax)
	if err != nil {
		return 0, err
	}
	ratings, err := lichess.FetchPuzzleRatingHistory(ctx, lichessUser)
	if err != nil {
		log.Printf("puzzle sync: rating history skipped: %v", err)
		ratings = nil
	}
	if err := h.db.SavePuzzleSync(ctx, username, lichessUser, attempts, ratings); err != nil {
		return 0, err
	}
	return len(attempts), nil
}

func (h *Handler) SyncPuzzles(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "statistics require database sync", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	started := time.Now()
	added, err := h.syncPuzzles(r.Context(), username)
	if err != nil {
		log.Printf("puzzle sync: %v", err)
		http.Error(w, err.Error(), syncErrorStatus(err))
		return
	}
	respondJSON(w, http.StatusOK, PuzzleSyncResponse{Added: added, DurationMS: time.Since(started).Milliseconds()})
}

func (h *Handler) CronSyncPuzzles(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("CRON_SECRET")
	if secret == "" {
		http.Error(w, "cron puzzle sync is not configured (CRON_SECRET unset)", http.StatusServiceUnavailable)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Cron-Secret")), []byte(secret)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.db == nil {
		http.Error(w, "statistics require database sync", http.StatusServiceUnavailable)
		return
	}
	username := os.Getenv("AUTH_USERNAME")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	started := time.Now()
	added, err := h.syncPuzzles(ctx, username)
	if err != nil {
		log.Printf("cron puzzle sync: %v", err)
		http.Error(w, err.Error(), syncErrorStatus(err))
		return
	}
	log.Printf("cron puzzle sync: %d attempt(s) upserted in %dms", added, time.Since(started).Milliseconds())
	respondJSON(w, http.StatusOK, PuzzleSyncResponse{Added: added, DurationMS: time.Since(started).Milliseconds()})
}

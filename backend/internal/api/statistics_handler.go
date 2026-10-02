package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/lichess"
	"github.com/chesslab/backend/internal/repertoire"
)

const (
	puzzleBackfillWindow = 365 * 24 * time.Hour
	puzzleFetchMax       = 5000
)

type statsProgress struct {
	Learned      int `json:"learned"`
	GettingThere int `json:"gettingThere"`
	NeedsWork    int `json:"needsWork"`
	NotStarted   int `json:"notStarted"`
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
	StartDate  string          `json:"startDate"`
	EndDate    string          `json:"endDate"`
	Daily      []db.StatsDay   `json:"daily"`
	Totals     db.StatsTotals  `json:"totals"`
	Streak     int             `json:"streak"`
	BestStreak int             `json:"bestStreak"`
	Rating     statsRating     `json:"rating"`
	ThemeRatings []statsThemeRating `json:"themeRatings"`
	TroubleSpots []statsSpot        `json:"troubleSpots"`
	Progress   statsProgress   `json:"progress"`
	PuzzleSync statsPuzzleSync `json:"puzzleSync"`
}

type statsThemeRating struct {
	Theme    string `json:"theme"`
	Rating   int    `json:"rating"`
	Attempts int    `json:"attempts"`
	Recent   int    `json:"recent"`
	Wins     int    `json:"wins"`
}

type statsSpot struct {
	RepertoireID   string `json:"repertoireId"`
	RepertoireName string `json:"repertoireName"`
	ChapterID      string `json:"chapterId"`
	ChapterName    string `json:"chapterName"`
	Drills         int    `json:"drills"`
	Mistakes       int    `json:"mistakes"`
}

const (
	spotMinDrills = 3
	spotLimit     = 5

	maxRangeDays = 366
)

func statsRange(r *http.Request, today string) (from, to string, days int, err error) {
	q := r.URL.Query()
	fromParam, toParam := q.Get("from"), q.Get("to")
	if fromParam == "" && toParam == "" {
		days = 30
		if v, convErr := strconv.Atoi(q.Get("days")); convErr == nil && v >= 1 && v <= maxRangeDays {
			days = v
		}
		return startDate(today, days-1), today, days, nil
	}
	end, err := time.Parse(time.DateOnly, toParam)
	if err != nil {
		return "", "", 0, fmt.Errorf("invalid to date")
	}
	start, err := time.Parse(time.DateOnly, fromParam)
	if err != nil {
		return "", "", 0, fmt.Errorf("invalid from date")
	}
	if now, parseErr := time.Parse(time.DateOnly, today); parseErr == nil && end.After(now) {
		end = now
	}
	if start.After(end) {
		start = end
	}
	if end.Sub(start) > time.Duration(maxRangeDays-1)*24*time.Hour {
		start = end.AddDate(0, 0, -(maxRangeDays - 1))
	}
	days = int(end.Sub(start).Hours()/24) + 1
	return start.Format(time.DateOnly), end.Format(time.DateOnly), days, nil
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
	clock := currentRequestClock(r)
	from, to, days, err := statsRange(r, clock.date)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ctx := r.Context()

	resp := StatisticsResponse{Days: days, StartDate: from, EndDate: to}
	if resp.Daily, resp.Totals, err = h.db.StatsDaily(ctx, username, to, days); err != nil {
		statsError(w, err)
		return
	}
	activity, err := h.db.ActivityDays(ctx, username, clock.date)
	if err != nil {
		statsError(w, err)
		return
	}
	resp.Streak, resp.BestStreak = streaks(activity, clock.date)

	resp.Rating.Points, err = h.db.StatsRating(ctx, username, to, days)
	if err != nil {
		statsError(w, err)
		return
	}
	if current, err := h.db.LastRatingAtOrBefore(ctx, username, to); err != nil {
		statsError(w, err)
		return
	} else if current != nil {
		resp.Rating.Current = current
		if base, err := h.db.LastRatingAtOrBefore(ctx, username, startDate(from, 1)); err != nil {
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

	themeStats, err := h.db.ThemeRangeStats(ctx, username, from, to)
	if err != nil {
		statsError(w, err)
		return
	}
	resp.ThemeRatings = make([]statsThemeRating, 0, len(themeStats))
	for _, st := range themeStats {
		resp.ThemeRatings = append(resp.ThemeRatings, statsThemeRating{Theme: st.Theme, Rating: int(math.Round(st.Rating)), Attempts: st.Plays, Recent: st.Plays, Wins: st.Wins})
	}
	sort.Slice(resp.ThemeRatings, func(i, j int) bool {
		if resp.ThemeRatings[i].Rating != resp.ThemeRatings[j].Rating {
			return resp.ThemeRatings[i].Rating < resp.ThemeRatings[j].Rating
		}
		return resp.ThemeRatings[i].Theme < resp.ThemeRatings[j].Theme
	})

	spots, err := h.db.StatsTroubleSpots(ctx, username, to, days, spotMinDrills, spotLimit)
	if err != nil {
		statsError(w, err)
		return
	}
	resp.TroubleSpots = make([]statsSpot, 0, len(spots))
	for _, sp := range spots {
		name := sp.RepertoireID
		if rep, ok := h.repertoires.Get(sp.RepertoireID); ok {
			name = rep.Name
		}
		resp.TroubleSpots = append(resp.TroubleSpots, statsSpot{
			RepertoireID: sp.RepertoireID, RepertoireName: name, ChapterID: sp.ChapterID, ChapterName: sp.ChapterName,
			Drills: sp.Drills, Mistakes: sp.Mistakes,
		})
	}

	lineHistories, err := h.db.LineHistories(ctx, username)
	if err != nil {
		statsError(w, err)
		return
	}
	for _, rep := range h.repertoires.List() {
		for _, line := range repertoire.Lines(rep) {
			switch stageOf(lineHistories[rep.ID][line.ID]) {
			case stageLearned:
				resp.Progress.Learned++
			case stageGettingThere:
				resp.Progress.GettingThere++
			case stageNeedsWork:
				resp.Progress.NeedsWork++
			default:
				resp.Progress.NotStarted++
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

type lineStage int

const (
	stageNotStarted lineStage = iota
	stageNeedsWork
	stageGettingThere
	stageLearned
)

func stageOf(h db.CardHistory) lineStage {
	switch {
	case h.N == 0:
		return stageNotStarted
	case h.N >= db.RecentWindow && h.Bits == 1<<db.RecentWindow-1:
		return stageLearned
	case h.Bits != 0:
		return stageGettingThere
	default:
		return stageNeedsWork
	}
}

func statsTimeZone() string {
	if tz := os.Getenv("STATS_TIME_ZONE"); tz != "" {
		if _, err := time.LoadLocation(tz); err == nil {
			return tz
		}
	}
	return "Asia/Ho_Chi_Minh"
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

	since := time.Now().Add(-puzzleBackfillWindow)
	if state, err := h.db.GetPuzzleSyncState(ctx, username); err != nil {
		return 0, err
	} else if state != nil {
		since = state.SyncedAt.Add(-time.Hour)
	} else if latest, err := h.db.LatestPuzzleAttempt(ctx, username); err != nil {
		return 0, err
	} else if !latest.IsZero() {
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
	if err := h.db.SavePuzzleSync(ctx, username, lichessUser, statsTimeZone(), attempts, ratings); err != nil {
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

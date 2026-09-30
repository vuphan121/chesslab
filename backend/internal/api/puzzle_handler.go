package api

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"net/http"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/puzzle"
	"github.com/chesslab/backend/internal/puzzledb"
)

type puzzleThemeJSON struct {
	Key       string  `json:"key"`
	Category  string  `json:"category"`
	Rating    int     `json:"rating"`
	Attempts  int     `json:"attempts"`
	Wins      int     `json:"wins"`
	Available int     `json:"available"`
	Played    bool    `json:"played"`
	exact     float64 `json:"-"`
}

type puzzleThemesResponse struct {
	StartRating int               `json:"startRating"`
	Themes      []puzzleThemeJSON `json:"themes"`
}

type puzzleNextRequest struct {
	Theme      string   `json:"theme"`
	AvoidTheme string   `json:"avoidTheme"`
	Count      int      `json:"count"`
	Exclude    []string `json:"exclude"`
}

type puzzleNextBatch struct {
	Puzzles []puzzleNextResponse `json:"puzzles"`
}

const (
	maxPuzzleBatch   = 10
	maxPuzzleExclude = 100
)

type puzzleNextResponse struct {
	puzzle.Puzzle
	Theme       string `json:"theme"`
	ThemeRating int    `json:"themeRating"`
	Mixed       bool   `json:"mixed"`
}

type puzzleResultRequest struct {
	OperationID string `json:"operationId"`
	PuzzleID    string `json:"puzzleId"`
	Theme       string `json:"theme"`
	Solved      bool   `json:"solved"`
}

type puzzleResultResponse struct {
	Theme        string `json:"theme"`
	RatingBefore int    `json:"ratingBefore"`
	RatingAfter  int    `json:"ratingAfter"`
	Delta        int    `json:"delta"`
	Attempts     int    `json:"attempts"`
	Wins         int    `json:"wins"`
	PuzzleRating int    `json:"puzzleRating"`
}

func (h *Handler) puzzleUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	if h.db == nil {
		http.Error(w, "puzzles require database sync", http.StatusServiceUnavailable)
		return "", false
	}
	if h.puzzles == nil {
		http.Error(w, puzzledb.ErrNotConfigured.Error(), http.StatusServiceUnavailable)
		return "", false
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return "", false
	}
	return username, true
}

func (h *Handler) loadThemes(r *http.Request, username string) ([]puzzleThemeJSON, error) {
	counts, err := h.puzzles.ThemeCounts(r.Context())
	if err != nil {
		return nil, err
	}
	stats, err := h.db.PuzzleThemeStats(r.Context(), username)
	if err != nil {
		return nil, err
	}
	out := make([]puzzleThemeJSON, 0, len(counts))
	for _, key := range puzzle.ThemeKeys() {
		if counts[key] == 0 {
			continue
		}
		st, played := stats[key]
		if !played {
			st.Rating = puzzle.StartRating
		}
		out = append(out, puzzleThemeJSON{
			Key: key, Category: puzzle.CategoryOf(key), Rating: int(math.Round(st.Rating)), Attempts: st.Attempts, Wins: st.Wins,
			Available: counts[key], Played: played, exact: st.Rating,
		})
	}
	return out, nil
}

func (h *Handler) GetPuzzleThemes(w http.ResponseWriter, r *http.Request) {
	username, ok := h.puzzleUser(w, r)
	if !ok {
		return
	}
	themes, err := h.loadThemes(r, username)
	if err != nil {
		http.Error(w, "failed to load puzzle themes: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, puzzleThemesResponse{StartRating: int(puzzle.StartRating), Themes: themes})
}

func (h *Handler) NextPuzzle(w http.ResponseWriter, r *http.Request) {
	username, ok := h.puzzleUser(w, r)
	if !ok {
		return
	}
	var req puzzleNextRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	themes, err := h.loadThemes(r, username)
	if err != nil {
		http.Error(w, "failed to load puzzle themes: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if len(themes) == 0 {
		http.Error(w, "no puzzles imported yet (run cmd/importpuzzles)", http.StatusServiceUnavailable)
		return
	}

	count := req.Count
	if count < 1 {
		count = 1
	}
	if count > maxPuzzleBatch {
		count = maxPuzzleBatch
	}
	exclude := req.Exclude
	if len(exclude) > maxPuzzleExclude {
		exclude = exclude[len(exclude)-maxPuzzleExclude:]
	}
	exclude = append([]string(nil), exclude...)

	mixed := req.Theme == ""
	var only *puzzleThemeJSON
	if !mixed {
		if !puzzle.IsTheme(req.Theme) {
			http.Error(w, "unknown theme", http.StatusBadRequest)
			return
		}
		for i := range themes {
			if themes[i].Key == req.Theme {
				only = &themes[i]
			}
		}
		if only == nil {
			http.Error(w, "no puzzles for that theme yet", http.StatusNotFound)
			return
		}
	}

	recent, err := h.db.RecentPuzzleIDs(r.Context(), username, db.RecentPuzzleLimit)
	if err != nil {
		http.Error(w, "failed to load recent puzzles: "+err.Error(), http.StatusInternalServerError)
		return
	}

	batch := puzzleNextBatch{Puzzles: []puzzleNextResponse{}}
	avoid := req.AvoidTheme
	for attempts := 0; len(batch.Puzzles) < count && attempts < count*6; attempts++ {
		chosen := only
		if mixed {
			var pool []*puzzleThemeJSON
			for i := range themes {
				if themes[i].Available >= puzzle.MinMixedCount && puzzle.InMixed(themes[i].Key) && themes[i].Key != avoid {
					pool = append(pool, &themes[i])
				}
			}
			if len(pool) == 0 {
				for i := range themes {
					pool = append(pool, &themes[i])
				}
			}
			chosen = pool[rand.Intn(len(pool))]
		}
		strict := append(append([]string(nil), exclude...), recent...)
		p, err := h.puzzles.Next(r.Context(), chosen.Key, chosen.exact, strict)
		if err == nil && p == nil {
			p, err = h.puzzles.Next(r.Context(), chosen.Key, chosen.exact, exclude)
		}
		if err != nil {
			http.Error(w, "failed to pick a puzzle: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if p == nil {
			if !mixed {
				break
			}
			avoid = chosen.Key
			continue
		}
		exclude = append(exclude, p.ID)
		avoid = chosen.Key
		batch.Puzzles = append(batch.Puzzles, puzzleNextResponse{Puzzle: *p, Theme: chosen.Key, ThemeRating: chosen.Rating, Mixed: mixed})
	}
	if len(batch.Puzzles) == 0 {
		http.Error(w, "no puzzles for that theme yet", http.StatusNotFound)
		return
	}
	respondJSON(w, http.StatusOK, batch)
}

func (h *Handler) SubmitPuzzleResult(w http.ResponseWriter, r *http.Request) {
	username, ok := h.puzzleUser(w, r)
	if !ok {
		return
	}
	var req puzzleResultRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OperationID == "" || req.PuzzleID == "" || !puzzle.IsTheme(req.Theme) {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	found, err := h.puzzles.Get(r.Context(), req.PuzzleID)
	if err != nil {
		http.Error(w, "failed to look up the puzzle: "+err.Error(), http.StatusBadGateway)
		return
	}
	if found == nil {
		http.Error(w, db.ErrUnknownPuzzle.Error(), http.StatusBadRequest)
		return
	}
	res, err := h.db.RecordPuzzlePlay(r.Context(), username, req.OperationID, req.PuzzleID, req.Theme, req.Solved, found.Rating, found.Themes)
	if errors.Is(err, db.ErrUnknownPuzzle) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "failed to save puzzle result: "+err.Error(), http.StatusInternalServerError)
		return
	}
	before, after := int(math.Round(res.RatingBefore)), int(math.Round(res.RatingAfter))
	respondJSON(w, http.StatusOK, puzzleResultResponse{
		Theme: res.Theme, RatingBefore: before, RatingAfter: after, Delta: after - before,
		Attempts: res.Attempts, Wins: res.Wins, PuzzleRating: res.PuzzleRating,
	})
}

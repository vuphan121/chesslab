package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
	"github.com/go-chi/chi/v5"
)

type CardProgressJSON struct {
	Box         int     `json:"box"`
	Lapses      int     `json:"lapses"`
	Seen        int     `json:"seen"`
	Correct     int     `json:"correct"`
	LastSeenISO *string `json:"lastSeenISO"`
}

type LineAttemptJSON struct {
	ChapterID   string `json:"chapterId"`
	ChapterName string `json:"chapterName"`
	CardID      string `json:"cardId"`
	HadMistake  bool   `json:"hadMistake"`
}

type SaveProgressRequest struct {
	Cards       map[string]CardProgressJSON      `json:"cards"`
	LineAttempt *LineAttemptJSON                 `json:"lineAttempt,omitempty"`
	Deltas      map[string]CardProgressDeltaJSON `json:"deltas,omitempty"`
	OperationID string                           `json:"operationId,omitempty"`
}

type CardProgressDeltaJSON struct {
	Lapses  int `json:"lapses"`
	Seen    int `json:"seen"`
	Correct int `json:"correct"`
}

type GetProgressResponse struct {
	Cards map[string]CardProgressJSON `json:"cards"`
}

func (h *Handler) GetProgress(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "progress sync not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	repertoireID := chi.URLParam(r, "repertoireId")

	cards, err := h.db.GetProgress(r.Context(), username, repertoireID)
	if err != nil {
		http.Error(w, "failed to load progress: "+err.Error(), http.StatusInternalServerError)
		return
	}

	out := make(map[string]CardProgressJSON, len(cards))
	for id, c := range cards {
		out[id] = CardProgressJSON{Box: c.Box, Lapses: c.Lapses, Seen: c.Seen, Correct: c.Correct, LastSeenISO: c.LastSeenISO}
	}
	respondJSON(w, http.StatusOK, GetProgressResponse{Cards: out})
}

func (h *Handler) SaveProgress(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "progress sync not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	repertoireID := chi.URLParam(r, "repertoireId")

	var req SaveProgressRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Deltas != nil && (req.OperationID == "" || len(req.OperationID) > 128) {
		http.Error(w, "a valid operationId is required for progress deltas", http.StatusBadRequest)
		return
	}
	if len(req.Cards) > 10000 {
		http.Error(w, "too many progress cards", http.StatusBadRequest)
		return
	}

	cards := make(map[string]db.CardProgress, len(req.Cards))
	for id, c := range req.Cards {
		if strings.TrimSpace(id) == "" || c.Box < 0 || c.Box > 5 || c.Lapses < 0 || c.Seen < 0 || c.Correct < 0 || c.Correct > c.Seen || c.Lapses > c.Seen {
			http.Error(w, "invalid card progress", http.StatusBadRequest)
			return
		}
		cards[id] = db.CardProgress{Box: c.Box, Lapses: c.Lapses, Seen: c.Seen, Correct: c.Correct, LastSeenISO: c.LastSeenISO}
	}
	var deltas map[string]db.CardProgressDelta
	if req.Deltas != nil {
		deltas = make(map[string]db.CardProgressDelta, len(req.Deltas))
		for id, delta := range req.Deltas {
			if _, ok := cards[id]; !ok || delta.Lapses < 0 || delta.Seen < 0 || delta.Correct < 0 || delta.Lapses > delta.Seen || delta.Correct > delta.Seen {
				http.Error(w, "invalid progress delta", http.StatusBadRequest)
				return
			}
			deltas[id] = db.CardProgressDelta{Lapses: delta.Lapses, Seen: delta.Seen, Correct: delta.Correct}
		}
	}
	var attempt *db.LineAttempt
	if req.LineAttempt != nil {
		attempt = &db.LineAttempt{
			ChapterID:   req.LineAttempt.ChapterID,
			ChapterName: req.LineAttempt.ChapterName,
			CardID:      req.LineAttempt.CardID,
			HadMistake:  req.LineAttempt.HadMistake,
		}
	}

	if err := h.db.SaveProgress(r.Context(), username, repertoireID, cards, deltas, attempt, req.OperationID); err != nil {
		http.Error(w, "failed to save progress: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) Analytics(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "analytics not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	clock := currentRequestClock(r)
	a, err := h.db.GetAnalytics(r.Context(), username, clock.date, clock.timeZone)
	if err != nil {
		http.Error(w, "failed to load analytics: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, a)
}

package api

import (
	"encoding/json"
	"net/http"

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
	Cards       map[string]CardProgressJSON `json:"cards"`
	LineAttempt *LineAttemptJSON            `json:"lineAttempt,omitempty"`
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

	cards := make(map[string]db.CardProgress, len(req.Cards))
	for id, c := range req.Cards {
		cards[id] = db.CardProgress{Box: c.Box, Lapses: c.Lapses, Seen: c.Seen, Correct: c.Correct, LastSeenISO: c.LastSeenISO}
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

	if err := h.db.SaveProgress(r.Context(), username, repertoireID, cards, attempt); err != nil {
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

	a, err := h.db.GetAnalytics(r.Context(), username)
	if err != nil {
		http.Error(w, "failed to load analytics: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, a)
}

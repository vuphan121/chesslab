package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
	"github.com/go-chi/chi/v5"
)

type SavedLinesResponse struct {
	Lines []db.SavedLine `json:"lines"`
}

type SaveLineRequest struct {
	StartFen string             `json:"startFen"`
	Moves    []db.SavedLineMove `json:"moves"`
}

func (h *Handler) GetBookSavedLines(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "saved lines not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	lines, err := h.db.GetBookSavedLines(r.Context(), username, chi.URLParam(r, "bookId"), chi.URLParam(r, "itemId"))
	if err != nil {
		http.Error(w, "failed to load saved lines: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, SavedLinesResponse{Lines: lines})
}

func (h *Handler) SaveBookLine(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "saved lines not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req SaveLineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.StartFen == "" || len(req.Moves) == 0 {
		http.Error(w, "a saved line needs a start position and at least one move", http.StatusBadRequest)
		return
	}
	line, err := h.db.SaveBookLine(r.Context(), username, chi.URLParam(r, "bookId"), chi.URLParam(r, "itemId"), req.StartFen, req.Moves)
	if err != nil {
		http.Error(w, "failed to save line: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]db.SavedLine{"line": line})
}

func (h *Handler) DeleteBookSavedLine(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "saved lines not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if err := h.db.DeleteBookSavedLine(r.Context(), username, id); err != nil {
		http.Error(w, "failed to delete saved line: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

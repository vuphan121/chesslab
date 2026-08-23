package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
	"github.com/go-chi/chi/v5"
)

type SavedPuzzleJSON struct {
	ID        int64  `json:"id"`
	URL       string `json:"url"`
	CreatedAt string `json:"createdAt"`
}

type SavePuzzleRequest struct {
	URL string `json:"url"`
}

func (h *Handler) ListSavedPuzzles(w http.ResponseWriter, r *http.Request) {
	username, ok := h.savedPuzzlesUsername(w, r)
	if !ok {
		return
	}
	puzzles, err := h.db.ListSavedPuzzles(r.Context(), username)
	if err != nil {
		http.Error(w, "failed to load saved puzzles: "+err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]SavedPuzzleJSON, 0, len(puzzles))
	for _, puzzle := range puzzles {
		out = append(out, toSavedPuzzleJSON(puzzle))
	}
	respondJSON(w, http.StatusOK, map[string]any{"puzzles": out})
}

func (h *Handler) SavePuzzle(w http.ResponseWriter, r *http.Request) {
	username, ok := h.savedPuzzlesUsername(w, r)
	if !ok {
		return
	}
	var req SavePuzzleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	puzzleURL, err := chessTempoPuzzleURL(req.URL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	puzzle, err := h.db.SavePuzzle(r.Context(), username, puzzleURL)
	if err != nil {
		http.Error(w, "failed to save puzzle: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusCreated, toSavedPuzzleJSON(puzzle))
}

func (h *Handler) DeleteSavedPuzzle(w http.ResponseWriter, r *http.Request) {
	username, ok := h.savedPuzzlesUsername(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id < 1 {
		http.Error(w, "invalid puzzle id", http.StatusBadRequest)
		return
	}
	deleted, err := h.db.DeleteSavedPuzzle(r.Context(), username, id)
	if err != nil {
		http.Error(w, "failed to remove puzzle: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if !deleted {
		http.Error(w, "saved puzzle not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) savedPuzzlesUsername(w http.ResponseWriter, r *http.Request) (string, bool) {
	if h.db == nil {
		http.Error(w, "saved puzzles are not configured", http.StatusServiceUnavailable)
		return "", false
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return "", false
	}
	return username, true
}

func chessTempoPuzzleURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return "", errors.New("enter an https ChessTempo puzzle URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "chesstempo.com" && !strings.HasSuffix(host, ".chesstempo.com") {
		return "", &url.Error{Op: "parse", URL: raw, Err: errNotChessTempoURL{}}
	}
	return parsed.String(), nil
}

type errNotChessTempoURL struct{}

func (errNotChessTempoURL) Error() string { return "enter a ChessTempo puzzle URL" }

func toSavedPuzzleJSON(puzzle db.SavedPuzzle) SavedPuzzleJSON {
	return SavedPuzzleJSON{ID: puzzle.ID, URL: puzzle.URL, CreatedAt: puzzle.CreatedAt.UTC().Format("2006-01-02T15:04:05Z")}
}

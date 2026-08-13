package api

import (
	"net/http"

	"github.com/chesslab/backend/internal/auth"
	"github.com/go-chi/chi/v5"
)

type GetBookProgressResponse struct {
	Done []string `json:"done"`
}

// GetBookProgress returns the authenticated user's completed item ids for
// one book — the server-side "which checkmarks are filled in" source, same
// degrade-gracefully-if-unconfigured shape as GetProgress (opening trainer).
func (h *Handler) GetBookProgress(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "progress sync not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	bookID := chi.URLParam(r, "bookId")

	done, err := h.db.GetBookProgress(r.Context(), username, bookID)
	if err != nil {
		http.Error(w, "failed to load progress: "+err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]string, 0, len(done))
	for id := range done {
		out = append(out, id)
	}
	respondJSON(w, http.StatusOK, GetBookProgressResponse{Done: out})
}

// MarkItemDone marks one item completed (lesson started, puzzle solved, or
// puzzle solution revealed — see useBookStudySession.ts). Idempotent.
func (h *Handler) MarkItemDone(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "progress sync not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	bookID := chi.URLParam(r, "bookId")
	itemID := chi.URLParam(r, "itemId")

	if err := h.db.MarkItemDone(r.Context(), username, bookID, itemID); err != nil {
		http.Error(w, "failed to save progress: "+err.Error(), http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

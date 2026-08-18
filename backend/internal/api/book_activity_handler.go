package api

import (
	"net/http"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/db"
	"github.com/go-chi/chi/v5"
)

// RecordBookStudyActivity records a study event after a legal move. The book
// store, rather than the browser, is the source of truth for chapter names and
// whether an item is a lesson or puzzle.
func (h *Handler) RecordBookStudyActivity(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, "study activity sync not configured", http.StatusServiceUnavailable)
		return
	}
	username, ok := auth.UsernameFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	bookID := chi.URLParam(r, "bookId")
	chapterID := chi.URLParam(r, "chapterId")
	itemID := chi.URLParam(r, "itemId")
	b, ok := h.books.Get(bookID)
	if !ok {
		http.Error(w, "book not found", http.StatusNotFound)
		return
	}

	for _, chapter := range b.Chapters {
		if chapter.ID != chapterID {
			continue
		}
		for _, item := range chapter.Items {
			if item.ID != itemID {
				continue
			}
			if err := h.db.RecordBookStudyActivity(r.Context(), username, db.BookStudyActivity{
				BookID: bookID, BookTitle: b.Title, ChapterID: chapter.ID, ChapterName: chapter.Name,
				ItemID: item.ID, ItemType: item.Type,
			}); err != nil {
				http.Error(w, "failed to save study activity: "+err.Error(), http.StatusInternalServerError)
				return
			}
			respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
	}

	http.Error(w, "book item not found", http.StatusNotFound)
}

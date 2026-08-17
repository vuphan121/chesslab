package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/chesslab/backend/internal/book"
	"github.com/go-chi/chi/v5"
)

type BookChapterSummaryJSON struct {
	ID        string `json:"id"`
	Number    int    `json:"number"`
	Name      string `json:"name"`
	ItemCount int    `json:"itemCount"`
}

type BookSummaryJSON struct {
	ID        string                   `json:"id"`
	Title     string                   `json:"title"`
	Author    string                   `json:"author"`
	Chapters  []BookChapterSummaryJSON `json:"chapters"`
	ItemCount int                      `json:"itemCount"`
}

// ListBooks returns a lightweight summary of every loaded book (chapter
// names + item counts, no positions) for the setup screen.
func (h *Handler) ListBooks(w http.ResponseWriter, r *http.Request) {
	books := h.books.List()
	out := make([]BookSummaryJSON, 0, len(books))
	for _, b := range books {
		out = append(out, toBookSummary(b))
	}
	respondJSON(w, http.StatusOK, out)
}

// GetBook returns one book's full chapters and items — including puzzle
// solutions, same "ship it all, let the UI withhold what it shows" precedent
// as the repertoire's Card.Answers.
func (h *Handler) GetBook(w http.ResponseWriter, r *http.Request) {
	b, ok := h.books.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "book not found", http.StatusNotFound)
		return
	}
	respondJSON(w, http.StatusOK, b)
}

// GetBookSourcePDF streams the explicitly linked, local source PDF for a
// book. PDFs remain outside git and are only served to an authenticated local
// user; books without a linked local file simply return 404.
func (h *Handler) GetBookSourcePDF(w http.ResponseWriter, r *http.Request) {
	b, ok := h.books.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "book not found", http.StatusNotFound)
		return
	}
	path, ok := book.SourcePath(h.bookSourcesDir, b)
	if !ok {
		http.Error(w, "book source PDF not available", http.StatusNotFound)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, "book source PDF not available", http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.Error(w, "book source PDF not available", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline; filename=\""+filepath.Base(path)+"\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), f)
}

func toBookSummary(b *book.Book) BookSummaryJSON {
	chapters := make([]BookChapterSummaryJSON, 0, len(b.Chapters))
	total := 0
	for _, ch := range b.Chapters {
		chapters = append(chapters, BookChapterSummaryJSON{
			ID: ch.ID, Number: ch.Number, Name: ch.Name, ItemCount: len(ch.Items),
		})
		total += len(ch.Items)
	}
	return BookSummaryJSON{
		ID: b.ID, Title: b.Title, Author: b.Author,
		Chapters: chapters, ItemCount: total,
	}
}

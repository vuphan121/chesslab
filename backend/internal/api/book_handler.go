package api

import (
	"errors"
	"io"
	"net/http"

	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/booksource"
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

// GetBookChapterPDF streams exactly one private, chapter-sized source PDF.
// The browser gets bytes only after the normal app-auth check; it never gets
// a Backblaze credential, download token, or arbitrary object path.
func (h *Handler) GetBookChapterPDF(w http.ResponseWriter, r *http.Request) {
	b, ok := h.books.Get(chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "book not found", http.StatusNotFound)
		return
	}
	objectKey, ok := book.ChapterObjectKey(h.bookChapterPrefix, b, chi.URLParam(r, "chapterID"))
	if !ok {
		http.Error(w, "book chapter not found", http.StatusNotFound)
		return
	}
	if h.bookSource == nil {
		http.Error(w, "book storage is not configured", http.StatusServiceUnavailable)
		return
	}
	f, err := h.bookSource.Open(r.Context(), objectKey)
	if err != nil {
		if errors.Is(err, booksource.ErrNotFound) {
			http.Error(w, "book chapter PDF not available", http.StatusNotFound)
			return
		}
		http.Error(w, "book chapter PDF temporarily unavailable", http.StatusBadGateway)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline; filename=\"chapter.pdf\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, f)
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

package api

import (
	"errors"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/chesslab/backend/internal/booksource"
	"github.com/go-chi/chi/v5"
)

var pdfBookID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,80}$`)

type PDFBookJSON struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	SizeBytes int64  `json:"sizeBytes"`
}

func (h *Handler) pdfBookPrefix() string {
	prefix := strings.Trim(h.pdfBookObjectPrefix, "/")
	if prefix == "" {
		prefix = "pdfbooks"
	}
	return prefix
}

func PDFBookObjectKey(prefix, id string) (string, bool) {
	if !pdfBookID.MatchString(id) {
		return "", false
	}
	return strings.Trim(prefix, "/") + "/" + id + ".pdf", true
}

func pdfBookTitle(id string) string {
	words := strings.Fields(strings.NewReplacer("_", " ", "-", " ").Replace(id))
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}

func (h *Handler) ListPDFBooks(w http.ResponseWriter, r *http.Request) {
	lister, ok := h.bookSource.(booksource.Lister)
	if !ok || h.bookSource == nil {
		http.Error(w, "book storage is not configured", http.StatusServiceUnavailable)
		return
	}
	prefix := h.pdfBookPrefix() + "/"
	objects, err := lister.List(r.Context(), prefix)
	if err != nil {
		http.Error(w, "book storage temporarily unavailable", http.StatusBadGateway)
		return
	}
	out := make([]PDFBookJSON, 0, len(objects))
	for _, o := range objects {
		name := strings.TrimPrefix(o.Key, prefix)
		id, isPDF := strings.CutSuffix(name, ".pdf")
		if !isPDF || !pdfBookID.MatchString(id) {
			continue
		}
		out = append(out, PDFBookJSON{ID: id, Title: pdfBookTitle(id), SizeBytes: o.Size})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	respondJSON(w, http.StatusOK, out)
}

func (h *Handler) GetPDFBook(w http.ResponseWriter, r *http.Request) {
	objectKey, ok := PDFBookObjectKey(h.pdfBookPrefix(), chi.URLParam(r, "id"))
	if !ok {
		http.Error(w, "pdf book not found", http.StatusNotFound)
		return
	}
	if h.bookSource == nil {
		http.Error(w, "book storage is not configured", http.StatusServiceUnavailable)
		return
	}
	f, err := h.bookSource.Open(r.Context(), objectKey)
	if err != nil {
		if errors.Is(err, booksource.ErrNotFound) {
			http.Error(w, "pdf book not found", http.StatusNotFound)
			return
		}
		http.Error(w, "pdf book temporarily unavailable", http.StatusBadGateway)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline; filename=\"book.pdf\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, f)
}

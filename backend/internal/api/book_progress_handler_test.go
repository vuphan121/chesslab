package api

import (
	"testing"

	"github.com/chesslab/backend/internal/book"
)

func TestBookHasItem(t *testing.T) {
	store := book.NewStore([]*book.Book{{
		ID:       "b1",
		Chapters: []book.Chapter{{ID: "c1", Items: []book.Item{{ID: "i1"}, {ID: "i2"}}}},
	}})
	h := &Handler{books: store}
	if !h.bookHasItem("b1", "i2") {
		t.Fatal("known item should be found")
	}
	if h.bookHasItem("b1", "nope") || h.bookHasItem("nope", "i1") {
		t.Fatal("unknown book or item should not be found")
	}
	if (&Handler{}).bookHasItem("b1", "i1") {
		t.Fatal("a handler without books should find nothing")
	}
}

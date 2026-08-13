package book

import (
	"os"
	"path/filepath"
	"testing"
)

const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

func validBookJSON(id string) string {
	return `{
		"id": "` + id + `",
		"title": "Test Book",
		"author": "Test Author",
		"chapters": [
			{
				"id": "ch1",
				"number": 1,
				"name": "Test Chapter",
				"items": [
					{
						"id": "ch1-lesson-1",
						"chapterId": "ch1",
						"type": "lesson",
						"fen": "` + startFEN + `",
						"sideToMove": "w",
						"prompt": "White to move."
					},
					{
						"id": "ch1-puzzle-1",
						"chapterId": "ch1",
						"type": "puzzle",
						"fen": "` + startFEN + `",
						"sideToMove": "w",
						"prompt": "Find the best move.",
						"solution": ["e4", "e5", "Nf3"]
					}
				]
			}
		]
	}`
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func TestLoadDir_ValidBook(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "test-book.json", validBookJSON("test-book"))

	books := LoadDir(dir)
	if len(books) != 1 {
		t.Fatalf("got %d books, want 1", len(books))
	}
	b := books[0]
	if b.ID != "test-book" || b.Title != "Test Book" {
		t.Errorf("book = %+v", b)
	}
	if len(b.Chapters) != 1 || len(b.Chapters[0].Items) != 2 {
		t.Fatalf("unexpected chapter/item shape: %+v", b.Chapters)
	}
}

func TestLoadDir_DerivesSolutionUCI(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "test-book.json", validBookJSON("test-book"))

	books := LoadDir(dir)
	if len(books) != 1 {
		t.Fatalf("got %d books, want 1", len(books))
	}
	puzzle := books[0].Chapters[0].Items[1]
	want := []string{"e2e4", "e7e5", "g1f3"}
	if len(puzzle.SolutionUCI) != len(want) {
		t.Fatalf("SolutionUCI = %v, want %v", puzzle.SolutionUCI, want)
	}
	for i, uci := range want {
		if puzzle.SolutionUCI[i] != uci {
			t.Errorf("SolutionUCI[%d] = %q, want %q", i, puzzle.SolutionUCI[i], uci)
		}
	}
}

func TestLoadDir_MissingDir(t *testing.T) {
	books := LoadDir(filepath.Join(t.TempDir(), "does-not-exist"))
	if books != nil {
		t.Errorf("got %v, want nil for a missing directory", books)
	}
}

func TestLoadDir_SkipsBadFEN(t *testing.T) {
	dir := t.TempDir()
	bad := `{"id":"bad","title":"Bad","author":"","chapters":[{"id":"ch1","number":1,"name":"C1","items":[
		{"id":"i1","chapterId":"ch1","type":"lesson","fen":"not a fen","sideToMove":"w","prompt":"x"}
	]}]}`
	writeFile(t, dir, "bad-fen.json", bad)
	writeFile(t, dir, "good.json", validBookJSON("good"))

	books := LoadDir(dir)
	if len(books) != 1 || books[0].ID != "good" {
		t.Fatalf("expected only the valid book to load, got %+v", books)
	}
}

func TestLoadDir_SkipsMismatchedSideToMove(t *testing.T) {
	dir := t.TempDir()
	bad := `{"id":"bad","title":"Bad","author":"","chapters":[{"id":"ch1","number":1,"name":"C1","items":[
		{"id":"i1","chapterId":"ch1","type":"lesson","fen":"` + startFEN + `","sideToMove":"b","prompt":"x"}
	]}]}`
	writeFile(t, dir, "bad-side.json", bad)

	books := LoadDir(dir)
	if len(books) != 0 {
		t.Fatalf("expected the book to be skipped (sideToMove disagrees with the FEN), got %+v", books)
	}
}

func TestLoadDir_SkipsIllegalSolutionMove(t *testing.T) {
	dir := t.TempDir()
	// e4 is fine, but Ke2 is not a legal reply to it in this position — the
	// solution sequence must fail validation on ply 2.
	bad := `{"id":"bad","title":"Bad","author":"","chapters":[{"id":"ch1","number":1,"name":"C1","items":[
		{"id":"i1","chapterId":"ch1","type":"puzzle","fen":"` + startFEN + `","sideToMove":"w","prompt":"x","solution":["e4","Ke2"]}
	]}]}`
	writeFile(t, dir, "bad-solution.json", bad)

	books := LoadDir(dir)
	if len(books) != 0 {
		t.Fatalf("expected the book to be skipped (illegal solution move), got %+v", books)
	}
}

func TestLoadDir_SkipsMissingID(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "no-id.json", `{"title":"No ID","author":"","chapters":[]}`)

	books := LoadDir(dir)
	if len(books) != 0 {
		t.Fatalf("expected the book to be skipped (missing id), got %+v", books)
	}
}

func TestStore_ListAndGet(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.json", validBookJSON("a"))
	writeFile(t, dir, "b.json", validBookJSON("b"))

	store := NewStore(LoadDir(dir))
	if len(store.List()) != 2 {
		t.Fatalf("List() = %d books, want 2", len(store.List()))
	}
	if b, ok := store.Get("a"); !ok || b.ID != "a" {
		t.Errorf("Get(%q) = %+v, %v", "a", b, ok)
	}
	if _, ok := store.Get("missing"); ok {
		t.Error("Get(missing) should return ok=false")
	}
}

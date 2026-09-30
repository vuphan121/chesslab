package puzzledb

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/chesslab/backend/internal/puzzle"
	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	s := NewFromDB(db)
	if err := s.EnsureSchema(context.Background()); err != nil {
		t.Fatal(err)
	}
	return s
}

func insert(t *testing.T, s *Store, id string, rating int, themes ...string) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO puzzles VALUES (?, ?, ?, ?, ?)`, id, "fen-"+id, "e2e4 e7e5", rating, joinThemes(themes)); err != nil {
		t.Fatal(err)
	}
	for i, th := range themes {
		if _, err := s.db.Exec(`INSERT INTO puzzle_themes VALUES (?, ?, ?)`, th, puzzle.RatingKey(rating, int64(i*7919+len(id))), id); err != nil {
			t.Fatal(err)
		}
	}
}

func joinThemes(themes []string) string {
	out := ""
	for i, th := range themes {
		if i > 0 {
			out += " "
		}
		out += th
	}
	return out
}

func TestNextPicksNearRatingAndWidens(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for i := 0; i < 40; i++ {
		insert(t, s, fmt.Sprintf("near%02d", i), 2000+i, "fork", "short")
	}
	insert(t, s, "far", 2800, "fork")
	insert(t, s, "pinned", 2010, "pin")

	for i := 0; i < 50; i++ {
		p, err := s.Next(ctx, "fork", 2020, nil)
		if err != nil || p == nil {
			t.Fatalf("expected a puzzle, got %v err %v", p, err)
		}
		if p.Rating < 1945 || p.Rating > 2095 {
			t.Fatalf("picked rating %d outside the +-75 window", p.Rating)
		}
	}

	p, err := s.Next(ctx, "fork", 2500, nil)
	if err != nil || p == nil {
		t.Fatalf("window should widen, got %v err %v", p, err)
	}
	if p.Rating < 2000 {
		t.Fatalf("unexpected rating %d", p.Rating)
	}

	none, err := s.Next(ctx, "skewer", 2000, nil)
	if err != nil || none != nil {
		t.Fatalf("unknown theme should give nothing, got %v err %v", none, err)
	}
}

func TestNextRespectsExcludeAndHasNoDuplicatesInBatch(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for i := 0; i < 6; i++ {
		insert(t, s, fmt.Sprintf("p%d", i), 1900+i, "fork")
	}
	seen := map[string]bool{}
	var exclude []string
	for i := 0; i < 6; i++ {
		p, err := s.Next(ctx, "fork", 1903, exclude)
		if err != nil || p == nil {
			t.Fatalf("pick %d: %v %v", i, p, err)
		}
		if seen[p.ID] {
			t.Fatalf("duplicate %s", p.ID)
		}
		seen[p.ID] = true
		exclude = append(exclude, p.ID)
	}
	if p, _ := s.Next(ctx, "fork", 1903, exclude); p != nil {
		t.Fatalf("everything excluded, got %v", p)
	}
}

func TestGetAndThemeCounts(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	insert(t, s, "abc", 2100, "fork", "pin")
	if _, err := s.db.Exec(`INSERT INTO theme_counts VALUES ('fork', 1), ('pin', 1)`); err != nil {
		t.Fatal(err)
	}
	p, err := s.Get(ctx, "abc")
	if err != nil || p == nil || p.Rating != 2100 || len(p.Themes) != 2 || p.Themes[1] != "pin" {
		t.Fatalf("get: %+v err %v", p, err)
	}
	if missing, _ := s.Get(ctx, "nope"); missing != nil {
		t.Fatal("missing id should be nil")
	}
	counts, err := s.ThemeCounts(ctx)
	if err != nil || counts["fork"] != 1 || counts["pin"] != 1 {
		t.Fatalf("counts: %v err %v", counts, err)
	}
}

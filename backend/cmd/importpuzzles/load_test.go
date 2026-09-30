package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chesslab/backend/internal/puzzledb"
	_ "modernc.org/sqlite"
)

const sampleCSV = `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
a1,fenA,e2e4 e7e5,1700,80,90,900,fork short,u,
b2,fenB,e2e4 e7e5,1900,80,90,900,fork pin short notATheme,u,
c3,fenC,e2e4 e7e5,2000,80,90,900,pin long,u,
d4,fenD,e2e4 e7e5,2700,80,90,900,fork short,u,
e5,fenE,e2e4 e7e5,2599,80,90,900,skewer short,u,
`

func TestPlanAndLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p.csv")
	if err := os.WriteFile(path, []byte(sampleCSV), 0o600); err != nil {
		t.Fatal(err)
	}
	f := filter{minRating: 1800, maxRating: 2599}

	p, err := scan(path, "", f)
	if err != nil {
		t.Fatal(err)
	}
	if p.puzzles != 3 || p.themeRows != 7 || p.themeCount["short"] != 2 || p.themeCount["pin"] != 2 {
		t.Fatalf("plan: %+v", p)
	}
	if p.writes() != 3+7+len(p.themeCount) {
		t.Fatalf("writes estimate: %d", p.writes())
	}

	db, err := sql.Open("sqlite", "file:load?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()
	store := puzzledb.NewFromDB(db)
	ctx := context.Background()
	if err := store.EnsureSchema(ctx); err != nil {
		t.Fatal(err)
	}

	loaded, failed, err := loadPuzzles(ctx, store, path, "", f, p.puzzles, 2, 2)
	if err != nil || failed != 0 || loaded != 3 {
		t.Fatalf("load: loaded=%d failed=%d err=%v", loaded, failed, err)
	}
	loadedAgain, failedAgain, err := loadPuzzles(ctx, store, path, "", f, p.puzzles, 2, 2)
	if err != nil || failedAgain != 0 || loadedAgain != 3 {
		t.Fatalf("a second run must be harmless: %d %d %v", loadedAgain, failedAgain, err)
	}
	if err := store.WriteThemeCounts(ctx, p.themeCount); err != nil {
		t.Fatal(err)
	}

	var puzzles, themeRows int
	db.QueryRow(`SELECT COUNT(*) FROM puzzles`).Scan(&puzzles)
	db.QueryRow(`SELECT COUNT(*) FROM puzzle_themes`).Scan(&themeRows)
	if puzzles != 3 || themeRows != 7 {
		t.Fatalf("stored %d puzzles and %d theme rows, want 3 and 7", puzzles, themeRows)
	}
	counts, err := store.ThemeCounts(ctx)
	if err != nil || counts["fork"] != 1 || counts["short"] != 2 {
		t.Fatalf("counts %v err %v", counts, err)
	}

	got, err := store.Next(ctx, "pin", 1950, nil)
	if err != nil || got == nil || !strings.HasPrefix(got.FEN, "fen") {
		t.Fatalf("next: %+v err %v", got, err)
	}
	if got.Themes[0] == "notATheme" || strings.Contains(strings.Join(got.Themes, " "), "notATheme") {
		t.Fatalf("unknown themes must not be stored: %v", got.Themes)
	}
}

package db

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPuzzleRatingsAreIndependentPerAccount(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	store, err := Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	const a, b = "__chesslab_account_a__", "__chesslab_account_b__"
	cleanup := func() {
		for _, u := range []string{a, b} {
			_, _ = store.pool.Exec(context.Background(), `DELETE FROM users WHERE username = $1`, u)
		}
	}
	cleanup()
	defer cleanup()
	for _, u := range []string{a, b} {
		if _, err := store.pool.Exec(ctx, `INSERT INTO users (username, password_hash) VALUES ($1, 'unused')`, u); err != nil {
			t.Fatal(err)
		}
	}

	themes := []string{"fork", "pin"}
	now := time.Now()
	first, err := store.RecordPuzzlePlay(ctx, a, "same-op", "2099-02-01", now, "p1", "fork", true, 2400, themes)
	if err != nil {
		t.Fatal(err)
	}
	if first.RatingBefore != 2000 || first.RatingAfter <= 2000 {
		t.Fatalf("account A should start at 2000 and go up after beating a 2400 puzzle: %+v", first)
	}
	if _, err := store.RecordPuzzlePlay(ctx, a, "a-op-2", "2099-02-01", now, "p2", "fork", true, 2400, themes); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordPuzzlePlay(ctx, a, "a-op-3", "2099-02-01", now, "p3", "pin", false, 1500, themes); err != nil {
		t.Fatal(err)
	}

	statsB, err := store.PuzzleThemeStats(ctx, b)
	if err != nil {
		t.Fatal(err)
	}
	if len(statsB) != 0 {
		t.Fatalf("account B has not played, yet sees ratings: %+v", statsB)
	}
	statsA, err := store.PuzzleThemeStats(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if statsA["fork"].Rating <= 2000 || statsA["fork"].Attempts != 2 || statsA["pin"].Rating >= 2000 {
		t.Fatalf("account A ratings wrong: %+v", statsA)
	}

	same, err := store.RecordPuzzlePlay(ctx, b, "same-op", "2099-02-01", now, "p1", "fork", false, 2400, themes)
	if err != nil {
		t.Fatal(err)
	}
	if same.RatingBefore != 2000 {
		t.Fatalf("B reusing A's operation id must be processed as B's own first play starting at 2000, got %+v", same)
	}
	if same.RatingAfter >= 2000 || same.Attempts != 1 || same.Wins != 0 {
		t.Fatalf("B failed once and should be below 2000 with one attempt: %+v", same)
	}

	statsA, _ = store.PuzzleThemeStats(ctx, a)
	if statsA["fork"].Attempts != 2 || statsA["fork"].Wins != 2 {
		t.Fatalf("B's play changed A's ratings: %+v", statsA["fork"])
	}

	replay, err := store.RecordPuzzlePlay(ctx, b, "same-op", "2099-02-01", now, "p1", "fork", false, 2400, themes)
	if err != nil {
		t.Fatal(err)
	}
	if replay.RatingAfter != same.RatingAfter || replay.Attempts != 1 {
		t.Fatalf("B's own replay should be idempotent: first %+v replay %+v", same, replay)
	}

	recentA, _ := store.RecentPuzzleIDs(ctx, a, 50)
	recentB, _ := store.RecentPuzzleIDs(ctx, b, 50)
	if len(recentA) != 3 || len(recentB) != 1 {
		t.Fatalf("recent puzzles leaked between accounts: A=%v B=%v", recentA, recentB)
	}

	dailyA, totalsA, err := store.StatsDaily(ctx, a, "2099-02-01", 7)
	if err != nil {
		t.Fatal(err)
	}
	_, totalsB, err := store.StatsDaily(ctx, b, "2099-02-01", 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(dailyA) != 1 || totalsA.Puzzles != 3 || totalsB.Puzzles != 1 {
		t.Fatalf("statistics leaked between accounts: A=%+v/%+v B=%+v", dailyA, totalsA, totalsB)
	}

	if err := store.AddPuzzleRetry(ctx, a, "p3", "pin"); err != nil {
		t.Fatal(err)
	}
	if err := store.RemovePuzzleRetry(ctx, b, "p3"); err != nil {
		t.Fatal(err)
	}
	var inQueue int
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM puzzle_retry_queue WHERE username = $1`, a).Scan(&inQueue); err != nil {
		t.Fatal(err)
	}
	if inQueue != 1 {
		t.Fatalf("B removing the same puzzle must not touch A's retry queue, A has %d", inQueue)
	}

	if _, err := store.pool.Exec(ctx, `DELETE FROM users WHERE username = $1`, a); err != nil {
		t.Fatal(err)
	}
	statsB, _ = store.PuzzleThemeStats(ctx, b)
	if statsB["fork"].Attempts != 1 {
		t.Fatalf("deleting account A must not remove B's ratings: %+v", statsB)
	}
}

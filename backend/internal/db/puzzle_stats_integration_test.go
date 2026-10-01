package db

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPuzzleStatsAggregatesAndCleanup(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	const username = "__chesslab_puzzle_stats_test__"
	_, _ = store.pool.Exec(ctx, `DELETE FROM users WHERE username = $1`, username)
	defer func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM users WHERE username = $1`, username)
	}()
	if _, err := store.pool.Exec(ctx, `INSERT INTO users (username, password_hash) VALUES ($1, 'unused')`, username); err != nil {
		t.Fatal(err)
	}

	themes := []string{"fork", "pin"}
	if _, err := store.RecordPuzzlePlay(ctx, username, "op-1", "2099-01-01", "p1", "fork", true, 2000, themes); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordPuzzlePlay(ctx, username, "op-2", "2099-01-01", "p2", "pin", false, 2000, themes); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordPuzzlePlay(ctx, username, "op-3", "2099-01-02", "p3", "fork", true, 2000, themes); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordPuzzlePlay(ctx, username, "op-3", "2099-01-02", "p3", "fork", true, 2000, themes); err != nil {
		t.Fatal(err)
	}

	daily, totals, err := store.StatsDaily(ctx, username, "UTC", "2099-01-02", 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != 2 || daily[0].Puzzles != 2 || daily[1].Puzzles != 1 || totals.Puzzles != 3 || totals.PuzzleWins != 2 {
		t.Fatalf("daily = %+v totals = %+v", daily, totals)
	}
	themeStats, err := store.StatsThemes(ctx, username, "UTC", "2099-01-02", 30)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string][2]int{}
	for _, th := range themeStats {
		got[th.Theme] = [2]int{th.Nb, th.Wins}
	}
	if got["fork"] != [2]int{2, 2} || got["pin"] != [2]int{1, 0} {
		t.Fatalf("themes = %+v", got)
	}
	weekly, err := store.StatsWeekly(ctx, username, "UTC", "2099-01-02", 2)
	if err != nil {
		t.Fatal(err)
	}
	puzzles := 0
	for _, w := range weekly {
		puzzles += w.Puzzles
	}
	if puzzles != 3 {
		t.Fatalf("weekly puzzles = %d", puzzles)
	}
	points, err := store.StatsRating(ctx, username, "2099-01-02", 7)
	if err != nil || len(points) != 2 {
		t.Fatalf("rating points = %+v err = %v", points, err)
	}
	if last, err := store.LastRatingAtOrBefore(ctx, username, "2099-01-02"); err != nil || last == nil || *last != points[1].Rating {
		t.Fatalf("last rating = %v err = %v", last, err)
	}
	days, err := store.ActivityDays(ctx, username, "UTC", "2099-01-02")
	if err != nil || len(days) != 2 {
		t.Fatalf("activity days = %v err = %v", days, err)
	}

	if _, err := store.pool.Exec(ctx, `UPDATE puzzle_plays SET played_at = now() - interval '40 days' WHERE username = $1 AND operation_id = 'op-1'`, username); err != nil {
		t.Fatal(err)
	}
	store.StartCleanupLoop(90*24*time.Hour, 30*24*time.Hour, time.Hour)
	var left int
	if err := store.pool.QueryRow(ctx, `SELECT COUNT(*) FROM puzzle_plays WHERE username = $1`, username).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 2 {
		t.Fatalf("puzzle_plays left after cleanup = %d, want 2", left)
	}
	_, totals, err = store.StatsDaily(ctx, username, "UTC", "2099-01-02", 7)
	if err != nil || totals.Puzzles != 3 {
		t.Fatalf("aggregates changed after cleanup: totals = %+v err = %v", totals, err)
	}
}

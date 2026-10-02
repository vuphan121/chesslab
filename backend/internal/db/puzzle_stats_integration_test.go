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

	daily, totals, err := store.StatsDaily(ctx, username, "2099-01-02", 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(daily) != 2 || daily[0].Puzzles != 2 || daily[1].Puzzles != 1 || daily[0].PuzzlesSolved != 1 || daily[1].PuzzlesSolved != 1 || totals.Puzzles != 3 || totals.PuzzleWins != 2 {
		t.Fatalf("daily = %+v totals = %+v", daily, totals)
	}
	form, err := store.ThemeRecentForm(ctx, username, 100)
	if err != nil || form["fork"] != (ThemeForm{Plays: 2, Wins: 2}) || form["pin"] != (ThemeForm{Plays: 1, Wins: 0}) {
		t.Fatalf("theme form = %+v err = %v", form, err)
	}
	ratings, err := store.PuzzleThemeStats(ctx, username)
	if err != nil {
		t.Fatal(err)
	}
	if ratings["fork"].Attempts != 2 || ratings["pin"].Attempts != 1 {
		t.Fatalf("theme ratings = %+v", ratings)
	}
	checkThemeRange := func(from, to string, want map[string]ThemeRangeStat) {
		t.Helper()
		got, err := store.ThemeRangeStats(ctx, username, from, to)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != len(want) {
			t.Fatalf("theme range %s..%s = %+v, want %d themes", from, to, got, len(want))
		}
		for _, st := range got {
			w, ok := want[st.Theme]
			if !ok || st.Plays != w.Plays || st.Wins != w.Wins || (w.Rating != 0 && st.Rating != w.Rating) || st.Rating == 0 {
				t.Fatalf("theme range %s..%s %s = %+v, want %+v", from, to, st.Theme, st, w)
			}
		}
	}
	checkThemeRange("2099-01-01", "2099-01-02", map[string]ThemeRangeStat{"fork": {Plays: 2, Wins: 2, Rating: ratings["fork"].Rating}, "pin": {Plays: 1, Wins: 0, Rating: ratings["pin"].Rating}})
	checkThemeRange("2099-01-02", "2099-01-02", map[string]ThemeRangeStat{"fork": {Plays: 1, Wins: 1, Rating: ratings["fork"].Rating}})
	checkThemeRange("2099-01-03", "2099-01-09", map[string]ThemeRangeStat{})
	seenAt := time.Now().UTC().Format(time.RFC3339)
	card := map[string]CardProgress{"A": {Box: 1, Seen: 1, Correct: 1, LastSeenISO: &seenAt}}
	delta := map[string]CardProgressDelta{"A": {Seen: 1, Correct: 1}}
	for i, mistake := range []bool{true, true, true, false, false, false, false} {
		chapter := "c1"
		if i >= 4 {
			chapter = "c2"
		}
		attempt := &LineAttempt{ChapterID: chapter, ChapterName: chapter, CardID: "A", HadMistake: mistake, Day: "2099-01-02"}
		if err := store.SaveProgress(ctx, username, "rep", card, delta, attempt, "attempt-"+string(rune('a'+i))); err != nil {
			t.Fatal(err)
		}
	}
	spots, err := store.StatsTroubleSpots(ctx, username, "2099-01-02", 30, 3, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(spots) != 1 || spots[0].ChapterID != "c1" || spots[0].Drills != 4 || spots[0].Mistakes != 3 {
		t.Fatalf("trouble spots = %+v", spots)
	}
	if _, totals, err := store.StatsDaily(ctx, username, "2099-01-02", 7); err != nil || totals.Drills != 7 || totals.DrillMistakes != 3 {
		t.Fatalf("drill totals = %+v err = %v", totals, err)
	}
	points, err := store.StatsRating(ctx, username, "2099-01-02", 7)
	if err != nil || len(points) != 2 {
		t.Fatalf("rating points = %+v err = %v", points, err)
	}
	if last, err := store.LastRatingAtOrBefore(ctx, username, "2099-01-02"); err != nil || last == nil || *last != points[1].Rating {
		t.Fatalf("last rating = %v err = %v", last, err)
	}
	days, err := store.ActivityDays(ctx, username, "2099-01-02")
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
	_, totals, err = store.StatsDaily(ctx, username, "2099-01-02", 7)
	if err != nil || totals.Puzzles != 3 {
		t.Fatalf("aggregates changed after cleanup: totals = %+v err = %v", totals, err)
	}
	checkThemeRange("2099-01-01", "2099-01-02", map[string]ThemeRangeStat{"fork": {Plays: 2, Wins: 2, Rating: ratings["fork"].Rating}, "pin": {Plays: 1, Wins: 0, Rating: ratings["pin"].Rating}})
}

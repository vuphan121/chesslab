package db

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestLineHistoryFollowsSavedRuns(t *testing.T) {
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

	const username = "__chesslab_card_history_test__"
	_, _ = store.pool.Exec(ctx, `DELETE FROM users WHERE username = $1`, username)
	defer func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM users WHERE username = $1`, username)
	}()
	if _, err := store.pool.Exec(ctx, `INSERT INTO users (username, password_hash) VALUES ($1, 'unused')`, username); err != nil {
		t.Fatal(err)
	}

	seen := time.Now().UTC().Format(time.RFC3339)
	line := func(op string, mistake bool) {
		attempt := &LineAttempt{ChapterID: "c", ChapterName: "c", CardID: "A", HadMistake: mistake, Day: "2099-01-05", LineID: "c:e4 e5"}
		if err := store.SaveProgress(ctx, username, "rep", map[string]CardProgress{"A": {Box: 1, Seen: 1, Correct: 1, LastSeenISO: &seen}}, map[string]CardProgressDelta{"A": {Seen: 1, Correct: 1}}, attempt, op); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 5; i++ {
		line("line-"+string(rune('a'+i)), false)
	}
	lines, err := store.LineHistories(ctx, username)
	if err != nil || lines["rep"]["c:e4 e5"] != (CardHistory{Bits: 31, N: 5}) {
		t.Fatalf("line history after five clean runs = %+v err = %v", lines, err)
	}
	line("line-miss", true)
	lines, err = store.LineHistories(ctx, username)
	if err != nil || lines["rep"]["c:e4 e5"] != (CardHistory{Bits: 30, N: 5}) {
		t.Fatalf("line history after a mistake = %+v err = %v", lines, err)
	}

	if ok, err := store.SeedLineHistory(ctx, username, "rep", "c:seed", 15, 4); err != nil || !ok {
		t.Fatalf("seed = %v err = %v", ok, err)
	}
	if ok, err := store.SeedLineHistory(ctx, username, "rep", "c:seed", 0, 1); err != nil || ok {
		t.Fatalf("second seed must not overwrite: ok = %v err = %v", ok, err)
	}
	lines, err = store.LineHistories(ctx, username)
	if err != nil || lines["rep"]["c:seed"] != (CardHistory{Bits: 15, N: 4}) {
		t.Fatalf("seeded history = %+v err = %v", lines, err)
	}
}

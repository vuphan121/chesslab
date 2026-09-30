package db

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestAdvanceTodayTrainingIsIdempotent(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	const username = "__chesslab_today_training_idempotency_test__"
	_, _ = store.pool.Exec(ctx, `DELETE FROM users WHERE username = $1`, username)
	defer func() {
		_, _ = store.pool.Exec(context.Background(), `DELETE FROM users WHERE username = $1`, username)
	}()
	if _, err := store.pool.Exec(ctx, `INSERT INTO users (username, password_hash) VALUES ($1, 'unused')`, username); err != nil {
		t.Fatal(err)
	}
	entries := []TodayTrainingEntry{
		{RepertoireID: "rep", CardID: "A"},
		{RepertoireID: "rep", CardID: "B"},
		{RepertoireID: "rep", CardID: "C"},
	}
	if _, err := store.SaveTodayTraining(ctx, username, "2099-01-01", TodayTrainingSettings{RepertoireIDs: []string{"rep"}, LinesPerDay: 1}, entries); err != nil {
		t.Fatal(err)
	}

	first, err := store.AdvanceTodayTraining(ctx, username, "2099-01-01", "rep", "A", "stable-operation-id")
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := store.AdvanceTodayTraining(ctx, username, "2099-01-01", "rep", "A", "stable-operation-id")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"B", "C", "A"}
	for name, queue := range map[string]TodayTrainingQueue{"first": first, "duplicate": duplicate} {
		if len(queue.Entries) != len(want) {
			t.Fatalf("%s advance returned %d entries, want %d", name, len(queue.Entries), len(want))
		}
		for i, cardID := range want {
			if queue.Entries[i].CardID != cardID {
				t.Fatalf("%s advance order at %d = %q, want %q", name, i, queue.Entries[i].CardID, cardID)
			}
		}
	}
}

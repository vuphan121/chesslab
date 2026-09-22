package storage

import (
	"testing"
	"time"

	"github.com/chesslab/backend/internal/chess"
)

func TestMemoryExpiresInactiveGames(t *testing.T) {
	now := time.Date(2026, time.September, 21, 0, 0, 0, 0, time.UTC)
	store := newMemory(time.Hour, 10, func() time.Time { return now })
	store.Save(chess.NewGame("old"))

	now = now.Add(time.Hour)
	if _, ok := store.Get("old"); ok {
		t.Fatal("expired game remained in the store")
	}
}

func TestMemoryEvictsLeastRecentlyUsedGameAtCapacity(t *testing.T) {
	now := time.Date(2026, time.September, 21, 0, 0, 0, 0, time.UTC)
	store := newMemory(24*time.Hour, 2, func() time.Time { return now })
	store.Save(chess.NewGame("oldest"))
	now = now.Add(time.Minute)
	store.Save(chess.NewGame("recent"))
	now = now.Add(time.Minute)
	if _, ok := store.Get("oldest"); !ok {
		t.Fatal("expected oldest game to exist before eviction")
	}
	now = now.Add(time.Minute)
	store.Save(chess.NewGame("new"))

	if _, ok := store.Get("recent"); ok {
		t.Fatal("least recently used game was not evicted")
	}
	if _, ok := store.Get("oldest"); !ok {
		t.Fatal("recently accessed game was evicted")
	}
}

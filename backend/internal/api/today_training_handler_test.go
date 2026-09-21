package api

import (
	"testing"

	"github.com/chesslab/backend/internal/db"
)

func TestShuffleTodayTrainingEntriesKeepsEveryEntry(t *testing.T) {
	entries := []db.TodayTrainingEntry{
		{RepertoireID: "rep", CardID: "A"},
		{RepertoireID: "rep", CardID: "B"},
		{RepertoireID: "rep", CardID: "C"},
		{RepertoireID: "rep", CardID: "D"},
	}

	shuffled := shuffleTodayTrainingEntries(entries, func(int) int { return 0 })
	if len(shuffled) != len(entries) {
		t.Fatalf("got %d entries, want %d", len(shuffled), len(entries))
	}
	if shuffled[0].CardID == entries[0].CardID && shuffled[1].CardID == entries[1].CardID {
		t.Fatal("expected deterministic test shuffle to change the order")
	}
	seen := map[string]bool{}
	for _, entry := range shuffled {
		seen[entry.CardID] = true
	}
	for _, entry := range entries {
		if !seen[entry.CardID] {
			t.Fatalf("shuffle dropped entry %q", entry.CardID)
		}
	}
}

func TestSameTodayTrainingEntriesIgnoresOrderButRequiresFullSet(t *testing.T) {
	first := []db.TodayTrainingEntry{
		{RepertoireID: "one", CardID: "A"},
		{RepertoireID: "two", CardID: "B"},
	}
	reordered := []db.TodayTrainingEntry{first[1], first[0]}
	if !sameTodayTrainingEntries(first, reordered) {
		t.Fatal("same entries in a different queue order should match")
	}
	if sameTodayTrainingEntries(first, first[:1]) {
		t.Fatal("a partial queue should not match the full entry set")
	}
}

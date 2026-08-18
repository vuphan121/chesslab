package api

import (
	"testing"
	"time"

	"github.com/chesslab/backend/internal/db"
)

func TestDailyUrgencyPrioritizesOverdueCards(t *testing.T) {
	now := time.Date(2026, time.August, 18, 12, 0, 0, 0, time.UTC)
	recent := now.Add(-24 * time.Hour).Format(time.RFC3339)
	overdue := now.Add(-16 * 24 * time.Hour).Format(time.RFC3339)
	if dailyUrgency(db.CardProgress{Box: 2, Seen: 4, LastSeenISO: &overdue}, now) <= dailyUrgency(db.CardProgress{Box: 2, Seen: 4, LastSeenISO: &recent}, now) {
		t.Fatal("expected overdue card to have higher urgency")
	}
}

func TestDailyUrgencyGivesNewCardsAStartingPriority(t *testing.T) {
	now := time.Date(2026, time.August, 18, 12, 0, 0, 0, time.UTC)
	if got := dailyUrgency(db.CardProgress{}, now); got != 4 {
		t.Fatalf("new card urgency = %d, want 4", got)
	}
}

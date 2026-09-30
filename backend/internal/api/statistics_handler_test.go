package api

import "testing"

func TestStreaks(t *testing.T) {
	days := []string{"2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10", "2026-09-28", "2026-09-29"}
	cur, best := streaks(days, "2026-09-30")
	if cur != 2 || best != 3 {
		t.Fatalf("today empty: got current=%d best=%d, want 2 and 3", cur, best)
	}
	cur, _ = streaks(days, "2026-09-29")
	if cur != 2 {
		t.Fatalf("today active: got current=%d, want 2", cur)
	}
	cur, _ = streaks(days, "2026-10-02")
	if cur != 0 {
		t.Fatalf("gap of two days: got current=%d, want 0", cur)
	}
}

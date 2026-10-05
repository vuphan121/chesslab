package api

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestResolvePlayedAt(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		raw  string
		want time.Time
	}{
		{"empty uses now", "", now},
		{"garbage uses now", "not a time", now},
		{"recent is kept", "2026-10-05T09:30:00Z", time.Date(2026, 10, 5, 9, 30, 0, 0, time.UTC)},
		{"offset is kept", "2026-10-05T16:30:00+07:00", time.Date(2026, 10, 5, 9, 30, 0, 0, time.UTC)},
		{"small clock skew is kept", "2026-10-05T12:03:00Z", time.Date(2026, 10, 5, 12, 3, 0, 0, time.UTC)},
		{"future beyond skew uses now", "2026-10-05T12:30:00Z", now},
		{"older than the limit uses now", "2026-09-01T00:00:00Z", now},
		{"just inside the limit is kept", "2026-09-22T12:00:01Z", time.Date(2026, 9, 22, 12, 0, 1, 0, time.UTC)},
	}
	for _, c := range cases {
		if got := resolvePlayedAt(c.raw, now); !got.Equal(c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestPlayedAtDayUsesTheUsersTimeZone(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/puzzles/result", nil)
	req.Header.Set(timeZoneHeader, "Asia/Ho_Chi_Minh")
	playedAt := resolvePlayedAt("2026-10-05T18:30:00Z", time.Date(2026, 10, 5, 19, 0, 0, 0, time.UTC))
	if got := localRequestClock(req, playedAt).date; got != "2026-10-06" {
		t.Errorf("a play at 18:30Z is already the next day in Ho Chi Minh, got %s", got)
	}
	req.Header.Set(timeZoneHeader, "UTC")
	if got := localRequestClock(req, playedAt).date; got != "2026-10-05" {
		t.Errorf("same play in UTC should be 2026-10-05, got %s", got)
	}
}

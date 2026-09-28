package api

import (
	"testing"
	"time"
)

func TestParsePlayedAt(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		raw  string
		want *time.Time
	}{
		{"empty falls back to server time", "", nil},
		{"garbage falls back", "yesterday", nil},
		{"recent offline attempt is kept", "2026-09-28T09:15:00Z", ptr(time.Date(2026, 9, 28, 9, 15, 0, 0, time.UTC))},
		{"offset is normalised to UTC", "2026-09-28T16:15:00+07:00", ptr(time.Date(2026, 9, 28, 9, 15, 0, 0, time.UTC))},
		{"a few minutes of clock skew is tolerated", "2026-09-28T12:03:00Z", ptr(time.Date(2026, 9, 28, 12, 3, 0, 0, time.UTC))},
		{"the future beyond skew is rejected", "2026-09-28T13:00:00Z", nil},
		{"older than the age cap is rejected", "2026-07-01T00:00:00Z", nil},
	}
	for _, c := range cases {
		got := parsePlayedAt(c.raw, now)
		switch {
		case got == nil && c.want == nil:
		case got == nil || c.want == nil || !got.Equal(*c.want):
			t.Errorf("%s: parsePlayedAt(%q) = %v, want %v", c.name, c.raw, got, c.want)
		}
	}
}

func ptr(t time.Time) *time.Time { return &t }

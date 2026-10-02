package api

import (
	"net/http/httptest"
	"testing"
)

func TestStatsRange(t *testing.T) {
	const today = "2026-10-02"
	cases := []struct {
		name     string
		query    string
		from, to string
		days     int
		wantErr  bool
	}{
		{"explicit range", "from=2026-09-28&to=2026-10-02", "2026-09-28", "2026-10-02", 5, false},
		{"single day", "from=2026-10-02&to=2026-10-02", "2026-10-02", "2026-10-02", 1, false},
		{"future end is clamped to today", "from=2026-10-01&to=2030-01-01", "2026-10-01", "2026-10-02", 2, false},
		{"from after to is pulled to to", "from=2026-10-02&to=2026-09-20", "2026-09-20", "2026-09-20", 1, false},
		{"from after the clamped end is pulled to it", "from=2027-01-01&to=2030-01-01", "2026-10-02", "2026-10-02", 1, false},
		{"span is capped at 366 days", "from=2020-01-01&to=2026-10-02", "2025-10-02", "2026-10-02", 366, false},
		{"exactly 366 days is kept", "from=2025-10-02&to=2026-10-02", "2025-10-02", "2026-10-02", 366, false},
		{"bad from", "from=nope&to=2026-10-02", "", "", 0, true},
		{"bad to", "from=2026-10-01&to=2026-13-40", "", "", 0, true},
		{"only from given", "from=2026-10-01", "", "", 0, true},
		{"only to given", "to=2026-10-01", "", "", 0, true},
		{"no params defaults to 30 days", "", "2026-09-03", "2026-10-02", 30, false},
		{"legacy days", "days=7", "2026-09-26", "2026-10-02", 7, false},
		{"legacy days out of range falls back to 30", "days=9999", "2026-09-03", "2026-10-02", 30, false},
		{"legacy days garbage falls back to 30", "days=abc", "2026-09-03", "2026-10-02", 30, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/statistics?"+c.query, nil)
			from, to, days, err := statsRange(r, today)
			if c.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %s..%s (%d days)", from, to, days)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if from != c.from || to != c.to || days != c.days {
				t.Fatalf("got %s..%s (%d days), want %s..%s (%d days)", from, to, days, c.from, c.to, c.days)
			}
		})
	}
}

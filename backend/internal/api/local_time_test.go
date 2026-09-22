package api

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestLocalRequestClockUsesBrowserTimeZone(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set(timeZoneHeader, "Asia/Bangkok")
	now := time.Date(2026, time.September, 20, 18, 30, 0, 0, time.UTC)

	clock := localRequestClock(r, now)
	if clock.date != "2026-09-21" || clock.timeZone != "Asia/Bangkok" {
		t.Fatalf("got %+v", clock)
	}
}

func TestLocalRequestClockFallsBackToUTC(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set(timeZoneHeader, "not/a-zone")
	now := time.Date(2026, time.September, 20, 18, 30, 0, 0, time.UTC)

	clock := localRequestClock(r, now)
	if clock.date != "2026-09-20" || clock.timeZone != "UTC" {
		t.Fatalf("got %+v", clock)
	}
}

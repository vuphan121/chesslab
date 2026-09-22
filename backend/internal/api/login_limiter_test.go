package api

import (
	"testing"
	"time"
)

func TestLoginLimiterBlocksAndResets(t *testing.T) {
	now := time.Date(2026, time.September, 21, 0, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(2, time.Minute, func() time.Time { return now })
	limiter.failure("client")
	limiter.failure("client")
	if allowed, _ := limiter.allowed("client"); allowed {
		t.Fatal("expected client to be rate limited")
	}

	now = now.Add(time.Minute)
	if allowed, _ := limiter.allowed("client"); !allowed {
		t.Fatal("expected rate limit window to expire")
	}
	limiter.failure("client")
	limiter.success("client")
	if allowed, _ := limiter.allowed("client"); !allowed {
		t.Fatal("expected successful login to clear failures")
	}
}

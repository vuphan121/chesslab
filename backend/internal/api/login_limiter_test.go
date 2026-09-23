package api

import (
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLoginLimiterBlocksAndResets(t *testing.T) {
	now := time.Date(2026, time.September, 21, 0, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(2, time.Minute, func() time.Time { return now })

	if allowed, _ := limiter.reserve("client"); !allowed {
		t.Fatal("expected first attempt to be allowed")
	}
	if allowed, _ := limiter.reserve("client"); !allowed {
		t.Fatal("expected second attempt to be allowed")
	}
	if allowed, _ := limiter.reserve("client"); allowed {
		t.Fatal("expected client to be rate limited after 2 attempts")
	}

	now = now.Add(time.Minute)
	if allowed, _ := limiter.reserve("client"); !allowed {
		t.Fatal("expected rate limit window to expire")
	}

	limiter.success("client")
	if allowed, _ := limiter.reserve("client"); !allowed {
		t.Fatal("expected successful login to clear failures")
	}
}

// Regression test for the check-then-act race: reserve must check and
// increment each client's count atomically.
func TestLoginLimiterReserveIsAtomicUnderConcurrency(t *testing.T) {
	limiter := newLoginLimiter(5, time.Minute, time.Now)
	const attempts = 50
	var wg sync.WaitGroup
	var allowedCount int32
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if allowed, _ := limiter.reserve("client"); allowed {
				atomic.AddInt32(&allowedCount, 1)
			}
		}()
	}
	wg.Wait()
	if allowedCount != 5 {
		t.Fatalf("expected exactly 5 reservations to succeed under concurrent load, got %d", allowedCount)
	}
}

func TestLoginClientKeyUsesForwardedClientIP(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/login", nil)
	r.RemoteAddr = "10.0.0.2:4321"
	r.Header.Set("X-Forwarded-For", "203.0.113.8, 10.0.0.2")
	if got := loginClientKey(r); got != "203.0.113.8" {
		t.Fatalf("loginClientKey = %q", got)
	}
}

func TestLoginClientKeyFallsBackToRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/login", nil)
	r.RemoteAddr = "192.0.2.4:4321"
	if got := loginClientKey(r); got != "192.0.2.4" {
		t.Fatalf("loginClientKey = %q", got)
	}
}

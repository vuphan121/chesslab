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

// Fallback path (no CF-Connecting-IP/True-Client-IP present): assumes a
// single trusted proxy hop that appends the connecting address it actually
// saw to whatever X-Forwarded-For the caller sent, rather than discarding
// it — so the right-most entry is the one that hop itself appended
// (trustworthy); a caller can prepend anything it likes before that.
// RemoteAddr is deliberately set to something OTHER than the expected
// answer, so this can't pass by silently falling through to the
// RemoteAddr fallback instead of actually parsing the header.
func TestLoginClientKeyUsesRightmostForwardedIP(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/login", nil)
	r.RemoteAddr = "203.0.113.8:4321"
	r.Header.Set("X-Forwarded-For", "203.0.113.8, 10.0.0.2")
	if got := loginClientKey(r); got != "10.0.0.2" {
		t.Fatalf("loginClientKey = %q, want the proxy-appended (right-most) entry", got)
	}
}

// Regression test: a caller must not be able to get a fresh rate-limit
// bucket on every request just by sending a different fake left-most
// X-Forwarded-For entry — that made the login limiter a no-op. RemoteAddr
// is deliberately NOT the shared right-most entry, so this can't pass via
// the RemoteAddr fallback either.
func TestLoginClientKeyIgnoresSpoofedLeftmostEntry(t *testing.T) {
	r1 := httptest.NewRequest("POST", "/api/login", nil)
	r1.RemoteAddr = "203.0.113.1:4321"
	r1.Header.Set("X-Forwarded-For", "1.1.1.1, 10.0.0.2")

	r2 := httptest.NewRequest("POST", "/api/login", nil)
	r2.RemoteAddr = "203.0.113.2:4321"
	r2.Header.Set("X-Forwarded-For", "2.2.2.2, 10.0.0.2")

	key1, key2 := loginClientKey(r1), loginClientKey(r2)
	if key1 != key2 {
		t.Fatalf("loginClientKey differed for the same real client with only the spoofed entry changed: %q vs %q", key1, key2)
	}
	if key1 != "10.0.0.2" {
		t.Fatalf("loginClientKey = %q, want the shared proxy-appended entry", key1)
	}
}

func TestLoginClientKeyFallsBackToRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/login", nil)
	r.RemoteAddr = "192.0.2.4:4321"
	if got := loginClientKey(r); got != "192.0.2.4" {
		t.Fatalf("loginClientKey = %q", got)
	}
}

// CF-Connecting-IP, when present, is preferred over X-Forwarded-For
// entirely — it's set authoritatively by a fronting Cloudflare edge, which
// discards any client-supplied value of the same header name.
func TestLoginClientKeyPrefersCFConnectingIP(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/login", nil)
	r.RemoteAddr = "10.0.0.2:4321"
	r.Header.Set("X-Forwarded-For", "1.1.1.1, 10.0.0.2")
	r.Header.Set("CF-Connecting-IP", "198.51.100.7")
	if got := loginClientKey(r); got != "198.51.100.7" {
		t.Fatalf("loginClientKey = %q, want CF-Connecting-IP to win", got)
	}
}

// True-Client-IP is the second preference, used when CF-Connecting-IP is
// absent but a CDN still set this alternative header.
func TestLoginClientKeyFallsBackToTrueClientIP(t *testing.T) {
	r := httptest.NewRequest("POST", "/api/login", nil)
	r.RemoteAddr = "10.0.0.2:4321"
	r.Header.Set("X-Forwarded-For", "1.1.1.1, 10.0.0.2")
	r.Header.Set("True-Client-IP", "198.51.100.9")
	if got := loginClientKey(r); got != "198.51.100.9" {
		t.Fatalf("loginClientKey = %q, want True-Client-IP to win over X-Forwarded-For", got)
	}
}

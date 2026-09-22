package api

import (
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

// Regression test for the check-then-act race: allowed()/failure() used to
// be two separate lock acquisitions with real work (the credential check)
// happening in between, so concurrent requests could all pass the check
// before any of them recorded an attempt. reserve() closes that by checking
// and incrementing atomically in one critical section.
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

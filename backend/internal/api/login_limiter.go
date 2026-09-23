package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type loginAttempt struct {
	count       int
	windowStart time.Time
}

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string]loginAttempt
	limit    int
	window   time.Duration
	now      func() time.Time
}

func newLoginLimiter(limit int, window time.Duration, now func() time.Time) *loginLimiter {
	return &loginLimiter{attempts: make(map[string]loginAttempt), limit: limit, window: window, now: now}
}

// reserve atomically checks the caller is under the limit AND records this
// attempt in one critical section. Splitting that into a separate
// allowed()-then-failure() pair (the earlier shape) left a check-then-act
// race: concurrent requests can all pass the check before any of them
// records a failure, so a burst of parallel attempts defeats the limit
// entirely — only sequential attempts were actually throttled. success()
// still clears the window on a correct login.
func (l *loginLimiter) reserve(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	entry, ok := l.attempts[key]
	if !ok || now.Sub(entry.windowStart) >= l.window {
		entry = loginAttempt{windowStart: now}
	}
	if entry.count >= l.limit {
		return false, l.window - now.Sub(entry.windowStart)
	}
	entry.count++
	l.attempts[key] = entry
	if len(l.attempts) > 2048 {
		for candidate, attempt := range l.attempts {
			if now.Sub(attempt.windowStart) >= l.window {
				delete(l.attempts, candidate)
			}
		}
		if len(l.attempts) > 2048 {
			var oldestKey string
			var oldest time.Time
			for candidate, attempt := range l.attempts {
				if oldestKey == "" || attempt.windowStart.Before(oldest) {
					oldestKey = candidate
					oldest = attempt.windowStart
				}
			}
			delete(l.attempts, oldestKey)
		}
	}
	return true, 0
}

func (l *loginLimiter) success(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}

func loginClientKey(r *http.Request) string {
	// How many hops actually sit between a real client and this app on
	// Render is NOT reliably documented — Render's own community has open,
	// unresolved threads on this (some report the edge sets the first XFF
	// entry to the real client IP, others report it only appends; whether
	// Render's DDoS layer is a Cloudflare-fronted HTTP hop that touches XFF
	// at all is also unclear). Getting the hop count wrong either direction
	// is a real problem: too few hops trusted re-opens the spoofable-bypass
	// bug this function exists to close; too many collapses unrelated users
	// into one shared-fate lockout bucket. This has NOT been empirically
	// verified against this app's live Render deployment (e.g. by logging
	// the raw headers on a real request) — that verification is still owed.
	//
	// So: prefer a header a fronting Cloudflare sets itself, authoritatively,
	// at its own edge, discarding any client-supplied value of the same
	// name — CF-Connecting-IP is not attacker-controlled *for traffic that
	// actually passed through Cloudflare* (a caller who reached the origin
	// directly, bypassing Cloudflare, could still forge it, but that's a
	// separate origin-shielding concern this app doesn't currently control).
	// This is strictly additive: if Cloudflare isn't in front of this
	// request, the header is simply absent and we fall through.
	if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); ip != nil {
		return ip.String()
	}
	if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("True-Client-IP"))); ip != nil {
		return ip.String()
	}
	// Fallback: assume a single trusted hop (Render's own edge, no
	// Cloudflare) that appends the connecting address to whatever
	// X-Forwarded-For the caller sent rather than discarding it — so the
	// RIGHT-most parseable entry is the one that hop itself appended
	// (trustworthy); any earlier entry is attacker-supplied. This is the
	// part still awaiting live verification noted above.
	candidates := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(candidates) - 1; i >= 0; i-- {
		if ip := net.ParseIP(strings.TrimSpace(candidates[i])); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

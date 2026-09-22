package api

import (
	"net"
	"net/http"
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

func (l *loginLimiter) allowed(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.attempts[key]
	now := l.now()
	if !ok || now.Sub(entry.windowStart) >= l.window {
		return true, 0
	}
	if entry.count < l.limit {
		return true, 0
	}
	return false, l.window - now.Sub(entry.windowStart)
}

func (l *loginLimiter) failure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	entry, ok := l.attempts[key]
	if !ok || now.Sub(entry.windowStart) >= l.window {
		entry = loginAttempt{windowStart: now}
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
}

func (l *loginLimiter) success(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}

func loginClientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

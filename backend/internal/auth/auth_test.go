package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func testConfig() Config {
	return Config{Username: "u", Password: "p", JWTSecret: []byte("test-secret")}
}

func tokenIssuedAt(t *testing.T, c Config, issued time.Time, ttl time.Duration) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   "u",
		IssuedAt:  jwt.NewNumericDate(issued),
		ExpiresAt: jwt.NewNumericDate(issued.Add(ttl)),
	})
	s, err := tok.SignedString(c.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func serve(c Config, token string) *httptest.ResponseRecorder {
	h := c.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestFreshTokenIsNotRefreshed(t *testing.T) {
	c := testConfig()
	rec := serve(c, tokenIssuedAt(t, c, time.Now().Add(-time.Hour), tokenTTL))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get(RefreshedTokenHeader); got != "" {
		t.Fatalf("unexpected refreshed token %q for a token under %s old", got, refreshAfter)
	}
}

func TestOldTokenIsRefreshedWithFullLifetime(t *testing.T) {
	c := testConfig()
	rec := serve(c, tokenIssuedAt(t, c, time.Now().Add(-10*24*time.Hour), tokenTTL))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	fresh := rec.Header().Get(RefreshedTokenHeader)
	if fresh == "" {
		t.Fatal("expected a refreshed token for a 10-day-old token")
	}
	claims, err := c.parseToken(fresh)
	if err != nil {
		t.Fatalf("refreshed token invalid: %v", err)
	}
	if claims.Subject != "u" {
		t.Fatalf("subject = %q, want u", claims.Subject)
	}
	if left := time.Until(claims.ExpiresAt.Time); left < tokenTTL-time.Minute {
		t.Fatalf("refreshed token has %s left, want about %s", left, tokenTTL)
	}
	if again := serve(c, fresh); again.Header().Get(RefreshedTokenHeader) != "" {
		t.Fatal("a just-refreshed token must not be refreshed again")
	}
}

func TestExpiredTokenIsRejectedAndNotRefreshed(t *testing.T) {
	c := testConfig()
	rec := serve(c, tokenIssuedAt(t, c, time.Now().Add(-31*24*time.Hour), tokenTTL))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if got := rec.Header().Get(RefreshedTokenHeader); got != "" {
		t.Fatalf("expired token must not be refreshed, got %q", got)
	}
}

func TestTokenWithoutIssuedAtIsNotRefreshed(t *testing.T) {
	c := testConfig()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   "u",
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	s, _ := tok.SignedString(c.JWTSecret)
	rec := serve(c, s)
	if rec.Code != http.StatusOK || rec.Header().Get(RefreshedTokenHeader) != "" {
		t.Fatalf("status = %d, header = %q", rec.Code, rec.Header().Get(RefreshedTokenHeader))
	}
}

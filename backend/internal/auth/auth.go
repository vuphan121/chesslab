// Package auth is a deliberately small gate — one login (no signup flow),
// a JWT so the backend stays stateless between requests, and a middleware
// that protects everything except the login route itself and /healthz. The
// actual credential — a bcrypt hash in Postgres's `users` table, seeded
// from AUTH_USERNAME/AUTH_PASSWORD at boot — lives in internal/db (see
// db.SeedUser/VerifyUser); this package only holds the env-var fallback
// used when no database is configured (local dev) and the JWT issue/verify
// logic. If this ever needs more than one person behind it, replace the
// fallback with real signup, not extend it in place.
package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

const tokenTTL = 30 * 24 * time.Hour // long-lived — single personal user, not worth re-logging-in often

type Config struct {
	Username  string
	Password  string
	JWTSecret []byte
}

// CheckCredentials is a constant-time comparison against the one configured
// user, to avoid a timing side-channel on the username/password check.
func (c Config) CheckCredentials(username, password string) bool {
	userOK := subtle.ConstantTimeCompare([]byte(username), []byte(c.Username)) == 1
	passOK := subtle.ConstantTimeCompare([]byte(password), []byte(c.Password)) == 1
	return userOK && passOK
}

func (c Config) IssueToken(username string) (string, error) {
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   username,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
	})
	return token.SignedString(c.JWTSecret)
}

func (c Config) VerifyToken(tokenString string) (string, error) {
	parsed, err := jwt.ParseWithClaims(tokenString, &jwt.RegisteredClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return c.JWTSecret, nil
	})
	if err != nil || !parsed.Valid {
		return "", ErrInvalidCredentials
	}
	claims, ok := parsed.Claims.(*jwt.RegisteredClaims)
	if !ok || claims.Subject == "" {
		return "", ErrInvalidCredentials
	}
	return claims.Subject, nil
}

type ctxKey int

const usernameKey ctxKey = iota

// Middleware validates "Authorization: Bearer <token>" and stashes the
// username in the request context for handlers to read via
// UsernameFromContext. Only wired onto routes that need it (see routes.go) —
// /api/auth/login and /healthz stay outside this group.
func (c Config) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenString, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || tokenString == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		username, err := c.VerifyToken(tokenString)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), usernameKey, username)))
	})
}

func UsernameFromContext(ctx context.Context) (string, bool) {
	username, ok := ctx.Value(usernameKey).(string)
	return username, ok
}

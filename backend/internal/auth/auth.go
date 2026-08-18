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

const tokenTTL = 30 * 24 * time.Hour

type Config struct {
	Username  string
	Password  string
	JWTSecret []byte
}

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

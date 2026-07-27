package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// SeedUser upserts a username's password hash — called once at boot from
// AUTH_USERNAME/AUTH_PASSWORD env vars (see main.go), so rotating the
// password later is just "change the env var, redeploy," not a manual
// SQL statement.
func (s *Store) SeedUser(ctx context.Context, username, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (username, password_hash) VALUES ($1, $2)
		ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
		username, hash)
	if err != nil {
		return fmt.Errorf("upsert user: %w", err)
	}
	return nil
}

// VerifyUser checks a login attempt against the stored bcrypt hash. A
// nonexistent username returns (false, nil), same as a wrong password —
// the caller shouldn't be able to distinguish the two from the error alone.
func (s *Store) VerifyUser(ctx context.Context, username, password string) (bool, error) {
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE username = $1`, username).Scan(&hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("query user: %w", err)
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil, nil
}

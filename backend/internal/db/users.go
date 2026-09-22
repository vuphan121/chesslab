package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

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

// dummyHash lets VerifyUser run a bcrypt compare of comparable cost even
// when the username doesn't exist, so a missing user isn't measurably
// faster to reject than a real one with a wrong password — without this,
// response timing alone reveals whether a given username is valid.
var dummyHash = mustDummyHash()

func mustDummyHash() []byte {
	h, err := bcrypt.GenerateFromPassword([]byte("chesslab-timing-guard"), bcrypt.DefaultCost)
	if err != nil {
		panic(fmt.Errorf("generate dummy bcrypt hash: %w", err))
	}
	return h
}

func (s *Store) VerifyUser(ctx context.Context, username, password string) (bool, error) {
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE username = $1`, username).Scan(&hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
			return false, nil
		}
		return false, fmt.Errorf("query user: %w", err)
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil, nil
}

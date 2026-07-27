// Package db is the Postgres-backed persistence layer for cross-device
// trainer sync — a Neon-hosted database, connected via pgx. Everything else
// in this backend (games, opening theory, repertoire data) is either
// in-memory or loaded fresh from committed files on boot; this is the one
// package that actually needs a durable store, since trainer progress must
// survive backend restarts and follow the user across devices (see root
// CLAUDE.md's "Server-side trainer sync" section for why localStorage alone
// wasn't enough).
package db

import (
	"context"
	_ "embed"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

type Store struct {
	pool *pgxpool.Pool
}

// Connect opens the pool and runs the (idempotent, CREATE-IF-NOT-EXISTS)
// schema migration. No separate migration tool — the schema is tiny and
// additive-only so far; if that stops being true, revisit.
func Connect(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	s := &Store{pool: pool}
	if err := s.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

// migrate execs schema.sql one statement at a time — pgx's simple-exec path
// can run multiple ;-separated statements at once when there are no query
// args, but splitting explicitly keeps error messages pointing at the
// actual failing statement instead of the whole file. Comment-only lines
// are stripped first: schema.sql's comments are prose and can contain their
// own semicolons, which a naive split-on-";" would otherwise treat as
// statement boundaries too.
func (s *Store) migrate(ctx context.Context) error {
	var sqlOnly strings.Builder
	for _, line := range strings.Split(schemaSQL, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		sqlOnly.WriteString(line)
		sqlOnly.WriteString("\n")
	}

	for _, stmt := range strings.Split(sqlOnly.String(), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := s.pool.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt, err)
		}
	}
	return nil
}

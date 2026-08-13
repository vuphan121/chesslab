package db

import (
	"context"
	"encoding/json"
	"fmt"
)

// SaveBook upserts a book's raw JSON blob by id. Written by `cmd/seedbooks`,
// not a runtime HTTP handler — there's no user-facing "upload a book" flow,
// this is a one-off admin action run locally against whichever DATABASE_URL
// you point it at (local dev DB or the production one).
func (s *Store) SaveBook(ctx context.Context, id string, data json.RawMessage) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO books (id, data, updated_at) VALUES ($1, $2, now())
		ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
	`, id, data)
	if err != nil {
		return fmt.Errorf("save book %q: %w", id, err)
	}
	return nil
}

// LoadBooks returns every stored book's raw JSON, for
// internal/book.ParseAndValidate to unmarshal/validate exactly the same way
// it validates a file loaded from disk.
func (s *Store) LoadBooks(ctx context.Context) ([]json.RawMessage, error) {
	rows, err := s.pool.Query(ctx, `SELECT data FROM books ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("load books: %w", err)
	}
	defer rows.Close()

	var out []json.RawMessage
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan book row: %w", err)
		}
		out = append(out, raw)
	}
	return out, rows.Err()
}

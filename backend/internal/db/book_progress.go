package db

import (
	"context"
	"fmt"
)

// GetBookProgress returns the set of item ids the user has completed in the
// given book — an empty map (not an error) if nothing's been done yet.
func (s *Store) GetBookProgress(ctx context.Context, username, bookID string) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT item_id FROM book_item_progress
		WHERE username = $1 AND book_id = $2`,
		username, bookID)
	if err != nil {
		return nil, fmt.Errorf("query book_item_progress: %w", err)
	}
	defer rows.Close()

	out := make(map[string]bool)
	for rows.Next() {
		var itemID string
		if err := rows.Scan(&itemID); err != nil {
			return nil, fmt.Errorf("scan book_item_progress: %w", err)
		}
		out[itemID] = true
	}
	return out, rows.Err()
}

// MarkItemDone records an explicitly completed item — idempotent, a re-mark
// of an already-done item is a no-op rather than an error.
func (s *Store) MarkItemDone(ctx context.Context, username, bookID, itemID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO book_item_progress (username, book_id, item_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (username, book_id, item_id) DO NOTHING`,
		username, bookID, itemID)
	if err != nil {
		return fmt.Errorf("upsert book_item_progress: %w", err)
	}
	return nil
}

package db

import (
	"context"
	"fmt"
	"time"
)

type SavedPuzzle struct {
	ID        int64     `json:"id"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Store) ListSavedPuzzles(ctx context.Context, username string) ([]SavedPuzzle, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, url, created_at
		FROM saved_puzzles
		WHERE username = $1
		ORDER BY created_at DESC, id DESC`, username)
	if err != nil {
		return nil, fmt.Errorf("query saved puzzles: %w", err)
	}
	defer rows.Close()

	puzzles := make([]SavedPuzzle, 0)
	for rows.Next() {
		var puzzle SavedPuzzle
		if err := rows.Scan(&puzzle.ID, &puzzle.URL, &puzzle.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan saved puzzle: %w", err)
		}
		puzzles = append(puzzles, puzzle)
	}
	return puzzles, rows.Err()
}

func (s *Store) SavePuzzle(ctx context.Context, username, url string) (SavedPuzzle, error) {
	var puzzle SavedPuzzle
	err := s.pool.QueryRow(ctx, `
		INSERT INTO saved_puzzles (username, url)
		VALUES ($1, $2)
		ON CONFLICT (username, url) DO UPDATE SET url = EXCLUDED.url
		RETURNING id, url, created_at`, username, url).Scan(&puzzle.ID, &puzzle.URL, &puzzle.CreatedAt)
	if err != nil {
		return SavedPuzzle{}, fmt.Errorf("save puzzle: %w", err)
	}
	return puzzle, nil
}

func (s *Store) DeleteSavedPuzzle(ctx context.Context, username string, id int64) (bool, error) {
	result, err := s.pool.Exec(ctx, `DELETE FROM saved_puzzles WHERE username = $1 AND id = $2`, username, id)
	if err != nil {
		return false, fmt.Errorf("delete saved puzzle: %w", err)
	}
	return result.RowsAffected() > 0, nil
}

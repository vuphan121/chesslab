package db

import (
	"context"
	"fmt"
	"time"
)

const RetryQueueMinAge = 7 * 24 * time.Hour

type RetryPuzzle struct {
	PuzzleID string
	Theme    string
}

func (s *Store) AddPuzzleRetry(ctx context.Context, username, puzzleID, theme string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO puzzle_retry_queue (username, puzzle_id, theme, added_at) VALUES ($1, $2, $3, now())
		ON CONFLICT (username, puzzle_id) DO UPDATE SET theme = EXCLUDED.theme, added_at = now()`,
		username, puzzleID, theme)
	if err != nil {
		return fmt.Errorf("add puzzle retry: %w", err)
	}
	return nil
}

func (s *Store) RemovePuzzleRetry(ctx context.Context, username, puzzleID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM puzzle_retry_queue WHERE username = $1 AND puzzle_id = $2`, username, puzzleID)
	if err != nil {
		return fmt.Errorf("remove puzzle retry: %w", err)
	}
	return nil
}

func (s *Store) RequeuePuzzleRetry(ctx context.Context, username, puzzleID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE puzzle_retry_queue SET added_at = now() WHERE username = $1 AND puzzle_id = $2`, username, puzzleID)
	if err != nil {
		return fmt.Errorf("requeue puzzle retry: %w", err)
	}
	return nil
}

func (s *Store) EligibleRetryPuzzles(ctx context.Context, username string, exclude []string) ([]RetryPuzzle, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT puzzle_id, theme FROM puzzle_retry_queue
		WHERE username = $1 AND added_at <= now() - make_interval(secs => $2) AND NOT (puzzle_id = ANY($3))`,
		username, RetryQueueMinAge.Seconds(), exclude)
	if err != nil {
		return nil, fmt.Errorf("eligible puzzle retries: %w", err)
	}
	defer rows.Close()
	out := []RetryPuzzle{}
	for rows.Next() {
		var r RetryPuzzle
		if err := rows.Scan(&r.PuzzleID, &r.Theme); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

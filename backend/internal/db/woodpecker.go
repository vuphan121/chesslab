package db

import (
	"context"
	"fmt"
)

type WoodpeckerState struct {
	Cycle  int
	Next   int
	Done   int
	Solved int
}

func (s *Store) WoodpeckerState(ctx context.Context, username string, total int) (WoodpeckerState, error) {
	st := WoodpeckerState{Cycle: 1}
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(MAX(cycle), 1) FROM woodpecker_attempts WHERE username = $1`, username).Scan(&st.Cycle); err != nil {
		return st, fmt.Errorf("woodpecker cycle: %w", err)
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT puzzle_number), COUNT(DISTINCT puzzle_number) FILTER (WHERE solved)
		FROM woodpecker_attempts WHERE username = $1 AND cycle = $2`, username, st.Cycle).Scan(&st.Done, &st.Solved); err != nil {
		return st, fmt.Errorf("woodpecker progress: %w", err)
	}
	if st.Done >= total {
		st.Cycle++
		st.Done, st.Solved, st.Next = 0, 0, 1
		return st, nil
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT n FROM generate_series(1, $3::int) n
		WHERE NOT EXISTS (SELECT 1 FROM woodpecker_attempts a WHERE a.username = $1 AND a.cycle = $2 AND a.puzzle_number = n)
		ORDER BY n LIMIT 1`, username, st.Cycle, total).Scan(&st.Next); err != nil {
		return st, fmt.Errorf("woodpecker next: %w", err)
	}
	return st, nil
}

func (s *Store) RecordWoodpeckerAttempt(ctx context.Context, username, operationID string, cycle, puzzleNumber int, solved bool, outcome string, durationMs int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO woodpecker_attempts (username, operation_id, cycle, puzzle_number, solved, outcome, duration_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (username, operation_id) DO NOTHING`,
		username, operationID, cycle, puzzleNumber, solved, outcome, durationMs)
	if err != nil {
		return fmt.Errorf("record woodpecker attempt: %w", err)
	}
	return nil
}

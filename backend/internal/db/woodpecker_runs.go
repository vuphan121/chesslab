package db

import (
	"context"
	"fmt"
	"time"
)

type WoodpeckerRun struct {
	Cycle     int
	Name      string
	StartedAt *time.Time
	LastAt    *time.Time
	Done      int
	Solved    int
	GaveUp    int
	Skipped   int
	Timed     int
	TotalMs   int64
}

type WoodpeckerRunAttempt struct {
	Puzzle     int
	Solved     bool
	Outcome    string
	DurationMs int
}

func (s *Store) WoodpeckerRuns(ctx context.Context, username string) ([]WoodpeckerRun, error) {
	rows, err := s.pool.Query(ctx, `
		WITH cycles AS (
			SELECT cycle FROM woodpecker_attempts WHERE username = $1
			UNION SELECT cycle FROM woodpecker_runs WHERE username = $1)
		SELECT c.cycle, COALESCE(r.name, ''), COALESCE(r.created_at, MIN(a.played_at)), MAX(a.played_at),
			COUNT(DISTINCT a.puzzle_number),
			COUNT(DISTINCT a.puzzle_number) FILTER (WHERE a.solved),
			COUNT(a.id) FILTER (WHERE a.outcome = 'gave_up'),
			COUNT(a.id) FILTER (WHERE a.outcome = 'skipped'),
			COUNT(a.id) FILTER (WHERE a.outcome <> 'skipped'),
			COALESCE(SUM(a.duration_ms) FILTER (WHERE a.outcome <> 'skipped'), 0)
		FROM cycles c
		LEFT JOIN woodpecker_runs r ON r.username = $1 AND r.cycle = c.cycle
		LEFT JOIN woodpecker_attempts a ON a.username = $1 AND a.cycle = c.cycle
		GROUP BY c.cycle, r.name, r.created_at
		ORDER BY c.cycle DESC`, username)
	if err != nil {
		return nil, fmt.Errorf("woodpecker runs: %w", err)
	}
	defer rows.Close()
	var out []WoodpeckerRun
	for rows.Next() {
		var r WoodpeckerRun
		if err := rows.Scan(&r.Cycle, &r.Name, &r.StartedAt, &r.LastAt, &r.Done, &r.Solved, &r.GaveUp, &r.Skipped, &r.Timed, &r.TotalMs); err != nil {
			return nil, fmt.Errorf("woodpecker runs scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) StartWoodpeckerRun(ctx context.Context, username, name string) (int, error) {
	var cycle int
	err := s.pool.QueryRow(ctx, `
		INSERT INTO woodpecker_runs (username, cycle, name)
		SELECT $1, COALESCE(MAX(c), 0) + 1, $2 FROM (
			SELECT cycle AS c FROM woodpecker_attempts WHERE username = $1
			UNION ALL SELECT cycle FROM woodpecker_runs WHERE username = $1) t
		RETURNING cycle`, username, name).Scan(&cycle)
	if err != nil {
		return 0, fmt.Errorf("start woodpecker run: %w", err)
	}
	return cycle, nil
}

func (s *Store) RenameWoodpeckerRun(ctx context.Context, username string, cycle int, name string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO woodpecker_runs (username, cycle, name) VALUES ($1, $2, $3)
		ON CONFLICT (username, cycle) DO UPDATE SET name = EXCLUDED.name`, username, cycle, name)
	if err != nil {
		return fmt.Errorf("rename woodpecker run: %w", err)
	}
	return nil
}

func (s *Store) WoodpeckerRunAttempts(ctx context.Context, username string, cycle int) ([]WoodpeckerRunAttempt, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT ON (puzzle_number) puzzle_number, solved, outcome, duration_ms
		FROM woodpecker_attempts WHERE username = $1 AND cycle = $2
		ORDER BY puzzle_number, played_at DESC, id DESC`, username, cycle)
	if err != nil {
		return nil, fmt.Errorf("woodpecker run attempts: %w", err)
	}
	defer rows.Close()
	var out []WoodpeckerRunAttempt
	for rows.Next() {
		var a WoodpeckerRunAttempt
		if err := rows.Scan(&a.Puzzle, &a.Solved, &a.Outcome, &a.DurationMs); err != nil {
			return nil, fmt.Errorf("woodpecker run attempts scan: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) ResetWoodpeckerRange(ctx context.Context, username string, cycle, from, to int) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM woodpecker_attempts
		WHERE username = $1 AND cycle = $2 AND puzzle_number BETWEEN $3 AND $4`, username, cycle, from, to)
	if err != nil {
		return 0, fmt.Errorf("reset woodpecker range: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (s *Store) UnsolveWoodpeckerPuzzle(ctx context.Context, username string, cycle, puzzle int) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE woodpecker_attempts SET solved = false, outcome = 'mistake'
		WHERE username = $1 AND cycle = $2 AND puzzle_number = $3 AND solved`, username, cycle, puzzle)
	if err != nil {
		return fmt.Errorf("unsolve woodpecker puzzle: %w", err)
	}
	return nil
}

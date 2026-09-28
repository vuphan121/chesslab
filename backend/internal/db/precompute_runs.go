package db

import (
	"context"
	"fmt"
)

// Run statuses stored in precompute_runs.status.
const (
	PrecomputeRunCompleted       = "completed"        // backlog fully drained
	PrecomputeRunBudgetExhausted = "budget_exhausted" // time budget hit with backlog left
	PrecomputeRunFailed          = "failed"           // could not even enumerate/diff the backlog
)

// PrecomputeRunStats are the counters recorded on a precompute_runs row.
type PrecomputeRunStats struct {
	TotalPositions int
	BacklogSize    int
	Attempted      int
	Processed      int
	Failed         int
	Remaining      int
}

// StartPrecomputeRun inserts a 'running' row and returns its id. Any row
// still 'running' from a process that died mid-run (deploy, crash) is first
// marked 'interrupted' — the cutoff is comfortably past the longest possible
// run, so a genuinely live run on another instance is never touched.
func (s *Store) StartPrecomputeRun(ctx context.Context, budgetMS int64, stockfishAvailable bool) (int64, error) {
	if _, err := s.pool.Exec(ctx, `
		UPDATE precompute_runs
		SET status = 'interrupted', finished_at = now(),
		    duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint
		WHERE status = 'running' AND started_at < now() - interval '90 minutes'`); err != nil {
		return 0, fmt.Errorf("close stale precompute runs: %w", err)
	}
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO precompute_runs (budget_ms, stockfish_available)
		VALUES ($1, $2) RETURNING id`, budgetMS, stockfishAvailable).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("start precompute run: %w", err)
	}
	return id, nil
}

// UpdatePrecomputeRunProgress overwrites the counters of a still-running row
// so an in-flight run is observable.
func (s *Store) UpdatePrecomputeRunProgress(ctx context.Context, id int64, st PrecomputeRunStats) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE precompute_runs
		SET total_positions = $2, backlog_size = $3, attempted = $4,
		    processed = $5, failed = $6, remaining = $7
		WHERE id = $1`,
		id, st.TotalPositions, st.BacklogSize, st.Attempted, st.Processed, st.Failed, st.Remaining)
	if err != nil {
		return fmt.Errorf("update precompute run %d: %w", id, err)
	}
	return nil
}

// FinishPrecomputeRun stamps the final counters, status, and duration.
func (s *Store) FinishPrecomputeRun(ctx context.Context, id int64, status string, st PrecomputeRunStats, runErr string) error {
	var errArg any
	if runErr != "" {
		errArg = runErr
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE precompute_runs
		SET status = $2, finished_at = now(),
		    duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint,
		    total_positions = $3, backlog_size = $4, attempted = $5,
		    processed = $6, failed = $7, remaining = $8, error = $9
		WHERE id = $1`,
		id, status, st.TotalPositions, st.BacklogSize, st.Attempted, st.Processed, st.Failed, st.Remaining, errArg)
	if err != nil {
		return fmt.Errorf("finish precompute run %d: %w", id, err)
	}
	return nil
}

// PrecomputePositionLog is one attempted position within a run.
type PrecomputePositionLog struct {
	RunID      int64
	FENKey     string
	Status     string // ok | compute_failed | save_failed
	EngineName string // "" when the compute failed
	Depth      int
	DurationMS int64
	Error      string
}

// InsertPrecomputePositionLog records one position's outcome.
func (s *Store) InsertPrecomputePositionLog(ctx context.Context, l PrecomputePositionLog) error {
	var engineArg, errArg any
	if l.EngineName != "" {
		engineArg = l.EngineName
	}
	if l.Error != "" {
		errArg = l.Error
	}
	var depthArg any
	if l.Status == "ok" {
		depthArg = l.Depth
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO precompute_run_positions (run_id, fen_key, status, engine_name, depth, duration_ms, error)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		l.RunID, l.FENKey, l.Status, engineArg, depthArg, l.DurationMS, errArg)
	if err != nil {
		return fmt.Errorf("insert precompute position log: %w", err)
	}
	return nil
}

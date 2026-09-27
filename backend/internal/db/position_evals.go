package db

import (
	"context"
	"encoding/json"
	"fmt"
)

// PositionEvalMove is one precomputed candidate move at a position — rank 1
// is the engine's best line, higher ranks progressively weaker. Score/Mate
// are White-relative, same convention as PositionEval.Score/Mate below and
// every other eval surface in this app (see root CLAUDE.md's "Eval sign").
type PositionEvalMove struct {
	Rank  int    `json:"rank"`
	SAN   string `json:"san"`
	UCI   string `json:"uci"`
	Score int    `json:"score"`
	Mate  int    `json:"mate"`
}

// PositionEval is one row of the offline opening-position eval cache (see
// internal/evalprecompute) — depth-22 MultiPV analysis precomputed for every
// position that appears in any opening-trainer repertoire, so the trainer's
// line-complete eval bar/suggestion arrows never need a live engine call.
type PositionEval struct {
	FENKey     string
	Score      int
	Mate       int
	Depth      int
	EngineName string
	BestMoves  []PositionEvalMove
}

// AllPositionEvalKeys returns every fen_key already computed, as a set. The
// precompute job diffs this against every position enumerated from the
// currently-loaded repertoires to find its backlog; fetched as one query
// rather than checking each candidate individually, since the whole table
// stays small (bounded by the total distinct positions across every
// repertoire — currently in the low thousands).
func (s *Store) AllPositionEvalKeys(ctx context.Context) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `SELECT fen_key FROM position_evals`)
	if err != nil {
		return nil, fmt.Errorf("list position eval keys: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, fmt.Errorf("scan position eval key: %w", err)
		}
		out[key] = true
	}
	return out, rows.Err()
}

// GetPositionEvals batch-fetches evals for a set of fen_keys — the trainer
// fetches every ply of a just-finished line in one call rather than one
// round trip per position.
func (s *Store) GetPositionEvals(ctx context.Context, fenKeys []string) (map[string]PositionEval, error) {
	if len(fenKeys) == 0 {
		return map[string]PositionEval{}, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT fen_key, score, mate, depth, engine_name, best_moves
		FROM position_evals
		WHERE fen_key = ANY($1)`, fenKeys)
	if err != nil {
		return nil, fmt.Errorf("get position evals: %w", err)
	}
	defer rows.Close()
	out := map[string]PositionEval{}
	for rows.Next() {
		var e PositionEval
		var raw []byte
		if err := rows.Scan(&e.FENKey, &e.Score, &e.Mate, &e.Depth, &e.EngineName, &raw); err != nil {
			return nil, fmt.Errorf("scan position eval: %w", err)
		}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &e.BestMoves); err != nil {
				return nil, fmt.Errorf("unmarshal best moves for %s: %w", e.FENKey, err)
			}
		}
		out[e.FENKey] = e
	}
	return out, rows.Err()
}

// UpsertPositionEval stores (or replaces) one position's precomputed eval.
func (s *Store) UpsertPositionEval(ctx context.Context, e PositionEval) error {
	raw, err := json.Marshal(e.BestMoves)
	if err != nil {
		return fmt.Errorf("marshal best moves: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO position_evals (fen_key, score, mate, depth, engine_name, best_moves, computed_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (fen_key) DO UPDATE SET
			score = EXCLUDED.score,
			mate = EXCLUDED.mate,
			depth = EXCLUDED.depth,
			engine_name = EXCLUDED.engine_name,
			best_moves = EXCLUDED.best_moves,
			computed_at = now()`,
		e.FENKey, e.Score, e.Mate, e.Depth, e.EngineName, raw)
	if err != nil {
		return fmt.Errorf("upsert position eval %q: %w", e.FENKey, err)
	}
	return nil
}

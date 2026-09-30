package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/chesslab/backend/internal/puzzle"
	"github.com/jackc/pgx/v5"
)

type ThemeStat struct {
	Rating   float64
	Attempts int
	Wins     int
}

type PuzzlePlayResult struct {
	Theme        string  `json:"theme"`
	RatingBefore float64 `json:"ratingBefore"`
	RatingAfter  float64 `json:"ratingAfter"`
	Attempts     int     `json:"attempts"`
	Wins         int     `json:"wins"`
	PuzzleRating int     `json:"puzzleRating"`
}

const RecentPuzzleLimit = 400

var ErrUnknownPuzzle = errors.New("unknown puzzle or theme")

func (s *Store) PuzzleThemeStats(ctx context.Context, username string) (map[string]ThemeStat, error) {
	rows, err := s.pool.Query(ctx, `SELECT theme, rating, attempts, wins FROM puzzle_theme_ratings WHERE username = $1`, username)
	if err != nil {
		return nil, fmt.Errorf("puzzle theme ratings: %w", err)
	}
	defer rows.Close()
	out := map[string]ThemeStat{}
	for rows.Next() {
		var theme string
		var st ThemeStat
		if err := rows.Scan(&theme, &st.Rating, &st.Attempts, &st.Wins); err != nil {
			return nil, err
		}
		out[theme] = st
	}
	return out, rows.Err()
}

func (s *Store) RecentPuzzleIDs(ctx context.Context, username string, limit int) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT puzzle_id FROM puzzle_plays WHERE username = $1 ORDER BY played_at DESC LIMIT $2`, username, limit)
	if err != nil {
		return nil, fmt.Errorf("recent puzzle plays: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) RecordPuzzlePlay(ctx context.Context, username, operationID, puzzleID, theme string, solved bool, puzzleRating int, puzzleThemes []string) (*PuzzlePlayResult, error) {
	hasTheme := false
	for _, t := range puzzleThemes {
		if t == theme {
			hasTheme = true
		}
	}
	if !hasTheme {
		return nil, ErrUnknownPuzzle
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "puzzle:"+username); err != nil {
		return nil, err
	}

	var prev PuzzlePlayResult
	err = tx.QueryRow(ctx, `
		SELECT p.theme, p.rating_before, p.rating_after, p.puzzle_rating,
		       COALESCE(r.attempts, 0), COALESCE(r.wins, 0)
		FROM puzzle_plays p
		LEFT JOIN puzzle_theme_ratings r ON r.username = p.username AND r.theme = p.theme
		WHERE p.username = $1 AND p.operation_id = $2`, username, operationID).
		Scan(&prev.Theme, &prev.RatingBefore, &prev.RatingAfter, &prev.PuzzleRating, &prev.Attempts, &prev.Wins)
	if err == nil {
		return &prev, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	before, attempts, wins := puzzle.StartRating, 0, 0
	err = tx.QueryRow(ctx, `SELECT rating, attempts, wins FROM puzzle_theme_ratings WHERE username = $1 AND theme = $2`, username, theme).
		Scan(&before, &attempts, &wins)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	after := puzzle.NextRating(before, float64(puzzleRating), solved, attempts)
	attempts++
	if solved {
		wins++
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO puzzle_theme_ratings (username, theme, rating, attempts, wins, updated_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (username, theme) DO UPDATE SET
			rating = EXCLUDED.rating, attempts = EXCLUDED.attempts, wins = EXCLUDED.wins, updated_at = now()`,
		username, theme, after, attempts, wins); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO puzzle_plays (username, operation_id, puzzle_id, theme, solved, puzzle_rating, rating_before, rating_after)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		username, operationID, puzzleID, theme, solved, puzzleRating, before, after); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &PuzzlePlayResult{Theme: theme, RatingBefore: before, RatingAfter: after, Attempts: attempts, Wins: wins, PuzzleRating: puzzleRating}, nil
}

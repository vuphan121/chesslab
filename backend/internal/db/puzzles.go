package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/chesslab/backend/internal/puzzle"
	"github.com/jackc/pgx/v5"
)

type Puzzle struct {
	ID     string   `json:"id"`
	FEN    string   `json:"fen"`
	Moves  string   `json:"moves"`
	Rating int      `json:"rating"`
	Themes []string `json:"themes"`
}

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

const recentPuzzleExclusions = 400

var puzzleRatingWindows = []int{75, 150, 300, 600, 5000}

func (s *Store) InsertPuzzles(ctx context.Context, rows []puzzle.Row) (int, error) {
	inserted := 0
	for start := 0; start < len(rows); start += 1000 {
		end := min(start+1000, len(rows))
		batch := &pgx.Batch{}
		for _, r := range rows[start:end] {
			batch.Queue(`
				INSERT INTO puzzles (id, fen, moves, rating, popularity, nb_plays, themes)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				ON CONFLICT (id) DO NOTHING`,
				r.ID, r.FEN, r.Moves, r.Rating, r.Popularity, r.NbPlays, r.Themes)
		}
		results := s.pool.SendBatch(ctx, batch)
		for range rows[start:end] {
			ct, err := results.Exec()
			if err != nil {
				results.Close()
				return inserted, fmt.Errorf("insert puzzles: %w", err)
			}
			inserted += int(ct.RowsAffected())
		}
		if err := results.Close(); err != nil {
			return inserted, err
		}
	}
	return inserted, nil
}

func (s *Store) ClearPuzzles(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `TRUNCATE puzzles`); err != nil {
		return fmt.Errorf("clear puzzles: %w", err)
	}
	return nil
}

func (s *Store) PuzzleThemeCounts(ctx context.Context) (map[string]int, error) {
	rows, err := s.pool.Query(ctx, `SELECT t, COUNT(*) FROM puzzles, unnest(themes) AS t GROUP BY t`)
	if err != nil {
		return nil, fmt.Errorf("puzzle theme counts: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var theme string
		var n int
		if err := rows.Scan(&theme, &n); err != nil {
			return nil, err
		}
		out[theme] = n
	}
	return out, rows.Err()
}

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

func (s *Store) NextPuzzle(ctx context.Context, username, theme string, rating float64, exclude []string) (*Puzzle, error) {
	if exclude == nil {
		exclude = []string{}
	}
	for _, excludeRecent := range []bool{true, false} {
		for _, window := range puzzleRatingWindows {
			lo, hi := int(rating)-window, int(rating)+window
			query := `SELECT id, fen, moves, rating, themes FROM puzzles WHERE themes @> ARRAY[$1]::text[] AND rating BETWEEN $2 AND $3 AND id <> ALL($4::text[])`
			if excludeRecent {
				query += ` AND id NOT IN (SELECT puzzle_id FROM puzzle_plays WHERE username = $5 ORDER BY played_at DESC LIMIT ` + fmt.Sprint(recentPuzzleExclusions) + `)`
			}
			query += ` ORDER BY random() LIMIT 1`
			args := []any{theme, lo, hi, exclude}
			if excludeRecent {
				args = append(args, username)
			}
			var p Puzzle
			err := s.pool.QueryRow(ctx, query, args...).Scan(&p.ID, &p.FEN, &p.Moves, &p.Rating, &p.Themes)
			if err == nil {
				return &p, nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("next puzzle: %w", err)
			}
		}
	}
	return nil, nil
}

func (s *Store) RecordPuzzlePlay(ctx context.Context, username, operationID, puzzleID, theme string, solved bool) (*PuzzlePlayResult, error) {
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

	var puzzleRating int
	var themes []string
	if err := tx.QueryRow(ctx, `SELECT rating, themes FROM puzzles WHERE id = $1`, puzzleID).Scan(&puzzleRating, &themes); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUnknownPuzzle
		}
		return nil, err
	}
	hasTheme := false
	for _, t := range themes {
		if t == theme {
			hasTheme = true
		}
	}
	if !hasTheme {
		return nil, ErrUnknownPuzzle
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

var ErrUnknownPuzzle = errors.New("unknown puzzle or theme")

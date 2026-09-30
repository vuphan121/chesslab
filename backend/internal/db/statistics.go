package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/chesslab/backend/internal/lichess"
	"github.com/jackc/pgx/v5"
)

type PuzzleSyncState struct {
	LichessUsername string
	SyncedAt        time.Time
	AttemptsAdded   int
}

func (s *Store) LatestPuzzleAttempt(ctx context.Context, username string) (time.Time, error) {
	var t *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT MAX(played_at) FROM puzzle_attempts WHERE username = $1`, username).Scan(&t); err != nil {
		return time.Time{}, fmt.Errorf("latest puzzle attempt: %w", err)
	}
	if t == nil {
		return time.Time{}, nil
	}
	return *t, nil
}

func (s *Store) SavePuzzleSync(ctx context.Context, username, lichessUsername string, attempts []lichess.PuzzleActivity, ratings []lichess.RatingPoint) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	batch := &pgx.Batch{}
	for _, a := range attempts {
		themes, err := json.Marshal(a.Themes)
		if err != nil || a.Themes == nil {
			themes = []byte("[]")
		}
		batch.Queue(`
			INSERT INTO puzzle_attempts (username, puzzle_id, played_at, win, puzzle_rating, themes)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (username, puzzle_id, played_at) DO UPDATE SET
				win = EXCLUDED.win, puzzle_rating = EXCLUDED.puzzle_rating, themes = EXCLUDED.themes`,
			username, a.PuzzleID, a.PlayedAt, a.Win, a.Rating, themes)
	}
	for _, p := range ratings {
		batch.Queue(`
			INSERT INTO puzzle_rating_history (username, day, rating) VALUES ($1, $2, $3)
			ON CONFLICT (username, day) DO UPDATE SET rating = EXCLUDED.rating`,
			username, p.Day, p.Rating)
	}
	batch.Queue(`
		INSERT INTO puzzle_sync_state (username, lichess_username, synced_at, attempts_added)
		VALUES ($1, $2, now(), $3)
		ON CONFLICT (username) DO UPDATE SET
			lichess_username = EXCLUDED.lichess_username, synced_at = now(), attempts_added = EXCLUDED.attempts_added`,
		username, lichessUsername, len(attempts))

	results := tx.SendBatch(ctx, batch)
	for i := 0; i < batch.Len(); i++ {
		if _, err := results.Exec(); err != nil {
			results.Close()
			return fmt.Errorf("puzzle sync write: %w", err)
		}
	}
	if err := results.Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type StatsDay struct {
	Date    string `json:"date"`
	Drills  int    `json:"drills"`
	Puzzles int    `json:"puzzles"`
}

type StatsWeek struct {
	WeekStart string   `json:"weekStart"`
	DrillAcc  *float64 `json:"drillAccuracy"`
	PuzzleAcc *float64 `json:"puzzleAccuracy"`
	Drills    int      `json:"drills"`
	Puzzles   int      `json:"puzzles"`
}

type StatsTheme struct {
	Theme string `json:"theme"`
	Nb    int    `json:"nb"`
	Wins  int    `json:"wins"`
}

type StatsRatingPoint struct {
	Date   string `json:"date"`
	Rating int    `json:"rating"`
}

type StatsTotals struct {
	Drills        int `json:"drills"`
	DrillMistakes int `json:"drillMistakes"`
	Puzzles       int `json:"puzzles"`
	PuzzleWins    int `json:"puzzleWins"`
}

func (s *Store) StatsDaily(ctx context.Context, username, timeZone, endDate string, days int) ([]StatsDay, StatsTotals, error) {
	rows, err := s.pool.Query(ctx, `
		WITH bounds AS (
			SELECT (($3::date - ($4::int - 1))::timestamp AT TIME ZONE $2) AS lo,
			       (($3::date + 1)::timestamp AT TIME ZONE $2) AS hi
		), d AS (
			SELECT (played_at AT TIME ZONE $2)::date AS day, 1 AS drill, 0 AS puzzle,
			       CASE WHEN had_mistake THEN 1 ELSE 0 END AS mistake, 0 AS win
			FROM line_attempts, bounds
			WHERE username = $1 AND played_at >= lo AND played_at < hi
			UNION ALL
			SELECT (played_at AT TIME ZONE $2)::date, 0, 1, 0, CASE WHEN win THEN 1 ELSE 0 END
			FROM puzzle_attempts, bounds
			WHERE username = $1 AND played_at >= lo AND played_at < hi
		)
		SELECT day::text, SUM(drill), SUM(puzzle), SUM(mistake), SUM(win) FROM d GROUP BY day ORDER BY day`,
		username, timeZone, endDate, days)
	if err != nil {
		return nil, StatsTotals{}, fmt.Errorf("stats daily: %w", err)
	}
	defer rows.Close()
	out := []StatsDay{}
	var t StatsTotals
	for rows.Next() {
		var d StatsDay
		var mistakes, wins int
		if err := rows.Scan(&d.Date, &d.Drills, &d.Puzzles, &mistakes, &wins); err != nil {
			return nil, t, err
		}
		t.Drills += d.Drills
		t.DrillMistakes += mistakes
		t.Puzzles += d.Puzzles
		t.PuzzleWins += wins
		out = append(out, d)
	}
	return out, t, rows.Err()
}

func (s *Store) ActivityDays(ctx context.Context, username, timeZone, endDate string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT day::text FROM (
			SELECT (played_at AT TIME ZONE $2)::date AS day FROM line_attempts WHERE username = $1
			UNION
			SELECT (played_at AT TIME ZONE $2)::date FROM puzzle_attempts WHERE username = $1
		) x WHERE day <= $3::date ORDER BY 1`, username, timeZone, endDate)
	if err != nil {
		return nil, fmt.Errorf("activity days: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) StatsWeekly(ctx context.Context, username, timeZone, endDate string, weeks int) ([]StatsWeek, error) {
	rows, err := s.pool.Query(ctx, `
		WITH bounds AS (
			SELECT (date_trunc('week', $3::date)::date - (($4::int - 1) * 7)) AS first_week,
			       ($3::date + 1) AS hi
		), d AS (
			SELECT date_trunc('week', (played_at AT TIME ZONE $2)::date)::date AS wk, 1 AS drill, 0 AS puzzle,
			       CASE WHEN had_mistake THEN 1 ELSE 0 END AS mistake, 0 AS win
			FROM line_attempts, bounds
			WHERE username = $1 AND (played_at AT TIME ZONE $2)::date >= first_week AND (played_at AT TIME ZONE $2)::date < hi
			UNION ALL
			SELECT date_trunc('week', (played_at AT TIME ZONE $2)::date)::date, 0, 1, 0, CASE WHEN win THEN 1 ELSE 0 END
			FROM puzzle_attempts, bounds
			WHERE username = $1 AND (played_at AT TIME ZONE $2)::date >= first_week AND (played_at AT TIME ZONE $2)::date < hi
		)
		SELECT wk::text, SUM(drill), SUM(puzzle), SUM(mistake), SUM(win) FROM d GROUP BY wk ORDER BY wk`,
		username, timeZone, endDate, weeks)
	if err != nil {
		return nil, fmt.Errorf("stats weekly: %w", err)
	}
	defer rows.Close()
	out := []StatsWeek{}
	for rows.Next() {
		var w StatsWeek
		var mistakes, wins int
		if err := rows.Scan(&w.WeekStart, &w.Drills, &w.Puzzles, &mistakes, &wins); err != nil {
			return nil, err
		}
		if w.Drills > 0 {
			v := 100 * float64(w.Drills-mistakes) / float64(w.Drills)
			w.DrillAcc = &v
		}
		if w.Puzzles > 0 {
			v := 100 * float64(wins) / float64(w.Puzzles)
			w.PuzzleAcc = &v
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) StatsThemes(ctx context.Context, username, timeZone, endDate string, days int) ([]StatsTheme, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.theme, COUNT(*), COUNT(*) FILTER (WHERE a.win)
		FROM puzzle_attempts a, jsonb_array_elements_text(a.themes) AS t(theme)
		WHERE a.username = $1
		  AND a.played_at >= (($3::date - ($4::int - 1))::timestamp AT TIME ZONE $2)
		  AND a.played_at < (($3::date + 1)::timestamp AT TIME ZONE $2)
		  AND t.theme NOT IN ('short', 'long', 'veryLong', 'oneMove', 'advantage', 'crushing', 'equality',
		                      'opening', 'middlegame', 'endgame', 'master', 'masterVsMaster', 'superGM')
		GROUP BY t.theme ORDER BY COUNT(*) DESC`, username, timeZone, endDate, days)
	if err != nil {
		return nil, fmt.Errorf("stats themes: %w", err)
	}
	defer rows.Close()
	out := []StatsTheme{}
	for rows.Next() {
		var t StatsTheme
		if err := rows.Scan(&t.Theme, &t.Nb, &t.Wins); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) StatsRating(ctx context.Context, username, endDate string, days int) ([]StatsRatingPoint, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT day::text, rating FROM puzzle_rating_history
		WHERE username = $1 AND day > ($2::date - $3::int) AND day <= $2::date ORDER BY day`,
		username, endDate, days)
	if err != nil {
		return nil, fmt.Errorf("stats rating: %w", err)
	}
	defer rows.Close()
	out := []StatsRatingPoint{}
	for rows.Next() {
		var p StatsRatingPoint
		if err := rows.Scan(&p.Date, &p.Rating); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) LastRatingAtOrBefore(ctx context.Context, username, day string) (*int, error) {
	var r int
	err := s.pool.QueryRow(ctx, `
		SELECT rating FROM puzzle_rating_history
		WHERE username = $1 AND day <= $2::date ORDER BY day DESC LIMIT 1`, username, day).Scan(&r)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) SeenCardBoxes(ctx context.Context, username string) (map[string]map[string]int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT repertoire_id, card_id, box FROM card_progress WHERE username = $1 AND seen > 0`, username)
	if err != nil {
		return nil, fmt.Errorf("seen cards: %w", err)
	}
	defer rows.Close()
	out := map[string]map[string]int{}
	for rows.Next() {
		var rep, card string
		var box int
		if err := rows.Scan(&rep, &card, &box); err != nil {
			return nil, err
		}
		if out[rep] == nil {
			out[rep] = map[string]int{}
		}
		out[rep][card] = box
	}
	return out, rows.Err()
}

func (s *Store) GetPuzzleSyncState(ctx context.Context, username string) (*PuzzleSyncState, error) {
	var st PuzzleSyncState
	err := s.pool.QueryRow(ctx, `SELECT lichess_username, synced_at, attempts_added FROM puzzle_sync_state WHERE username = $1`, username).
		Scan(&st.LichessUsername, &st.SyncedAt, &st.AttemptsAdded)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &st, nil
}

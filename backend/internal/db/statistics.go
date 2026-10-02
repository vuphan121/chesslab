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

func (s *Store) SavePuzzleSync(ctx context.Context, username, lichessUsername, timeZone string, attempts []lichess.PuzzleActivity, ratings []lichess.RatingPoint) error {
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
	if len(attempts) > 0 {
		loc, err := time.LoadLocation(timeZone)
		if err != nil {
			loc = time.UTC
		}
		seenDays := map[string]bool{}
		days := []string{}
		for _, a := range attempts {
			d := a.PlayedAt.In(loc).Format(time.DateOnly)
			if !seenDays[d] {
				seenDays[d] = true
				days = append(days, d)
			}
		}
		batch.Queue(`
			INSERT INTO puzzle_daily_stats (username, day, plays, wins, lichess_plays, lichess_wins)
			SELECT $1, day, 0, 0, n, w FROM (
				SELECT (played_at AT TIME ZONE $2)::date AS day, COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE win))::int AS w
				FROM puzzle_attempts
				WHERE username = $1 AND (played_at AT TIME ZONE $2)::date = ANY($3::date[])
				GROUP BY 1
			) x
			ON CONFLICT (username, day) DO UPDATE SET lichess_plays = EXCLUDED.lichess_plays, lichess_wins = EXCLUDED.lichess_wins`,
			username, timeZone, days)
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
	Date          string `json:"date"`
	Drills        int    `json:"drills"`
	Puzzles       int    `json:"puzzles"`
	PuzzlesSolved int    `json:"puzzlesSolved"`
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

func (s *Store) StatsDaily(ctx context.Context, username, endDate string, days int) ([]StatsDay, StatsTotals, error) {
	rows, err := s.pool.Query(ctx, `
		WITH d AS (
			SELECT day, drills AS drill, 0 AS puzzle, mistakes AS mistake, 0 AS win
			FROM drill_daily_stats
			WHERE username = $1 AND day >= ($2::date - ($3::int - 1)) AND day <= $2::date
			UNION ALL
			SELECT day, 0, plays + lichess_plays, 0, wins + lichess_wins
			FROM puzzle_daily_stats
			WHERE username = $1 AND day >= ($2::date - ($3::int - 1)) AND day <= $2::date
		)
		SELECT day::text, SUM(drill)::int, SUM(puzzle)::int, SUM(mistake)::int, SUM(win)::int FROM d GROUP BY day ORDER BY day`,
		username, endDate, days)
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
		d.PuzzlesSolved = wins
		t.Drills += d.Drills
		t.DrillMistakes += mistakes
		t.Puzzles += d.Puzzles
		t.PuzzleWins += wins
		out = append(out, d)
	}
	return out, t, rows.Err()
}

func (s *Store) ActivityDays(ctx context.Context, username, endDate string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT day::text FROM (
			SELECT day FROM drill_daily_stats WHERE username = $1
			UNION
			SELECT day FROM puzzle_daily_stats WHERE username = $1
		) x WHERE day <= $2::date ORDER BY 1`, username, endDate)
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

type StatsSpot struct {
	RepertoireID string `json:"repertoireId"`
	ChapterID    string `json:"chapterId"`
	ChapterName  string `json:"chapterName"`
	Drills       int    `json:"drills"`
	Mistakes     int    `json:"mistakes"`
}

func (s *Store) StatsTroubleSpots(ctx context.Context, username, endDate string, days, minDrills, limit int) ([]StatsSpot, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT repertoire_id, chapter_id, MAX(chapter_name), SUM(drills)::int, SUM(mistakes)::int
		FROM drill_daily_stats
		WHERE username = $1 AND day >= ($2::date - ($3::int - 1)) AND day <= $2::date
		GROUP BY repertoire_id, chapter_id
		HAVING SUM(drills) >= $4 AND SUM(mistakes) > 0
		ORDER BY SUM(mistakes)::float / SUM(drills) DESC, SUM(drills) DESC
		LIMIT $5`, username, endDate, days, minDrills, limit)
	if err != nil {
		return nil, fmt.Errorf("stats trouble spots: %w", err)
	}
	defer rows.Close()
	out := []StatsSpot{}
	for rows.Next() {
		var sp StatsSpot
		if err := rows.Scan(&sp.RepertoireID, &sp.ChapterID, &sp.ChapterName, &sp.Drills, &sp.Mistakes); err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

func (s *Store) appRatingExists(ctx context.Context, username string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM puzzle_daily_stats WHERE username = $1 AND avg_rating IS NOT NULL)`, username).Scan(&ok)
	return ok, err
}

func (s *Store) StatsRating(ctx context.Context, username, endDate string, days int) ([]StatsRatingPoint, error) {
	query := `
		SELECT day::text, rating FROM puzzle_rating_history
		WHERE username = $1 AND day > ($2::date - $3::int) AND day <= $2::date ORDER BY day`
	if app, err := s.appRatingExists(ctx, username); err != nil {
		return nil, fmt.Errorf("stats rating: %w", err)
	} else if app {
		query = `
		SELECT day::text, ROUND(avg_rating)::int FROM puzzle_daily_stats
		WHERE username = $1 AND avg_rating IS NOT NULL AND day > ($2::date - $3::int) AND day <= $2::date ORDER BY day`
	}
	rows, err := s.pool.Query(ctx, query,
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
	query := `
		SELECT rating FROM puzzle_rating_history
		WHERE username = $1 AND day <= $2::date ORDER BY day DESC LIMIT 1`
	if app, err := s.appRatingExists(ctx, username); err != nil {
		return nil, err
	} else if app {
		query = `
		SELECT ROUND(avg_rating)::int FROM puzzle_daily_stats
		WHERE username = $1 AND avg_rating IS NOT NULL AND day <= $2::date ORDER BY day DESC LIMIT 1`
	}
	err := s.pool.QueryRow(ctx, query, username, day).Scan(&r)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) LineHistories(ctx context.Context, username string) (map[string]map[string]CardHistory, error) {
	rows, err := s.pool.Query(ctx, `SELECT repertoire_id, line_id, recent_bits, recent_n FROM line_history WHERE username = $1 AND recent_n > 0`, username)
	if err != nil {
		return nil, fmt.Errorf("line histories: %w", err)
	}
	defer rows.Close()
	out := map[string]map[string]CardHistory{}
	for rows.Next() {
		var rep, line string
		var h CardHistory
		if err := rows.Scan(&rep, &line, &h.Bits, &h.N); err != nil {
			return nil, err
		}
		if out[rep] == nil {
			out[rep] = map[string]CardHistory{}
		}
		out[rep][line] = h
	}
	return out, rows.Err()
}

type CardHistory struct {
	Bits int
	N    int
}

func (s *Store) CardBoxes(ctx context.Context, username, repertoireID string) (map[string]CardBox, error) {
	rows, err := s.pool.Query(ctx, `SELECT card_id, box, seen FROM card_progress WHERE username = $1 AND repertoire_id = $2 AND seen > 0`, username, repertoireID)
	if err != nil {
		return nil, fmt.Errorf("card boxes: %w", err)
	}
	defer rows.Close()
	out := map[string]CardBox{}
	for rows.Next() {
		var id string
		var c CardBox
		if err := rows.Scan(&id, &c.Box, &c.Seen); err != nil {
			return nil, err
		}
		out[id] = c
	}
	return out, rows.Err()
}

func (s *Store) CardProgressRepertoires(ctx context.Context) ([][2]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT username, repertoire_id FROM card_progress WHERE seen > 0`)
	if err != nil {
		return nil, fmt.Errorf("progress repertoires: %w", err)
	}
	defer rows.Close()
	var out [][2]string
	for rows.Next() {
		var pair [2]string
		if err := rows.Scan(&pair[0], &pair[1]); err != nil {
			return nil, err
		}
		out = append(out, pair)
	}
	return out, rows.Err()
}

func (s *Store) SeedLineHistory(ctx context.Context, username, repertoireID, lineID string, bits, n int) (bool, error) {
	ct, err := s.pool.Exec(ctx, `
		INSERT INTO line_history (username, repertoire_id, line_id, recent_bits, recent_n, estimated) VALUES ($1, $2, $3, $4, $5, true)
		ON CONFLICT DO NOTHING`, username, repertoireID, lineID, bits, n)
	if err != nil {
		return false, fmt.Errorf("seed line history: %w", err)
	}
	return ct.RowsAffected() > 0, nil
}

type CardBox struct {
	Box  int
	Seen int
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

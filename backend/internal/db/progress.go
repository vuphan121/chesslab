package db

import (
	"context"
	"fmt"
	"time"
)

type CardProgress struct {
	Box         int     `json:"box"`
	Lapses      int     `json:"lapses"`
	Seen        int     `json:"seen"`
	Correct     int     `json:"correct"`
	LastSeenISO *string `json:"lastSeenISO"`
}

type LineAttempt struct {
	ChapterID   string
	ChapterName string
	CardID      string
	HadMistake  bool
}

func (s *Store) GetProgress(ctx context.Context, username, repertoireID string) (map[string]CardProgress, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT card_id, box, lapses, seen, correct, last_seen_at
		FROM card_progress
		WHERE username = $1 AND repertoire_id = $2`,
		username, repertoireID)
	if err != nil {
		return nil, fmt.Errorf("query card_progress: %w", err)
	}
	defer rows.Close()

	out := make(map[string]CardProgress)
	for rows.Next() {
		var cardID string
		var cp CardProgress
		var lastSeen *time.Time
		if err := rows.Scan(&cardID, &cp.Box, &cp.Lapses, &cp.Seen, &cp.Correct, &lastSeen); err != nil {
			return nil, fmt.Errorf("scan card_progress: %w", err)
		}
		if lastSeen != nil {
			iso := lastSeen.UTC().Format(time.RFC3339)
			cp.LastSeenISO = &iso
		}
		out[cardID] = cp
	}
	return out, rows.Err()
}

func (s *Store) SaveProgress(ctx context.Context, username, repertoireID string, cards map[string]CardProgress, attempt *LineAttempt) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	for cardID, cp := range cards {
		var lastSeen *time.Time
		if cp.LastSeenISO != nil {
			t, err := time.Parse(time.RFC3339, *cp.LastSeenISO)
			if err != nil {
				return fmt.Errorf("parse lastSeenISO for card %s: %w", cardID, err)
			}
			lastSeen = &t
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO card_progress (username, repertoire_id, card_id, box, lapses, seen, correct, last_seen_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
			ON CONFLICT (username, repertoire_id, card_id) DO UPDATE SET
				box = EXCLUDED.box,
				lapses = EXCLUDED.lapses,
				seen = EXCLUDED.seen,
				correct = EXCLUDED.correct,
				last_seen_at = EXCLUDED.last_seen_at,
				updated_at = now()`,
			username, repertoireID, cardID, cp.Box, cp.Lapses, cp.Seen, cp.Correct, lastSeen)
		if err != nil {
			return fmt.Errorf("upsert card_progress %s: %w", cardID, err)
		}
	}

	if attempt != nil {
		_, err := tx.Exec(ctx, `
			INSERT INTO line_attempts (username, repertoire_id, chapter_id, chapter_name, card_id, had_mistake)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			username, repertoireID, attempt.ChapterID, attempt.ChapterName, attempt.CardID, attempt.HadMistake)
		if err != nil {
			return fmt.Errorf("insert line_attempt: %w", err)
		}
	}

	return tx.Commit(ctx)
}

type ChapterCount struct {
	RepertoireID string `json:"repertoireId"`
	ChapterID    string `json:"chapterId"`
	ChapterName  string `json:"chapterName"`
	Count        int    `json:"count"`
}

type DayCount struct {
	Date  string `json:"date"`
	Total int    `json:"total"`
}

type Analytics struct {
	TodayTotal     int            `json:"todayTotal"`
	TodayByChapter []ChapterCount `json:"todayByChapter"`
	Last7Days      []DayCount     `json:"last7Days"`
}

func (s *Store) GetAnalytics(ctx context.Context, username string) (Analytics, error) {
	var a Analytics

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM line_attempts
		WHERE username = $1 AND played_at >= date_trunc('day', now())`,
		username).Scan(&a.TodayTotal); err != nil {
		return a, fmt.Errorf("today total: %w", err)
	}

	chapterRows, err := s.pool.Query(ctx, `
		SELECT repertoire_id, chapter_id, chapter_name, COUNT(*)
		FROM line_attempts
		WHERE username = $1 AND played_at >= date_trunc('day', now())
		GROUP BY repertoire_id, chapter_id, chapter_name
		ORDER BY COUNT(*) DESC`,
		username)
	if err != nil {
		return a, fmt.Errorf("today by chapter: %w", err)
	}
	for chapterRows.Next() {
		var c ChapterCount
		if err := chapterRows.Scan(&c.RepertoireID, &c.ChapterID, &c.ChapterName, &c.Count); err != nil {
			chapterRows.Close()
			return a, fmt.Errorf("scan chapter count: %w", err)
		}
		a.TodayByChapter = append(a.TodayByChapter, c)
	}
	chapterRows.Close()
	if err := chapterRows.Err(); err != nil {
		return a, err
	}

	dayRows, err := s.pool.Query(ctx, `
		SELECT date_trunc('day', played_at)::date::text AS d, COUNT(*)
		FROM line_attempts
		WHERE username = $1 AND played_at >= now() - interval '7 days'
		GROUP BY d
		ORDER BY d`,
		username)
	if err != nil {
		return a, fmt.Errorf("last 7 days: %w", err)
	}
	defer dayRows.Close()
	for dayRows.Next() {
		var d DayCount
		if err := dayRows.Scan(&d.Date, &d.Total); err != nil {
			return a, fmt.Errorf("scan day count: %w", err)
		}
		a.Last7Days = append(a.Last7Days, d)
	}
	return a, dayRows.Err()
}

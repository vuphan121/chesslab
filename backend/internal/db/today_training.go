package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
)

type TodayTrainingSettings struct {
	RepertoireIDs []string
	LinesPerDay   int
}

type TodayTrainingEntry struct {
	RepertoireID string
	CardID       string
}

type TodayTrainingQueue struct {
	Settings *TodayTrainingSettings
	Entries  []TodayTrainingEntry
}

const queueRankGap int64 = 1000000

type rankedTodayTrainingEntry struct {
	TodayTrainingEntry
	rank int64
}

func (s *Store) GetTodayTraining(ctx context.Context, username, queueDate string) (TodayTrainingQueue, error) {
	var out TodayTrainingQueue
	var raw []byte
	var settings TodayTrainingSettings
	err := s.pool.QueryRow(ctx, `
		SELECT repertoire_ids, lines_per_day
		FROM today_training_settings
		WHERE username = $1`, username).Scan(&raw, &settings.LinesPerDay)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return out, nil
		}
		return out, fmt.Errorf("get today training settings: %w", err)
	}
	if err := json.Unmarshal(raw, &settings.RepertoireIDs); err != nil {
		return out, fmt.Errorf("decode today training settings: %w", err)
	}
	out.Settings = &settings

	rows, err := s.pool.Query(ctx, `
		SELECT repertoire_id, card_id
		FROM today_training_queue
		WHERE username = $1 AND queue_date = $2::date
		ORDER BY queue_rank`, username, queueDate)
	if err != nil {
		return out, fmt.Errorf("get today training queue: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var entry TodayTrainingEntry
		if err := rows.Scan(&entry.RepertoireID, &entry.CardID); err != nil {
			return out, fmt.Errorf("scan today training entry: %w", err)
		}
		out.Entries = append(out.Entries, entry)
	}
	return out, rows.Err()
}

func (s *Store) SaveTodayTraining(ctx context.Context, username, queueDate string, settings TodayTrainingSettings, entries []TodayTrainingEntry) (TodayTrainingQueue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("begin today training: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockTodayTraining(ctx, tx, username); err != nil {
		return TodayTrainingQueue{}, err
	}
	raw, err := json.Marshal(settings.RepertoireIDs)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("encode today training settings: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO today_training_settings (username, repertoire_ids, lines_per_day, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (username) DO UPDATE SET repertoire_ids = EXCLUDED.repertoire_ids, lines_per_day = EXCLUDED.lines_per_day, updated_at = now()`,
		username, raw, settings.LinesPerDay)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("save today training settings: %w", err)
	}
	if err := replaceTodayTrainingQueue(ctx, tx, username, queueDate, entries); err != nil {
		return TodayTrainingQueue{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("commit today training: %w", err)
	}
	return TodayTrainingQueue{Settings: &settings, Entries: entries}, nil
}

// RefreshTodayTraining replaces a stale queue only if the settings observed by
// the caller are still current. If another device changed settings meanwhile,
// it returns that newer queue instead of restoring stale data.
func (s *Store) RefreshTodayTraining(ctx context.Context, username, queueDate string, expected TodayTrainingSettings, entries []TodayTrainingEntry) (TodayTrainingQueue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("begin today training refresh: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockTodayTraining(ctx, tx, username); err != nil {
		return TodayTrainingQueue{}, err
	}

	current, err := getTodayTrainingTx(ctx, tx, username, queueDate)
	if err != nil {
		return TodayTrainingQueue{}, err
	}
	if current.Settings == nil || !sameTodayTrainingSettings(*current.Settings, expected) {
		if err := tx.Commit(ctx); err != nil {
			return TodayTrainingQueue{}, fmt.Errorf("commit today training refresh: %w", err)
		}
		return current, nil
	}
	if err := replaceTodayTrainingQueue(ctx, tx, username, queueDate, entries); err != nil {
		return TodayTrainingQueue{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("commit today training refresh: %w", err)
	}
	return TodayTrainingQueue{Settings: &expected, Entries: entries}, nil
}

func (s *Store) AdvanceTodayTraining(ctx context.Context, username, queueDate, repertoireID, cardID string) (TodayTrainingQueue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("begin today training advance: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := lockTodayTraining(ctx, tx, username); err != nil {
		return TodayTrainingQueue{}, err
	}

	var raw []byte
	var settings TodayTrainingSettings
	err = tx.QueryRow(ctx, `
		SELECT repertoire_ids, lines_per_day
		FROM today_training_settings
		WHERE username = $1`, username).Scan(&raw, &settings.LinesPerDay)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("get today training settings: %w", err)
	}
	if err := json.Unmarshal(raw, &settings.RepertoireIDs); err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("decode today training settings: %w", err)
	}

	rows, err := tx.Query(ctx, `
		SELECT repertoire_id, card_id, queue_rank
		FROM today_training_queue
		WHERE username = $1 AND queue_date = $2::date
		ORDER BY queue_rank
		FOR UPDATE`, username, queueDate)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("lock today training queue: %w", err)
	}
	entries := []rankedTodayTrainingEntry{}
	for rows.Next() {
		var entry rankedTodayTrainingEntry
		if err := rows.Scan(&entry.RepertoireID, &entry.CardID, &entry.rank); err != nil {
			rows.Close()
			return TodayTrainingQueue{}, fmt.Errorf("scan today training entry: %w", err)
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return TodayTrainingQueue{}, err
	}
	rows.Close()

	found := -1
	for i, entry := range entries {
		if entry.RepertoireID == repertoireID && entry.CardID == cardID {
			found = i
			break
		}
	}
	if found < 0 {
		return TodayTrainingQueue{}, fmt.Errorf("today training entry not found")
	}
	moved := entries[found].TodayTrainingEntry
	entries = append(entries[:found], entries[found+1:]...)
	insertAt := len(entries)
	rank, rebalance := rankForInsert(entries, insertAt)
	if rebalance {
		if err := rebalanceTodayTrainingQueue(ctx, tx, username, queueDate, entries); err != nil {
			return TodayTrainingQueue{}, err
		}
		rank, _ = rankForInsert(entries, insertAt)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE today_training_queue
		SET queue_rank = $1
		WHERE username = $2 AND queue_date = $3::date AND repertoire_id = $4 AND card_id = $5`,
		rank, username, queueDate, moved.RepertoireID, moved.CardID); err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("move today training entry: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("commit today training advance: %w", err)
	}
	entries = append(entries, rankedTodayTrainingEntry{})
	copy(entries[insertAt+1:], entries[insertAt:])
	entries[insertAt] = rankedTodayTrainingEntry{TodayTrainingEntry: moved, rank: rank}
	out := make([]TodayTrainingEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.TodayTrainingEntry)
	}
	return TodayTrainingQueue{Settings: &settings, Entries: out}, nil
}

// The queue is one logical resource per user. A transaction-scoped advisory
// lock serializes settings rebuilds and advances even when two devices hit
// different rows (or the queue is temporarily empty, where row locks cannot
// protect anything).
func lockTodayTraining(ctx context.Context, tx pgx.Tx, username string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, username); err != nil {
		return fmt.Errorf("lock today training: %w", err)
	}
	return nil
}

func getTodayTrainingTx(ctx context.Context, tx pgx.Tx, username, queueDate string) (TodayTrainingQueue, error) {
	var out TodayTrainingQueue
	var raw []byte
	var settings TodayTrainingSettings
	if err := tx.QueryRow(ctx, `
		SELECT repertoire_ids, lines_per_day FROM today_training_settings WHERE username = $1`, username).Scan(&raw, &settings.LinesPerDay); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return out, nil
		}
		return out, fmt.Errorf("get today training settings: %w", err)
	}
	if err := json.Unmarshal(raw, &settings.RepertoireIDs); err != nil {
		return out, fmt.Errorf("decode today training settings: %w", err)
	}
	out.Settings = &settings
	rows, err := tx.Query(ctx, `
		SELECT repertoire_id, card_id FROM today_training_queue
		WHERE username = $1 AND queue_date = $2::date ORDER BY queue_rank`, username, queueDate)
	if err != nil {
		return out, fmt.Errorf("get today training queue: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var entry TodayTrainingEntry
		if err := rows.Scan(&entry.RepertoireID, &entry.CardID); err != nil {
			return out, fmt.Errorf("scan today training entry: %w", err)
		}
		out.Entries = append(out.Entries, entry)
	}
	return out, rows.Err()
}

func sameTodayTrainingSettings(left, right TodayTrainingSettings) bool {
	if left.LinesPerDay != right.LinesPerDay || len(left.RepertoireIDs) != len(right.RepertoireIDs) {
		return false
	}
	for index := range left.RepertoireIDs {
		if left.RepertoireIDs[index] != right.RepertoireIDs[index] {
			return false
		}
	}
	return true
}

func replaceTodayTrainingQueue(ctx context.Context, tx pgx.Tx, username, queueDate string, entries []TodayTrainingEntry) error {
	if _, err := tx.Exec(ctx, `DELETE FROM today_training_queue WHERE username = $1 AND queue_date = $2::date`, username, queueDate); err != nil {
		return fmt.Errorf("clear today training queue: %w", err)
	}
	for position, entry := range entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO today_training_queue (username, queue_date, queue_position, queue_rank, repertoire_id, card_id)
			VALUES ($1, $2::date, $3, $4, $5, $6)`, username, queueDate, position, int64(position+1)*queueRankGap, entry.RepertoireID, entry.CardID); err != nil {
			return fmt.Errorf("insert today training entry: %w", err)
		}
	}
	return nil
}

func rankForInsert(entries []rankedTodayTrainingEntry, insertAt int) (int64, bool) {
	if len(entries) == 0 {
		return queueRankGap, false
	}
	if insertAt == 0 {
		if entries[0].rank <= math.MinInt64+queueRankGap {
			return 0, true
		}
		return entries[0].rank - queueRankGap, false
	}
	if insertAt >= len(entries) {
		if entries[len(entries)-1].rank >= math.MaxInt64-queueRankGap {
			return 0, true
		}
		return entries[len(entries)-1].rank + queueRankGap, false
	}
	left, right := entries[insertAt-1].rank, entries[insertAt].rank
	if right-left <= 1 {
		return 0, true
	}
	return left + (right-left)/2, false
}

func rebalanceTodayTrainingQueue(ctx context.Context, tx pgx.Tx, username, queueDate string, entries []rankedTodayTrainingEntry) error {
	for index := range entries {
		entries[index].rank = int64(index+1) * queueRankGap
		if _, err := tx.Exec(ctx, `
			UPDATE today_training_queue
			SET queue_rank = $1
			WHERE username = $2 AND queue_date = $3::date AND repertoire_id = $4 AND card_id = $5`,
			entries[index].rank, username, queueDate, entries[index].RepertoireID, entries[index].CardID); err != nil {
			return fmt.Errorf("rebalance today training queue: %w", err)
		}
	}
	return nil
}

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

func (s *Store) GetTodayTraining(ctx context.Context, username string) (TodayTrainingQueue, error) {
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
		WHERE username = $1 AND queue_date = CURRENT_DATE
		ORDER BY queue_rank`, username)
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

func (s *Store) SaveTodayTraining(ctx context.Context, username string, settings TodayTrainingSettings, entries []TodayTrainingEntry) (TodayTrainingQueue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("begin today training: %w", err)
	}
	defer tx.Rollback(ctx)
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
	if err := replaceTodayTrainingQueue(ctx, tx, username, entries); err != nil {
		return TodayTrainingQueue{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("commit today training: %w", err)
	}
	return TodayTrainingQueue{Settings: &settings, Entries: entries}, nil
}

func (s *Store) AdvanceTodayTraining(ctx context.Context, username, repertoireID, cardID string, incorrect bool, importance float64) (TodayTrainingQueue, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("begin today training advance: %w", err)
	}
	defer tx.Rollback(ctx)

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
		WHERE username = $1 AND queue_date = CURRENT_DATE
		ORDER BY queue_rank
		FOR UPDATE`, username)
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
	if importance < 0 {
		importance = 0
	}
	if importance > 1 {
		importance = 1
	}
	insertAt := len(entries)
	if incorrect {
		insertAt = int(float64(len(entries)) * (0.5 - 0.25*importance))
	} else {
		insertAt = int(float64(len(entries)) * (1 - 0.25*importance))
	}
	rank, rebalance := rankForInsert(entries, insertAt)
	if rebalance {
		if err := rebalanceTodayTrainingQueue(ctx, tx, username, entries); err != nil {
			return TodayTrainingQueue{}, err
		}
		rank, _ = rankForInsert(entries, insertAt)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE today_training_queue
		SET queue_rank = $1
		WHERE username = $2 AND queue_date = CURRENT_DATE AND repertoire_id = $3 AND card_id = $4`,
		rank, username, moved.RepertoireID, moved.CardID); err != nil {
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

func replaceTodayTrainingQueue(ctx context.Context, tx pgx.Tx, username string, entries []TodayTrainingEntry) error {
	if _, err := tx.Exec(ctx, `DELETE FROM today_training_queue WHERE username = $1 AND queue_date = CURRENT_DATE`, username); err != nil {
		return fmt.Errorf("clear today training queue: %w", err)
	}
	for position, entry := range entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO today_training_queue (username, queue_date, queue_position, queue_rank, repertoire_id, card_id)
			VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)`, username, position, int64(position+1)*queueRankGap, entry.RepertoireID, entry.CardID); err != nil {
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

func rebalanceTodayTrainingQueue(ctx context.Context, tx pgx.Tx, username string, entries []rankedTodayTrainingEntry) error {
	for index := range entries {
		entries[index].rank = int64(index+1) * queueRankGap
		if _, err := tx.Exec(ctx, `
			UPDATE today_training_queue
			SET queue_rank = $1
			WHERE username = $2 AND queue_date = CURRENT_DATE AND repertoire_id = $3 AND card_id = $4`,
			entries[index].rank, username, entries[index].RepertoireID, entries[index].CardID); err != nil {
			return fmt.Errorf("rebalance today training queue: %w", err)
		}
	}
	return nil
}

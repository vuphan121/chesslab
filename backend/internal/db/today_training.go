package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

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
		ORDER BY queue_position`, username)
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

func (s *Store) AdvanceTodayTraining(ctx context.Context, username, repertoireID, cardID string, incorrect bool) (TodayTrainingQueue, error) {
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
		SELECT repertoire_id, card_id
		FROM today_training_queue
		WHERE username = $1 AND queue_date = CURRENT_DATE
		ORDER BY queue_position
		FOR UPDATE`, username)
	if err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("lock today training queue: %w", err)
	}
	entries := []TodayTrainingEntry{}
	for rows.Next() {
		var entry TodayTrainingEntry
		if err := rows.Scan(&entry.RepertoireID, &entry.CardID); err != nil {
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
	moved := entries[found]
	entries = append(entries[:found], entries[found+1:]...)
	insertAt := len(entries)
	if incorrect {
		insertAt = len(entries) / 2
	}
	entries = append(entries, TodayTrainingEntry{})
	copy(entries[insertAt+1:], entries[insertAt:])
	entries[insertAt] = moved

	if err := replaceTodayTrainingQueue(ctx, tx, username, entries); err != nil {
		return TodayTrainingQueue{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TodayTrainingQueue{}, fmt.Errorf("commit today training advance: %w", err)
	}
	return TodayTrainingQueue{Settings: &settings, Entries: entries}, nil
}

func replaceTodayTrainingQueue(ctx context.Context, tx pgx.Tx, username string, entries []TodayTrainingEntry) error {
	if _, err := tx.Exec(ctx, `DELETE FROM today_training_queue WHERE username = $1 AND queue_date = CURRENT_DATE`, username); err != nil {
		return fmt.Errorf("clear today training queue: %w", err)
	}
	for position, entry := range entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO today_training_queue (username, queue_date, queue_position, repertoire_id, card_id)
			VALUES ($1, CURRENT_DATE, $2, $3, $4)`, username, position, entry.RepertoireID, entry.CardID); err != nil {
			return fmt.Errorf("insert today training entry: %w", err)
		}
	}
	return nil
}

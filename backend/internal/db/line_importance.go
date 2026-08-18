package db

import (
	"context"
	"fmt"
)

type LineImportance struct {
	CardID     string
	PlayCount  int64
	Importance float64
}

func (s *Store) GetLineImportance(ctx context.Context, repertoireID string) (map[string]LineImportance, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT card_id, play_count, importance
		FROM repertoire_line_importance
		WHERE repertoire_id = $1`, repertoireID)
	if err != nil {
		return nil, fmt.Errorf("get line importance: %w", err)
	}
	defer rows.Close()
	out := map[string]LineImportance{}
	for rows.Next() {
		var entry LineImportance
		if err := rows.Scan(&entry.CardID, &entry.PlayCount, &entry.Importance); err != nil {
			return nil, fmt.Errorf("scan line importance: %w", err)
		}
		out[entry.CardID] = entry
	}
	return out, rows.Err()
}

func (s *Store) ReplaceLineImportance(ctx context.Context, repertoireID string, entries []LineImportance) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin line importance: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM repertoire_line_importance WHERE repertoire_id = $1`, repertoireID); err != nil {
		return fmt.Errorf("clear line importance: %w", err)
	}
	for _, entry := range entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO repertoire_line_importance (repertoire_id, card_id, play_count, importance, calculated_at)
			VALUES ($1, $2, $3, $4, now())`, repertoireID, entry.CardID, entry.PlayCount, entry.Importance); err != nil {
			return fmt.Errorf("insert line importance: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit line importance: %w", err)
	}
	return nil
}

func (s *Store) DeleteLineImportance(ctx context.Context, repertoireID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM repertoire_line_importance WHERE repertoire_id = $1`, repertoireID)
	if err != nil {
		return fmt.Errorf("delete line importance: %w", err)
	}
	return nil
}

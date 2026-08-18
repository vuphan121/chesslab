package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type RepertoireSource struct {
	ID        string
	SourceURL string
	PGN       string
	Config    json.RawMessage
	UpdatedAt time.Time
}

func (s *Store) SaveRepertoireSource(ctx context.Context, source RepertoireSource) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO repertoire_sources (id, source_url, pgn, config, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url, pgn = EXCLUDED.pgn, config = EXCLUDED.config, updated_at = now()`,
		source.ID, source.SourceURL, source.PGN, source.Config)
	if err != nil {
		return fmt.Errorf("save repertoire source %q: %w", source.ID, err)
	}
	return nil
}

func (s *Store) GetRepertoireSource(ctx context.Context, id string) (RepertoireSource, bool, error) {
	var source RepertoireSource
	err := s.pool.QueryRow(ctx, `
		SELECT id, source_url, pgn, config, updated_at
		FROM repertoire_sources WHERE id = $1`, id).Scan(&source.ID, &source.SourceURL, &source.PGN, &source.Config, &source.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RepertoireSource{}, false, nil
		}
		return RepertoireSource{}, false, fmt.Errorf("get repertoire source %q: %w", id, err)
	}
	return source, true, nil
}

func (s *Store) LoadRepertoireSources(ctx context.Context) ([]RepertoireSource, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, source_url, pgn, config, updated_at FROM repertoire_sources ORDER BY updated_at, id`)
	if err != nil {
		return nil, fmt.Errorf("load repertoire sources: %w", err)
	}
	defer rows.Close()
	var sources []RepertoireSource
	for rows.Next() {
		var source RepertoireSource
		if err := rows.Scan(&source.ID, &source.SourceURL, &source.PGN, &source.Config, &source.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan repertoire source: %w", err)
		}
		sources = append(sources, source)
	}
	return sources, rows.Err()
}

package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const DefaultPieceTheme = "classic"

type UserSettings struct {
	PieceTheme string
}

func (s *Store) GetUserSettings(ctx context.Context, username string) (UserSettings, error) {
	settings := UserSettings{PieceTheme: DefaultPieceTheme}
	err := s.pool.QueryRow(ctx, `
		SELECT piece_theme
		FROM user_settings
		WHERE username = $1`, username).Scan(&settings.PieceTheme)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return settings, nil
		}
		return UserSettings{}, fmt.Errorf("get user settings: %w", err)
	}
	return settings, nil
}

func (s *Store) SaveUserSettings(ctx context.Context, username string, settings UserSettings) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_settings (username, piece_theme, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (username) DO UPDATE SET
			piece_theme = EXCLUDED.piece_theme,
			updated_at = now()`, username, settings.PieceTheme)
	if err != nil {
		return fmt.Errorf("save user settings: %w", err)
	}
	return nil
}

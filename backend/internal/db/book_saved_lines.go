package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// SavedLineMove is one ply of the line the user saved from the Study-from-Book
// board. score/mate are White-relative centipawns (same convention as the eval
// bar); hasEval is false when no engine value was available at save time.
type SavedLineMove struct {
	San     string `json:"san"`
	Uci     string `json:"uci"`
	Fen     string `json:"fen"`
	Score   int    `json:"score"`
	Mate    int    `json:"mate"`
	HasEval bool   `json:"hasEval"`
}

type SavedLine struct {
	ID        int64           `json:"id"`
	StartFen  string          `json:"startFen"`
	Moves     []SavedLineMove `json:"moves"`
	CreatedAt time.Time       `json:"createdAt"`
}

// GetBookSavedLine returns the single saved line for (user, book, item), or nil
// if none has been saved.
func (s *Store) GetBookSavedLine(ctx context.Context, username, bookID, itemID string) (*SavedLine, error) {
	var sl SavedLine
	var movesRaw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, start_fen, moves, created_at
		FROM book_saved_lines
		WHERE username = $1 AND book_id = $2 AND item_id = $3`,
		username, bookID, itemID).Scan(&sl.ID, &sl.StartFen, &movesRaw, &sl.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query book_saved_lines: %w", err)
	}
	if err := json.Unmarshal(movesRaw, &sl.Moves); err != nil {
		return nil, fmt.Errorf("decode saved line moves: %w", err)
	}
	return &sl, nil
}

// SaveBookLine upserts the one saved line for (user, book, item).
func (s *Store) SaveBookLine(ctx context.Context, username, bookID, itemID, startFen string, moves []SavedLineMove) (SavedLine, error) {
	raw, err := json.Marshal(moves)
	if err != nil {
		return SavedLine{}, fmt.Errorf("encode saved line moves: %w", err)
	}
	sl := SavedLine{StartFen: startFen, Moves: moves}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO book_saved_lines (username, book_id, item_id, start_fen, moves)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (username, book_id, item_id)
		DO UPDATE SET start_fen = EXCLUDED.start_fen, moves = EXCLUDED.moves, created_at = now()
		RETURNING id, created_at`,
		username, bookID, itemID, startFen, raw).Scan(&sl.ID, &sl.CreatedAt)
	if err != nil {
		return SavedLine{}, fmt.Errorf("upsert book_saved_lines: %w", err)
	}
	return sl, nil
}

func (s *Store) DeleteBookSavedLine(ctx context.Context, username, bookID, itemID string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM book_saved_lines
		WHERE username = $1 AND book_id = $2 AND item_id = $3`,
		username, bookID, itemID)
	if err != nil {
		return fmt.Errorf("delete book_saved_lines: %w", err)
	}
	return nil
}

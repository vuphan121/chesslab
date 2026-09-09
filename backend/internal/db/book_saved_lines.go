package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// SavedLineMove is one ply of a line the user saved from the Study-from-Book
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

func (s *Store) GetBookSavedLines(ctx context.Context, username, bookID, itemID string) ([]SavedLine, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, start_fen, moves, created_at
		FROM book_saved_lines
		WHERE username = $1 AND book_id = $2 AND item_id = $3
		ORDER BY created_at DESC`,
		username, bookID, itemID)
	if err != nil {
		return nil, fmt.Errorf("query book_saved_lines: %w", err)
	}
	defer rows.Close()

	out := make([]SavedLine, 0)
	for rows.Next() {
		var sl SavedLine
		var movesRaw []byte
		if err := rows.Scan(&sl.ID, &sl.StartFen, &movesRaw, &sl.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan book_saved_lines: %w", err)
		}
		if err := json.Unmarshal(movesRaw, &sl.Moves); err != nil {
			return nil, fmt.Errorf("decode saved line moves: %w", err)
		}
		out = append(out, sl)
	}
	return out, rows.Err()
}

func (s *Store) SaveBookLine(ctx context.Context, username, bookID, itemID, startFen string, moves []SavedLineMove) (SavedLine, error) {
	raw, err := json.Marshal(moves)
	if err != nil {
		return SavedLine{}, fmt.Errorf("encode saved line moves: %w", err)
	}
	sl := SavedLine{StartFen: startFen, Moves: moves}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO book_saved_lines (username, book_id, item_id, start_fen, moves)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`,
		username, bookID, itemID, startFen, raw).Scan(&sl.ID, &sl.CreatedAt)
	if err != nil {
		return SavedLine{}, fmt.Errorf("insert book_saved_lines: %w", err)
	}
	return sl, nil
}

func (s *Store) DeleteBookSavedLine(ctx context.Context, username string, id int64) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM book_saved_lines WHERE id = $1 AND username = $2`,
		id, username)
	if err != nil {
		return fmt.Errorf("delete book_saved_lines: %w", err)
	}
	return nil
}

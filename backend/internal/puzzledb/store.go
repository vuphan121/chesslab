package puzzledb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/chesslab/backend/internal/puzzle"
	_ "github.com/tursodatabase/libsql-client-go/libsql"
)

const countsTTL = 10 * time.Minute

var ratingWindows = []int{75, 150, 300, 600, 5000}

const Schema = `
CREATE TABLE IF NOT EXISTS puzzles (
    id TEXT PRIMARY KEY,
    fen TEXT NOT NULL,
    moves TEXT NOT NULL,
    rating INTEGER NOT NULL,
    themes TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS puzzle_themes (
    theme TEXT NOT NULL,
    k INTEGER NOT NULL,
    id TEXT NOT NULL,
    PRIMARY KEY (theme, k, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS theme_counts (
    theme TEXT PRIMARY KEY,
    n INTEGER NOT NULL
) WITHOUT ROWID;
`

var ErrNotConfigured = errors.New("puzzle database is not configured (PUZZLE_DB_URL / PUZZLE_DB_TOKEN)")

type Store struct {
	db *sql.DB

	mu       sync.Mutex
	counts   map[string]int
	countsAt time.Time
}

func Open(rawURL, token string) (*Store, error) {
	if rawURL == "" {
		return nil, ErrNotConfigured
	}
	dsn := rawURL
	if token != "" {
		u, err := url.Parse(rawURL)
		if err != nil {
			return nil, fmt.Errorf("parse puzzle db url: %w", err)
		}
		q := u.Query()
		q.Set("authToken", token)
		u.RawQuery = q.Encode()
		dsn = u.String()
	}
	db, err := sql.Open("libsql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open puzzle db: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetConnMaxIdleTime(30 * time.Second)
	return &Store{db: db}, nil
}

func NewFromDB(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) EnsureSchema(ctx context.Context) error {
	for _, stmt := range strings.Split(Schema, ";") {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("puzzle db schema: %w", err)
		}
	}
	return nil
}

func (s *Store) ThemeCounts(ctx context.Context) (map[string]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.counts != nil && time.Since(s.countsAt) < countsTTL {
		return s.counts, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT theme, n FROM theme_counts`)
	if err != nil {
		return nil, fmt.Errorf("theme counts: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var theme string
		var n int
		if err := rows.Scan(&theme, &n); err != nil {
			return nil, err
		}
		out[theme] = n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	s.counts, s.countsAt = out, time.Now()
	return out, nil
}

func (s *Store) WriteThemeCounts(ctx context.Context, counts map[string]int) error {
	for theme, n := range counts {
		if _, err := s.db.ExecContext(ctx, `INSERT OR REPLACE INTO theme_counts (theme, n) VALUES (?, ?)`, theme, n); err != nil {
			return fmt.Errorf("write theme count %s: %w", theme, err)
		}
	}
	s.InvalidateCounts()
	return nil
}

func (s *Store) InvalidateCounts() {
	s.mu.Lock()
	s.counts = nil
	s.mu.Unlock()
}

func splitThemes(joined string) []string {
	if joined == "" {
		return []string{}
	}
	return strings.Fields(joined)
}

func (s *Store) Get(ctx context.Context, id string) (*puzzle.Puzzle, error) {
	var p puzzle.Puzzle
	var themes string
	err := s.db.QueryRowContext(ctx, `SELECT id, fen, moves, rating, themes FROM puzzles WHERE id = ?`, id).
		Scan(&p.ID, &p.FEN, &p.Moves, &p.Rating, &themes)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get puzzle: %w", err)
	}
	p.Themes = splitThemes(themes)
	return &p, nil
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func (s *Store) pickInRange(ctx context.Context, theme string, from, to int64, exclude []string) (*puzzle.Puzzle, error) {
	if from > to {
		return nil, nil
	}
	query := `SELECT p.id, p.fen, p.moves, p.rating, p.themes
		FROM puzzle_themes t JOIN puzzles p ON p.id = t.id
		WHERE t.theme = ? AND t.k >= ? AND t.k <= ?`
	args := []any{theme, from, to}
	if len(exclude) > 0 {
		query += ` AND t.id NOT IN (` + placeholders(len(exclude)) + `)`
		for _, id := range exclude {
			args = append(args, id)
		}
	}
	query += ` ORDER BY t.k LIMIT 1`
	var p puzzle.Puzzle
	var themes string
	err := s.db.QueryRowContext(ctx, query, args...).Scan(&p.ID, &p.FEN, &p.Moves, &p.Rating, &themes)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("pick puzzle: %w", err)
	}
	p.Themes = splitThemes(themes)
	return &p, nil
}

func (s *Store) Next(ctx context.Context, theme string, rating float64, exclude []string) (*puzzle.Puzzle, error) {
	for _, window := range ratingWindows {
		lo := max(0, int(rating)-window)
		hi := int(rating) + window
		minK := puzzle.RatingKey(lo, 0)
		maxK := puzzle.RatingKey(hi, puzzle.KeyScale-1)
		start := minK + rand.Int63n(maxK-minK+1)
		p, err := s.pickInRange(ctx, theme, start, maxK, exclude)
		if err != nil || p != nil {
			return p, err
		}
		p, err = s.pickInRange(ctx, theme, minK, start-1, exclude)
		if err != nil || p != nil {
			return p, err
		}
	}
	return nil, nil
}

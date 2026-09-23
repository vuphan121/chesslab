package db

import (
	"context"
	_ "embed"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

type Store struct {
	pool *pgxpool.Pool
}

func Connect(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	s := &Store{pool: pool}
	if err := s.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	var sqlOnly strings.Builder
	for _, line := range strings.Split(schemaSQL, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		sqlOnly.WriteString(line)
		sqlOnly.WriteString("\n")
	}

	for _, stmt := range strings.Split(sqlOnly.String(), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := s.pool.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt, err)
		}
	}
	return s.migrateRelationships(ctx)
}

type foreignKeyMigration struct {
	table      string
	name       string
	definition string
}

// relationshipMigrations also apply the foreign keys to databases whose tables
// predate the inline constraints in schema.sql. NOT VALID avoids a table scan
// (and a deployment failure due to historical orphan rows) while PostgreSQL
// still enforces the relationship for every new or updated row.
var relationshipMigrations = []foreignKeyMigration{
	{"card_progress", "card_progress_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
	{"line_attempts", "line_attempts_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
	{"progress_operations", "progress_operations_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
	{"book_item_progress", "book_item_progress_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
	{"book_study_activity", "book_study_activity_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
	{"book_saved_lines", "book_saved_lines_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
	{"today_training_settings", "today_training_settings_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
	{"today_training_queue", "today_training_queue_settings_fk", "FOREIGN KEY (username) REFERENCES today_training_settings (username) ON DELETE CASCADE NOT VALID"},
	{"saved_puzzles", "saved_puzzles_user_fk", "FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE NOT VALID"},
}

func (s *Store) migrateRelationships(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin relationship migration: %w", err)
	}
	defer tx.Rollback(ctx)

	// Serializes this idempotent check-and-add sequence when multiple app
	// instances start against the same production database simultaneously.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('chesslab_relationships_v1'))`); err != nil {
		return fmt.Errorf("lock relationship migration: %w", err)
	}

	for _, fk := range relationshipMigrations {
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conrelid = to_regclass($1)
				  AND conname = $2
			)`, fk.table, fk.name).Scan(&exists); err != nil {
			return fmt.Errorf("check constraint %s: %w", fk.name, err)
		}
		if exists {
			continue
		}
		statement := fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s %s", fk.table, fk.name, fk.definition)
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("add constraint %s: %w", fk.name, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit relationship migration: %w", err)
	}
	return nil
}

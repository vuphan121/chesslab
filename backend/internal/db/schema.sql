CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
    username TEXT PRIMARY KEY CONSTRAINT user_settings_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    piece_theme TEXT NOT NULL DEFAULT 'classic'
        CHECK (piece_theme IN ('classic', 'glass')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_progress (
    username TEXT NOT NULL CONSTRAINT card_progress_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    repertoire_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    box INT NOT NULL DEFAULT 0,
    lapses INT NOT NULL DEFAULT 0,
    seen INT NOT NULL DEFAULT 0,
    correct INT NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, repertoire_id, card_id)
);

CREATE TABLE IF NOT EXISTS line_attempts (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL CONSTRAINT line_attempts_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    repertoire_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_name TEXT NOT NULL,
    card_id TEXT NOT NULL,
    had_mistake BOOLEAN NOT NULL,
    played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progress_operations (
    username TEXT NOT NULL CONSTRAINT progress_operations_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, operation_id)
);

CREATE INDEX IF NOT EXISTS line_attempts_username_played_at_idx
    ON line_attempts (username, played_at DESC);

CREATE TABLE IF NOT EXISTS book_item_progress (
    username TEXT NOT NULL CONSTRAINT book_item_progress_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, book_id, item_id)
);

CREATE TABLE IF NOT EXISTS book_study_activity (
    username TEXT NOT NULL CONSTRAINT book_study_activity_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    book_title TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_name TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('lesson', 'puzzle')),
    activity_hour TIMESTAMPTZ NOT NULL,
    first_moved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, book_id, chapter_id, item_id, activity_hour)
);

CREATE INDEX IF NOT EXISTS book_study_activity_username_first_moved_at_idx
    ON book_study_activity (username, first_moved_at DESC);

CREATE TABLE IF NOT EXISTS book_saved_lines (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL CONSTRAINT book_saved_lines_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    start_fen TEXT NOT NULL,
    moves JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DELETE FROM book_saved_lines a USING book_saved_lines b
    WHERE a.id < b.id AND a.username = b.username AND a.book_id = b.book_id AND a.item_id = b.item_id;

DROP INDEX IF EXISTS book_saved_lines_user_item_idx;

CREATE UNIQUE INDEX IF NOT EXISTS book_saved_lines_uniq
    ON book_saved_lines (username, book_id, item_id);

CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS today_training_settings (
    username TEXT PRIMARY KEY CONSTRAINT today_training_settings_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    repertoire_ids JSONB NOT NULL,
    lines_per_day INT NOT NULL CHECK (lines_per_day BETWEEN 1 AND 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS today_training_queue (
    username TEXT NOT NULL CONSTRAINT today_training_queue_settings_fk
        REFERENCES today_training_settings (username) ON DELETE CASCADE,
    queue_date DATE NOT NULL,
    queue_position INT NOT NULL,
    queue_rank BIGINT NOT NULL,
    repertoire_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, queue_date, queue_position),
    UNIQUE (username, queue_date, repertoire_id, card_id)
);

CREATE INDEX IF NOT EXISTS today_training_queue_username_date_idx
    ON today_training_queue (username, queue_date, queue_position);

ALTER TABLE today_training_queue ADD COLUMN IF NOT EXISTS queue_rank BIGINT;
UPDATE today_training_queue SET queue_rank = queue_position::BIGINT * 1000000 WHERE queue_rank IS NULL;
ALTER TABLE today_training_queue ALTER COLUMN queue_rank SET NOT NULL;

CREATE INDEX IF NOT EXISTS today_training_queue_username_date_rank_idx
    ON today_training_queue (username, queue_date, queue_rank);

CREATE TABLE IF NOT EXISTS today_training_operations (
    username TEXT NOT NULL CONSTRAINT today_training_operations_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    queue_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, operation_id)
);

CREATE INDEX IF NOT EXISTS today_training_operations_created_at_idx
    ON today_training_operations (created_at);

CREATE INDEX IF NOT EXISTS today_training_queue_date_idx
    ON today_training_queue (queue_date);

CREATE TABLE IF NOT EXISTS repertoire_sources (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    pgn TEXT NOT NULL,
    config JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repertoire_line_importance (
    repertoire_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    play_count BIGINT NOT NULL,
    importance DOUBLE PRECISION NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (repertoire_id, card_id)
);

CREATE TABLE IF NOT EXISTS position_evals (
    fen_key TEXT PRIMARY KEY,
    score INT NOT NULL,
    mate INT NOT NULL,
    depth INT NOT NULL,
    engine_name TEXT NOT NULL,
    best_moves JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TABLE IF EXISTS saved_puzzles;

-- Observability for the eval-precompute cron endpoint (POST /api/cron/precompute-evals).
-- One row per background run.
CREATE TABLE IF NOT EXISTS precompute_runs (
    id BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    duration_ms BIGINT,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'budget_exhausted', 'failed', 'interrupted')),
    budget_ms BIGINT NOT NULL,
    stockfish_available BOOLEAN NOT NULL,
    total_positions INT NOT NULL DEFAULT 0,
    backlog_size INT NOT NULL DEFAULT 0,
    attempted INT NOT NULL DEFAULT 0,
    processed INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    remaining INT NOT NULL DEFAULT 0,
    error TEXT
);

CREATE INDEX IF NOT EXISTS precompute_runs_started_at_idx
    ON precompute_runs (started_at DESC);

-- One row per position attempted in a run (the per-line detail).
CREATE TABLE IF NOT EXISTS precompute_run_positions (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES precompute_runs (id) ON DELETE CASCADE,
    fen_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'compute_failed', 'save_failed')),
    engine_name TEXT,
    depth INT,
    duration_ms BIGINT NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS precompute_run_positions_run_idx
    ON precompute_run_positions (run_id);

CREATE INDEX IF NOT EXISTS precompute_run_positions_fen_idx
    ON precompute_run_positions (fen_key, created_at DESC);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
    username TEXT NOT NULL CONSTRAINT puzzle_attempts_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    puzzle_id TEXT NOT NULL,
    played_at TIMESTAMPTZ NOT NULL,
    win BOOLEAN NOT NULL,
    puzzle_rating INT NOT NULL DEFAULT 0,
    themes JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (username, puzzle_id, played_at)
);

CREATE INDEX IF NOT EXISTS puzzle_attempts_username_played_at_idx
    ON puzzle_attempts (username, played_at DESC);

CREATE TABLE IF NOT EXISTS puzzle_rating_history (
    username TEXT NOT NULL CONSTRAINT puzzle_rating_history_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    day DATE NOT NULL,
    rating INT NOT NULL,
    PRIMARY KEY (username, day)
);

CREATE TABLE IF NOT EXISTS puzzle_sync_state (
    username TEXT PRIMARY KEY CONSTRAINT puzzle_sync_state_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    lichess_username TEXT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts_added INT NOT NULL DEFAULT 0
);

DROP TABLE IF EXISTS puzzles;

CREATE TABLE IF NOT EXISTS puzzle_theme_ratings (
    username TEXT NOT NULL CONSTRAINT puzzle_theme_ratings_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    theme TEXT NOT NULL,
    rating DOUBLE PRECISION NOT NULL DEFAULT 2000,
    attempts INT NOT NULL DEFAULT 0,
    wins INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, theme)
);

CREATE TABLE IF NOT EXISTS puzzle_plays (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL CONSTRAINT puzzle_plays_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    puzzle_id TEXT NOT NULL,
    theme TEXT NOT NULL,
    solved BOOLEAN NOT NULL,
    puzzle_rating INT NOT NULL,
    rating_before DOUBLE PRECISION NOT NULL,
    rating_after DOUBLE PRECISION NOT NULL,
    played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (username, operation_id)
);

CREATE INDEX IF NOT EXISTS puzzle_plays_user_puzzle_idx
    ON puzzle_plays (username, puzzle_id);

CREATE INDEX IF NOT EXISTS puzzle_plays_user_played_idx
    ON puzzle_plays (username, played_at DESC);

CREATE TABLE IF NOT EXISTS puzzle_retry_queue (
    username TEXT NOT NULL CONSTRAINT puzzle_retry_queue_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    puzzle_id TEXT NOT NULL,
    theme TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, puzzle_id)
);

CREATE TABLE IF NOT EXISTS puzzle_daily_stats (
    username TEXT NOT NULL CONSTRAINT puzzle_daily_stats_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    day DATE NOT NULL,
    plays INT NOT NULL DEFAULT 0,
    wins INT NOT NULL DEFAULT 0,
    avg_rating DOUBLE PRECISION,
    PRIMARY KEY (username, day)
);

CREATE TABLE IF NOT EXISTS puzzle_theme_daily (
    username TEXT NOT NULL CONSTRAINT puzzle_theme_daily_user_fk
        REFERENCES users (username) ON DELETE CASCADE,
    day DATE NOT NULL,
    theme TEXT NOT NULL,
    plays INT NOT NULL DEFAULT 0,
    wins INT NOT NULL DEFAULT 0,
    PRIMARY KEY (username, day, theme)
);

-- One-off backfill of the aggregates from the existing puzzle_plays rows (runs only while the aggregate table is empty).
-- Days use Asia/Ho_Chi_Minh because old rows did not record the user's time zone.
INSERT INTO puzzle_theme_daily (username, day, theme, plays, wins)
SELECT username, (played_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, theme, COUNT(*), COUNT(*) FILTER (WHERE solved)
FROM puzzle_plays
WHERE NOT EXISTS (SELECT 1 FROM puzzle_theme_daily)
GROUP BY 1, 2, 3;

WITH local_plays AS (
    SELECT username, (played_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, theme, solved, rating_after, played_at
    FROM puzzle_plays
), days AS (
    SELECT username, day, COUNT(*) AS plays, COUNT(*) FILTER (WHERE solved) AS wins FROM local_plays GROUP BY 1, 2
), latest AS (
    SELECT d.username, d.day, p.theme, (array_agg(p.rating_after ORDER BY p.played_at DESC))[1] AS r
    FROM days d JOIN local_plays p ON p.username = d.username AND p.day <= d.day
    GROUP BY d.username, d.day, p.theme
), avg_by_day AS (
    SELECT username, day, AVG(r) AS avg_rating FROM latest GROUP BY 1, 2
)
INSERT INTO puzzle_daily_stats (username, day, plays, wins, avg_rating)
SELECT d.username, d.day, d.plays, d.wins, a.avg_rating
FROM days d JOIN avg_by_day a ON a.username = d.username AND a.day = d.day
WHERE NOT EXISTS (SELECT 1 FROM puzzle_daily_stats);

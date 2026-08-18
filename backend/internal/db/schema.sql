CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_progress (
    username TEXT NOT NULL,
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
    username TEXT NOT NULL,
    repertoire_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_name TEXT NOT NULL,
    card_id TEXT NOT NULL,
    had_mistake BOOLEAN NOT NULL,
    played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS line_attempts_username_played_at_idx
    ON line_attempts (username, played_at DESC);

CREATE TABLE IF NOT EXISTS book_item_progress (
    username TEXT NOT NULL,
    book_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, book_id, item_id)
);

CREATE TABLE IF NOT EXISTS book_study_activity (
    username TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS today_training_settings (
    username TEXT PRIMARY KEY,
    repertoire_ids JSONB NOT NULL,
    lines_per_day INT NOT NULL CHECK (lines_per_day BETWEEN 1 AND 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS today_training_queue (
    username TEXT NOT NULL,
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

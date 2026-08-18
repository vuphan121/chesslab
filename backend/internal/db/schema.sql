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

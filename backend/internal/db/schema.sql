-- The single login (see internal/auth's package doc) — bcrypt hash, never
-- plaintext. Seeded/rotated at boot from AUTH_USERNAME/AUTH_PASSWORD env
-- vars (see main.go's seedUser); this table is the source of truth Login
-- actually checks against, the env vars are just how you set/change it.
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-card scheduler state, one row per (username, repertoire, card) —
-- mirrors what used to live in the frontend's localStorage wholesale, now
-- server-side so progress follows the user across devices. Never pruned;
-- this IS the learning state, not a log.
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

-- One row per completed drill run ("line"). Raw material for the "lines
-- studied today / this week, by chapter" analytics and, later, a smarter
-- scheduler. Unlike card_progress this is a log, not state — old rows carry
-- no lasting value once the aggregates that matter have been computed, so
-- it's pruned on a retention window (see cleanup.go), not kept forever.
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

-- One row per (username, book, item) the user has completed in the "Study
-- from Book" feature (lesson started / puzzle solved / puzzle solution
-- revealed) — presence of a row means done, no boolean column needed.
-- Deliberately the only piece of book-study state that persists: the
-- per-item move history a user plays while exploring a puzzle is ephemeral
-- frontend state, never sent here (see useBookStudySession.ts).
CREATE TABLE IF NOT EXISTS book_item_progress (
    username TEXT NOT NULL,
    book_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, book_id, item_id)
);

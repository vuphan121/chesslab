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

-- Book content for the "Study from Book" feature, stored here instead of a
-- committed file so it never has to touch git — not even as a gitignored
-- local file that a deploy target would need copied onto it by hand. What's
-- stored is still only facts (FEN/moves) plus original prose (see
-- docs/study-from-book/data-format.md §1), the same copyright boundary as
-- the file-based path; the DB is just a different, git-free place to keep
-- it. One row per book, whole parsed-and-validated JSON blob in `data` (see
-- internal/book.ParseAndValidate, shared with the file-loading path so both
-- go through the identical FEN/legality QA gate). Populated by the
-- `cmd/seedbooks` one-off tool, not a user-facing upload endpoint.
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

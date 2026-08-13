// seedbooks is a one-off admin tool, not part of the running server: it
// reads every *.json book file from a local directory (default
// backend/data/books/, gitignored — never committed) and upserts each one
// into the `books` table of whatever DATABASE_URL it's pointed at. That's
// the intended way to get book content onto a deployed instance, since the
// content itself never touches git — run this once against the production
// DATABASE_URL (same value Render/Neon uses) after extracting a new book or
// chapter locally, and the running backend picks it up on its next restart
// (see cmd/server/main.go's loadBooks, which prefers the DB over the local
// directory whenever a database is configured).
//
// Usage:
//
//	DATABASE_URL=postgres://... go run ./cmd/seedbooks [dir]
//
// dir defaults to data/books. Each file is validated with the same
// chess-engine QA gate the server itself uses (internal/book.ParseAndValidate)
// before being written — a bad file fails the seed run instead of quietly
// landing in the database.
package main

import (
	"bufio"
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/db"
)

// loadDotEnv is a copy of cmd/server's own helper (KEY=VALUE per line,
// doesn't override a variable already set in the real environment) — small
// enough that duplicating it beats introducing a shared package just for
// this. DATABASE_URL in particular tends to contain unescaped `&`/`?`
// characters that break a plain `source .env` in a shell, so this is also
// the easiest correct way to point this tool at the local dev database.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, strings.TrimSpace(value)) //nolint:errcheck
		}
	}
}

func main() {
	loadDotEnv(".env")

	dir := "data/books"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Fatalf("reading %q: %v", dir, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := db.Connect(ctx, url)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer store.Close()

	seeded := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			log.Fatalf("reading %s: %v", path, err)
		}

		b, err := book.ParseAndValidate(data)
		if err != nil {
			log.Fatalf("%s failed validation: %v", e.Name(), err)
		}

		saveCtx, saveCancel := context.WithTimeout(context.Background(), 15*time.Second)
		err = store.SaveBook(saveCtx, b.ID, data)
		saveCancel()
		if err != nil {
			log.Fatalf("saving %s: %v", e.Name(), err)
		}

		itemCount := 0
		for _, ch := range b.Chapters {
			itemCount += len(ch.Items)
		}
		log.Printf("seeded %q (%s, %d chapters, %d items) from %s", b.ID, b.Title, len(b.Chapters), itemCount, e.Name())
		seeded++
	}

	if seeded == 0 {
		log.Printf("no *.json files found in %q — nothing to seed", dir)
	} else {
		log.Printf("done — seeded %d book(s)", seeded)
	}
}

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
			os.Setenv(key, strings.TrimSpace(value))
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

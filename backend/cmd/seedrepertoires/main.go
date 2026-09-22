// Command seedrepertoires upserts DB-managed opening-trainer repertoires into the
// `repertoire_sources` Postgres table, the same store the in-app "Manage
// repertoires" import/refresh flow writes to (internal/db/repertoire_sources.go,
// internal/api/repertoire_management_handler.go).
//
// Each input is a <name>.config.json sidecar (repertoire.Config: id, name, side,
// source study URL, description, excluded rules). For every sidecar this fetches
// the Lichess study PGN fresh, parses + builds it (hard-failing if it has no
// drillable lines), and upserts {id, source_url, pgn, config} keyed by id. On the
// server's next boot, loadManagedRepertoires replays these rows over any
// file-based repertoire of the same id loaded from data/repertoires/.
//
// Usage:
//
//	DATABASE_URL=... [LICHESS_TOKEN=...] go run ./cmd/seedrepertoires [dir]
//
// dir defaults to data/managed-repertoires. .env in the working directory is
// loaded for any vars not already set, matching cmd/seedbooks.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/repertoire"
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

	dir := "data/managed-repertoires"
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	token := os.Getenv("LICHESS_TOKEN")

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
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".config.json") {
			continue
		}
		path := filepath.Join(dir, e.Name())

		cfg, err := repertoire.LoadConfig(path)
		if err != nil {
			log.Fatalf("%s: %v", e.Name(), err)
		}
		if cfg.ID == "" || cfg.Source == "" {
			log.Fatalf("%s: config needs both \"id\" and \"source\"", e.Name())
		}

		fetchCtx, fetchCancel := context.WithTimeout(context.Background(), 45*time.Second)
		pgn, canonical, err := repertoire.FetchStudyPGN(fetchCtx, cfg.Source, token)
		fetchCancel()
		if err != nil {
			log.Fatalf("%s: fetch %s: %v", e.Name(), cfg.Source, err)
		}
		cfg.Source = canonical

		rep, err := repertoire.ParseAndBuild(pgn, cfg)
		if err != nil {
			log.Fatalf("%s: parse study: %v", e.Name(), err)
		}
		if len(rep.Chapters) == 0 || len(rep.Cards) == 0 {
			log.Fatalf("%s: study has no drillable repertoire lines for side %q", e.Name(), cfg.Side)
		}

		rawConfig, err := json.Marshal(cfg)
		if err != nil {
			log.Fatalf("%s: encode config: %v", e.Name(), err)
		}

		saveCtx, saveCancel := context.WithTimeout(context.Background(), 15*time.Second)
		err = store.SaveRepertoireSource(saveCtx, db.RepertoireSource{
			ID:        cfg.ID,
			SourceURL: canonical,
			PGN:       pgn,
			Config:    rawConfig,
		})
		saveCancel()
		if err != nil {
			log.Fatalf("%s: %v", e.Name(), err)
		}

		log.Printf("seeded %q (%s, %d chapters, %d cards) from %s", cfg.ID, cfg.Name, len(rep.Chapters), len(rep.Cards), canonical)
		seeded++
	}

	if seeded == 0 {
		log.Printf("no *.config.json files found in %q — nothing to seed", dir)
	} else {
		log.Printf("done — seeded %d repertoire(s)", seeded)
	}
}

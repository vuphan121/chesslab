package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/evalprecompute"
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

	force := false
	for _, arg := range os.Args[1:] {
		if arg == "--force" {
			force = true
		}
	}

	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}

	connectCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	store, err := db.Connect(connectCtx, url)
	cancel()
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer store.Close()

	sfPath := os.Getenv("STOCKFISH_PATH")
	if sfPath == "" {
		sfPath = "stockfish"
	}
	eng, err := engine.New(sfPath)
	if err != nil {
		log.Printf("stockfish unavailable (%v) — positions with no cloud-eval hit will be skipped", err)
		eng = nil
	} else {
		defer eng.Close()
	}

	repDir := os.Getenv("REPERTOIRES_PATH")
	if repDir == "" {
		repDir = "data/repertoires"
	}
	repos := repertoire.NewStore(repertoire.LoadDir(repDir))
	loadManagedRepertoires(store, repos)

	all := evalprecompute.EnumeratePositions(repos.List())

	existing := map[string]bool{}
	if !force {
		listCtx, listCancel := context.WithTimeout(context.Background(), 30*time.Second)
		existing, err = store.AllPositionEvalKeys(listCtx)
		listCancel()
		if err != nil {
			log.Fatalf("load existing evals: %v", err)
		}
	}

	var backlog []string
	for _, key := range all {
		if force || !existing[key] {
			backlog = append(backlog, key)
		}
	}
	log.Printf("precompute: %d total position(s) across %d repertoire(s), %d to compute", len(all), len(repos.List()), len(backlog))

	done, failed := 0, 0
	for i, key := range backlog {
		result, err := evalprecompute.Compute(eng, key)
		if err != nil {
			log.Printf("precompute: %s — %v", key, err)
			failed++
			continue
		}
		saveCtx, saveCancel := context.WithTimeout(context.Background(), 10*time.Second)
		err = store.UpsertPositionEval(saveCtx, result)
		saveCancel()
		if err != nil {
			log.Printf("precompute: %s — save failed: %v", key, err)
			failed++
			continue
		}
		done++
		if (i+1)%25 == 0 || i+1 == len(backlog) {
			log.Printf("precompute: %d/%d done (%d failed so far)", i+1, len(backlog), failed)
		}
	}
	log.Printf("precompute: finished — %d computed, %d failed", done, failed)
}

func loadManagedRepertoires(store *db.Store, repos *repertoire.Store) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	sources, err := store.LoadRepertoireSources(ctx)
	if err != nil {
		log.Printf("repertoire: failed to load managed repertoires (%v)", err)
		return
	}
	for _, source := range sources {
		if source.PGN == "" {
			log.Printf("repertoire: managed %q is pending its first refresh", source.ID)
			continue
		}
		var cfg repertoire.Config
		if err := json.Unmarshal(source.Config, &cfg); err != nil {
			log.Printf("repertoire: skipping managed %q due to invalid config (%v)", source.ID, err)
			continue
		}
		rep, err := repertoire.ParseAndBuild(source.PGN, &cfg)
		if err != nil {
			log.Printf("repertoire: skipping managed %q due to parse error (%v)", source.ID, err)
			continue
		}
		repos.Upsert(rep)
		log.Printf("repertoire: loaded managed %q (%d cards)", rep.ID, len(rep.Cards))
	}
}

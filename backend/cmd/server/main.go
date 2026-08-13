package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/api"
	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/coach"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/repertoire"
	"github.com/chesslab/backend/internal/storage"
)

// loadDotEnv sets environment variables from a .env file (KEY=VALUE per line)
// without overriding any variable already set in the real environment.
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

	store := storage.NewMemory()

	sfPath := os.Getenv("STOCKFISH_PATH")
	if sfPath == "" {
		sfPath = "stockfish"
	}
	eng, err := engine.New(sfPath)
	if err != nil {
		log.Printf("stockfish unavailable (%v) — analysis endpoint will return 503", err)
	} else {
		log.Printf("engine: %s", eng.Name)
	}

	index, overview, llm := newCoachDeps()
	coachTools := coach.NewTools(eng, index, overview)
	coachSvc := coach.NewService(coachTools, llm)
	coachAgent := coach.NewAgent(coachTools, llm)

	repDir := os.Getenv("REPERTOIRES_PATH")
	if repDir == "" {
		repDir = "data/repertoires"
	}
	repertoires := repertoire.NewStore(repertoire.LoadDir(repDir))

	// Optional, unlike repertoires above: backend/data/books/ is gitignored
	// (personal book content, not for redistribution — see root CLAUDE.md's
	// "Study from Book" section), so most checkouts and the deployed instance
	// have zero books. LoadDir already returns nil on a missing dir; /api/books
	// just serves an empty list rather than the server needing this data to boot.
	booksDir := os.Getenv("BOOKS_PATH")
	if booksDir == "" {
		booksDir = "data/books"
	}
	books := book.NewStore(book.LoadDir(booksDir))

	dbStore := newDBStore()
	authCfg := newAuthConfig()
	if dbStore != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := dbStore.SeedUser(ctx, authCfg.Username, authCfg.Password); err != nil {
			log.Printf("db: failed to seed user %q (%v) — login will fall back to the env-var check", authCfg.Username, err)
		} else {
			log.Printf("db: user %q seeded/updated from AUTH_USERNAME/AUTH_PASSWORD", authCfg.Username)
		}
		cancel()
	}

	handler := api.NewHandler(store, eng, coachSvc, coachAgent, repertoires, books, dbStore, authCfg)
	router := api.NewRouter(handler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Printf("chesslab backend listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatal(err)
	}
}

// newCoachDeps wires up the AI coach's shared dependencies: the
// opening-theory index plus a client for a locally-served, OpenAI-compatible
// LLM (Ollama by default). The index is optional — if it fails to load, the
// coach still runs on engine/explorer grounding alone (see
// coach.Service.ExplainMove / coach.Agent.Chat).
func newCoachDeps() (*coach.Index, *coach.OverviewIndex, *coach.OllamaClient) {
	chunksPath := os.Getenv("COACH_CHUNKS_PATH")
	if chunksPath == "" {
		chunksPath = "data/opening-sources/accelerated-dragon/chunks.validated.json"
	}

	index, err := coach.LoadIndex(chunksPath)
	if err != nil {
		log.Printf("coach: theory index unavailable (%v) — explanations will skip book grounding", err)
		index = nil
	} else {
		log.Printf("coach: loaded theory index (%d exact positions, %d with nearby transposition hints)", index.Len(), index.PrefixLen())
	}

	overviewPath := os.Getenv("COACH_OVERVIEW_PATH")
	if overviewPath == "" {
		overviewPath = "data/opening-sources/accelerated-dragon/overview.json"
	}
	overview, err := coach.LoadOverviewIndex(overviewPath)
	if err != nil {
		log.Printf("coach: opening-overview corpus unavailable (%v) — general opening questions will lack book context", err)
		overview = nil
	} else {
		log.Printf("coach: loaded opening-overview corpus (%d passages)", overview.Len())
	}

	llm := coach.NewOllamaClient(os.Getenv("OLLAMA_BASE_URL"), os.Getenv("COACH_MODEL"))
	log.Printf("coach: LLM client -> %s (model %s)", llm.BaseURL, llm.Model)

	return index, overview, llm
}

// newDBStore connects the trainer-progress-sync Postgres store — optional,
// same graceful-degradation pattern as Stockfish/LICHESS_TOKEN/the coach:
// if DATABASE_URL is unset or the connection fails, progress/analytics
// endpoints return 503 and everything else (board, engine, drilling itself)
// is unaffected.
func newDBStore() *db.Store {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Printf("db: DATABASE_URL unset — trainer progress sync/analytics endpoints will return 503")
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	store, err := db.Connect(ctx, url)
	if err != nil {
		log.Printf("db: connect failed (%v) — trainer progress sync/analytics endpoints will return 503", err)
		return nil
	}
	log.Printf("db: connected, schema migrated")

	retentionDays := 90
	if v := os.Getenv("LINE_ATTEMPTS_RETENTION_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			retentionDays = n
		}
	}
	store.StartCleanupLoop(time.Duration(retentionDays)*24*time.Hour, 12*time.Hour)
	log.Printf("db: line_attempts retention %d days", retentionDays)

	return store
}

// newAuthConfig reads the single hardcoded login (see internal/auth's
// package doc for why it's just one user, not a table). Username/password
// are required — this gates the whole API, so refusing to start without
// them is safer than silently leaving everything open. JWT_SECRET falls
// back to a random value generated at boot if unset, purely for local-dev
// convenience; that means restarting the process invalidates every
// outstanding token, so set it explicitly in production (see backend/.env.example).
func newAuthConfig() auth.Config {
	username := os.Getenv("AUTH_USERNAME")
	password := os.Getenv("AUTH_PASSWORD")
	if username == "" || password == "" {
		log.Fatal("AUTH_USERNAME and AUTH_PASSWORD must both be set — see backend/.env.example")
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			log.Fatalf("failed to generate a fallback JWT_SECRET: %v", err)
		}
		secret = hex.EncodeToString(buf)
		log.Printf("auth: JWT_SECRET unset — generated a random one for this run only; every token is invalidated on restart. Set JWT_SECRET explicitly in production.")
	}

	return auth.Config{Username: username, Password: password, JWTSecret: []byte(secret)}
}

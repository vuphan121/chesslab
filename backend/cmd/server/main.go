package main

import (
	"bufio"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/chesslab/backend/internal/api"
	"github.com/chesslab/backend/internal/coach"
	"github.com/chesslab/backend/internal/engine"
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

	handler := api.NewHandler(store, eng, coachSvc, coachAgent)
	router := api.NewRouter(handler)

	addr := ":8080"
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
		log.Printf("coach: loaded theory index (%d positions)", index.Len())
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

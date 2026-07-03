package main

import (
	"bufio"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/chesslab/backend/internal/api"
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

	handler := api.NewHandler(store, eng)
	router := api.NewRouter(handler)

	addr := ":8080"
	log.Printf("chesslab backend listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatal(err)
	}
}

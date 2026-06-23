package main

import (
	"log"
	"net/http"
	"os"

	"github.com/chesslab/backend/internal/api"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/storage"
)

func main() {
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

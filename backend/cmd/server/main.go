package main

import (
	"log"
	"net/http"

	"github.com/chesslab/backend/internal/api"
	"github.com/chesslab/backend/internal/storage"
)

func main() {
	store := storage.NewMemory()
	handler := api.NewHandler(store)
	router := api.NewRouter(handler)

	addr := ":8080"
	log.Printf("chesslab backend listening on %s", addr)
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatal(err)
	}
}

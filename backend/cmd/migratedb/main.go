// Command migratedb applies Chesslab's idempotent database schema migrations
// without starting the HTTP server or seeding application data.
package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/chesslab/backend/internal/db"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	store, err := db.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("migrate database: %v", err)
	}
	store.Close()
	log.Print("database schema migrated")
}

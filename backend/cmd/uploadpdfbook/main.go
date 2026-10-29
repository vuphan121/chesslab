package main

import (
	"bufio"
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/api"
	"github.com/chesslab/backend/internal/booksource"
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
	if len(os.Args) != 3 {
		log.Fatal("usage: go run ./cmd/uploadpdfbook <file.pdf> <book-id>   (id: lowercase letters, digits, _ or -)")
	}
	path, id := os.Args[1], os.Args[2]
	prefix := os.Getenv("B2_PDF_PREFIX")
	if prefix == "" {
		prefix = "pdfbooks"
	}
	key, ok := api.PDFBookObjectKey(prefix, id)
	if !ok {
		log.Fatalf("invalid book id %q", id)
	}
	b2, err := booksource.NewB2FromEnv()
	if err != nil || b2 == nil {
		log.Fatalf("B2 is not configured: %v", err)
	}
	f, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	if err := b2.Upload(ctx, key, "application/pdf", f, info.Size()); err != nil {
		log.Fatal(err)
	}
	log.Printf("uploaded %s (%d bytes) to %s", path, info.Size(), key)
}

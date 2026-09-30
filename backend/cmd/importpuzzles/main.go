package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/puzzle"
	"github.com/klauspost/compress/zstd"
)

const defaultURL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"

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

func open(file, url string) (io.ReadCloser, error) {
	var raw io.ReadCloser
	var name string
	if file != "" {
		f, err := os.Open(file)
		if err != nil {
			return nil, err
		}
		raw, name = f, file
	} else {
		resp, err := http.Get(url)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("download %s: status %d", url, resp.StatusCode)
		}
		raw, name = resp.Body, url
	}
	if !strings.HasSuffix(name, ".zst") {
		return raw, nil
	}
	dec, err := zstd.NewReader(raw)
	if err != nil {
		raw.Close()
		return nil, err
	}
	return struct {
		io.Reader
		io.Closer
	}{dec, closerFunc(func() error { dec.Close(); return raw.Close() })}, nil
}

type closerFunc func() error

func (c closerFunc) Close() error { return c() }

func main() {
	loadDotEnv(".env")
	file := flag.String("file", "", "local lichess_db_puzzle.csv or .csv.zst (default: download it)")
	url := flag.String("url", defaultURL, "download URL when --file is not given")
	perBand := flag.Int("per-band", 10, "candidates sampled per theme per rating band")
	target := flag.Int("target", 10000, "total puzzles to keep, filled evenly across themes and rating bands (0 = keep every sampled puzzle)")
	replace := flag.Bool("replace", false, "empty the puzzles table before inserting")
	band := flag.Int("band", 50, "rating band width")
	minRating := flag.Int("min-rating", 400, "lowest puzzle rating kept")
	maxRating := flag.Int("max-rating", 3500, "highest puzzle rating kept")
	minPop := flag.Int("min-popularity", 80, "minimum Lichess popularity score")
	minPlays := flag.Int("min-plays", 300, "minimum number of plays")
	seed := flag.Int64("seed", time.Now().UnixNano(), "sampling seed")
	dryRun := flag.Bool("dry-run", false, "sample and report, do not write to the database")
	flag.Parse()

	var store *db.Store
	if !*dryRun {
		dbURL := os.Getenv("DATABASE_URL")
		if dbURL == "" {
			log.Fatal("DATABASE_URL is required (or pass --dry-run)")
		}
		var err error
		store, err = db.Connect(context.Background(), dbURL)
		if err != nil {
			log.Fatalf("connect: %v", err)
		}
		defer store.Close()
	}

	src, err := open(*file, *url)
	if err != nil {
		log.Fatal(err)
	}
	defer src.Close()

	sampler := puzzle.NewSampler(puzzle.SampleOptions{
		PerBand: *perBand, BandWidth: *band, MinRating: *minRating, MaxRating: *maxRating,
		MinPopularity: *minPop, MinPlays: *minPlays, Seed: *seed,
	})
	started := time.Now()
	bad, err := puzzle.ReadCSV(src, func(r puzzle.Row) {
		sampler.Add(r)
		if sampler.Seen%500000 == 0 {
			log.Printf("read %d puzzles...", sampler.Seen)
		}
	})
	if err != nil {
		log.Fatalf("read: %v", err)
	}
	rows := sampler.ResultLimited(*target)
	log.Printf("read %d puzzles (%d unparseable) in %s, kept %d", sampler.Seen, bad, time.Since(started).Round(time.Second), len(rows))
	if *dryRun {
		return
	}
	if *replace {
		if err := store.ClearPuzzles(context.Background()); err != nil {
			log.Fatalf("clear: %v", err)
		}
		log.Printf("emptied the puzzles table")
	}
	inserted, err := store.InsertPuzzles(context.Background(), rows)
	if err != nil {
		log.Fatalf("insert: %v", err)
	}
	log.Printf("inserted %d new puzzle(s), %d already present", inserted, len(rows)-inserted)
}

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
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chesslab/backend/internal/puzzle"
	"github.com/chesslab/backend/internal/puzzledb"
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

type closerFunc func() error

func (c closerFunc) Close() error { return c() }

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

func download(url string) (string, error) {
	tmp, err := os.CreateTemp("", "lichess_db_puzzle-*.csv.zst")
	if err != nil {
		return "", err
	}
	defer tmp.Close()
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: status %d", url, resp.StatusCode)
	}
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		return "", err
	}
	return tmp.Name(), nil
}

type filter struct {
	minRating, maxRating int
	minPop, minPlays     int
}

func (f filter) keep(r puzzle.Row) bool {
	return r.Rating >= f.minRating && r.Rating <= f.maxRating && r.Popularity >= f.minPop && r.NbPlays >= f.minPlays
}

type plan struct {
	puzzles    int
	themeRows  int
	bytes      int64
	bands      map[int]int
	bandThemes map[int]int
	themeCount map[string]int
	bad        int
}

func (p plan) writes() int { return p.puzzles + p.themeRows + len(p.themeCount) }

func scan(file, url string, f filter) (plan, error) {
	src, err := open(file, url)
	if err != nil {
		return plan{}, err
	}
	defer src.Close()
	p := plan{bands: map[int]int{}, bandThemes: map[int]int{}, themeCount: map[string]int{}}
	seen := 0
	bad, err := puzzle.ReadCSV(src, func(r puzzle.Row) {
		seen++
		if seen%1000000 == 0 {
			log.Printf("scanned %d puzzles...", seen)
		}
		if !f.keep(r) {
			return
		}
		themes := r.SelectableThemes()
		p.puzzles++
		p.themeRows += len(themes)
		p.bands[r.Rating/100*100]++
		p.bandThemes[r.Rating/100*100] += len(themes)
		p.bytes += int64(len(r.ID) + len(r.FEN) + len(r.Moves) + 4 + len(strings.Join(themes, " ")) + 24*len(themes))
		for _, t := range themes {
			p.themeCount[t]++
		}
	})
	p.bad = bad
	return p, err
}

func printPlan(p plan) {
	fmt.Printf("puzzles kept: %d\ntheme index rows: %d\nestimated rows written (puzzles + theme index + counts): %d\nestimated size: %.0f MB\n", p.puzzles, p.themeRows, p.writes(), float64(p.bytes)/1e6)
	var bands []int
	for b := range p.bands {
		bands = append(bands, b)
	}
	sort.Ints(bands)
	fmt.Println("per 100-point rating band: puzzles, rows written (puzzle + theme index rows), cumulative writes from the top:")
	cumulative := map[int]int{}
	total := 0
	for i := len(bands) - 1; i >= 0; i-- {
		total += p.bands[bands[i]] + p.bandThemes[bands[i]]
		cumulative[bands[i]] = total
	}
	for _, b := range bands {
		fmt.Printf("  %4d-%4d  %8d  %9d  %10d\n", b, b+99, p.bands[b], p.bands[b]+p.bandThemes[b], cumulative[b])
	}
}

type loader struct {
	store *puzzledb.Store
	size  int
	jobs  chan batch
	wg    sync.WaitGroup
	done  atomic.Int64
	fail  atomic.Int64
}

type batch struct {
	puzzles []puzzle.Row
	themes  []themeRow
}

type themeRow struct {
	theme string
	k     int64
	id    string
}

func (l *loader) start(workers int) {
	l.jobs = make(chan batch, workers*2)
	for i := 0; i < workers; i++ {
		l.wg.Add(1)
		go func() {
			defer l.wg.Done()
			for b := range l.jobs {
				if err := l.write(b); err != nil {
					l.fail.Add(1)
					log.Printf("batch failed: %v", err)
					continue
				}
				l.done.Add(int64(len(b.puzzles)))
			}
		}()
	}
}

func (l *loader) write(b batch) error {
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		lastErr = l.writeOnce(ctx, b)
		cancel()
		if lastErr == nil {
			return nil
		}
	}
	return lastErr
}

func (l *loader) writeOnce(ctx context.Context, b batch) error {
	tx, err := l.store.DB().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	const puzzleChunk = 400
	for i := 0; i < len(b.puzzles); i += puzzleChunk {
		end := min(i+puzzleChunk, len(b.puzzles))
		var sb strings.Builder
		sb.WriteString("INSERT OR IGNORE INTO puzzles (id, fen, moves, rating, themes) VALUES ")
		args := make([]any, 0, (end-i)*5)
		for j, r := range b.puzzles[i:end] {
			if j > 0 {
				sb.WriteString(",")
			}
			sb.WriteString("(?,?,?,?,?)")
			args = append(args, r.ID, r.FEN, r.Moves, r.Rating, strings.Join(r.SelectableThemes(), " "))
		}
		if _, err := tx.ExecContext(ctx, sb.String(), args...); err != nil {
			return err
		}
	}
	const themeChunk = 1000
	for i := 0; i < len(b.themes); i += themeChunk {
		end := min(i+themeChunk, len(b.themes))
		var sb strings.Builder
		sb.WriteString("INSERT OR IGNORE INTO puzzle_themes (theme, k, id) VALUES ")
		args := make([]any, 0, (end-i)*3)
		for j, t := range b.themes[i:end] {
			if j > 0 {
				sb.WriteString(",")
			}
			sb.WriteString("(?,?,?)")
			args = append(args, t.theme, t.k, t.id)
		}
		if _, err := tx.ExecContext(ctx, sb.String(), args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func main() {
	loadDotEnv(".env")
	file := flag.String("file", "", "local lichess_db_puzzle.csv or .csv.zst (default: download it)")
	url := flag.String("url", defaultURL, "download URL when --file is not given")
	minRating := flag.Int("min-rating", 1800, "lowest puzzle rating kept")
	maxRating := flag.Int("max-rating", 2599, "highest puzzle rating kept (2599 keeps an estimated 8.4M writes, under the Turso free tier's 10M a month)")
	minPop := flag.Int("min-popularity", 0, "minimum Lichess popularity score")
	minPlays := flag.Int("min-plays", 0, "minimum number of plays")
	countsOnly := flag.Bool("counts-only", false, "only (re)write the per-theme counts from a scan of the file, leaving the puzzles as they are")
	statsOnly := flag.Bool("stats", false, "scan the file and print how many rows would be written, without touching the database")
	replace := flag.Bool("replace", false, "drop the puzzle tables before loading")
	maxWrites := flag.Int("max-writes", 9_000_000, "refuse to load when the estimated rows written exceeds this (Turso free tier allows 10M a month)")
	batchSize := flag.Int("batch", 600, "puzzles per transaction")
	workers := flag.Int("workers", 6, "parallel writers")
	flag.Parse()
	f := filter{*minRating, *maxRating, *minPop, *minPlays}

	path := *file
	if path == "" && !*statsOnly {
		log.Printf("downloading %s ...", *url)
		var err error
		if path, err = download(*url); err != nil {
			log.Fatal(err)
		}
		defer os.Remove(path)
	}

	started := time.Now()
	p, err := scan(path, *url, f)
	if err != nil {
		log.Fatalf("scan: %v", err)
	}
	log.Printf("scanned in %s (%d unparseable rows)", time.Since(started).Round(time.Second), p.bad)
	printPlan(p)
	if *statsOnly {
		return
	}
	if *countsOnly {
		store, err := puzzledb.Open(os.Getenv("PUZZLE_DB_URL"), os.Getenv("PUZZLE_DB_TOKEN"))
		if err != nil {
			log.Fatalf("puzzle database: %v", err)
		}
		defer store.Close()
		if err := store.EnsureSchema(context.Background()); err != nil {
			log.Fatal(err)
		}
		if err := store.WriteThemeCounts(context.Background(), p.themeCount); err != nil {
			log.Fatal(err)
		}
		log.Printf("wrote counts for %d themes", len(p.themeCount))
		return
	}
	if p.writes() > *maxWrites {
		log.Fatalf("estimated %d rows written exceeds --max-writes %d: raise --min-rating or lower --max-rating, or raise the limit on purpose", p.writes(), *maxWrites)
	}

	store, err := puzzledb.Open(os.Getenv("PUZZLE_DB_URL"), os.Getenv("PUZZLE_DB_TOKEN"))
	if err != nil {
		log.Fatalf("puzzle database: %v (set PUZZLE_DB_URL and PUZZLE_DB_TOKEN in backend/.env)", err)
	}
	defer store.Close()
	ctx := context.Background()
	if *replace {
		for _, table := range []string{"puzzle_themes", "puzzles", "theme_counts"} {
			if _, err := store.DB().ExecContext(ctx, "DROP TABLE IF EXISTS "+table); err != nil {
				log.Fatalf("drop %s: %v", table, err)
			}
		}
		log.Printf("dropped the existing puzzle tables")
	}
	if err := store.EnsureSchema(ctx); err != nil {
		log.Fatal(err)
	}

	started = time.Now()
	loaded, failed, err := loadPuzzles(ctx, store, path, *url, f, p.puzzles, *workers, *batchSize)
	if err != nil {
		log.Fatalf("read: %v", err)
	}
	if failed > 0 {
		log.Fatalf("%d batch(es) failed; rerun the same command to fill the gaps (inserts are idempotent)", failed)
	}
	if err := store.WriteThemeCounts(ctx, p.themeCount); err != nil {
		log.Fatal(err)
	}
	log.Printf("done: %d puzzles loaded in %s", loaded, time.Since(started).Round(time.Second))
}

func loadPuzzles(ctx context.Context, store *puzzledb.Store, path, url string, f filter, total, workers, size int) (loaded, failed int64, err error) {
	src, err := open(path, url)
	if err != nil {
		return 0, 0, err
	}
	defer src.Close()
	l := &loader{store: store, size: size}
	l.start(workers)
	current := batch{}
	sent := 0
	flush := func() {
		if len(current.puzzles) == 0 {
			return
		}
		l.jobs <- current
		sent += len(current.puzzles)
		current = batch{}
		if (sent/l.size)%50 == 0 {
			log.Printf("queued %d / %d puzzles, written %d", sent, total, l.done.Load())
		}
	}
	_, err = puzzle.ReadCSV(src, func(r puzzle.Row) {
		if !f.keep(r) {
			return
		}
		key := puzzle.RatingKey(r.Rating, puzzle.Salt(r.ID))
		for _, t := range r.SelectableThemes() {
			current.themes = append(current.themes, themeRow{theme: t, k: key, id: r.ID})
		}
		current.puzzles = append(current.puzzles, r)
		if len(current.puzzles) >= l.size {
			flush()
		}
	})
	flush()
	close(l.jobs)
	l.wg.Wait()
	return l.done.Load(), l.fail.Load(), err
}

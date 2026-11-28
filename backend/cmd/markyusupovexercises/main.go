package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/db"
)

const bookID = "build-up-your-chess-1"

type exercise struct {
	ItemID       string `json:"itemId"`
	Number       int    `json:"number"`
	SolutionPage int    `json:"solutionPage"`
}

type chapterExercises struct {
	Chapter   int        `json:"chapter"`
	Exercises []exercise `json:"exercises"`
}

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
		if ok {
			if _, exists := os.LookupEnv(strings.TrimSpace(key)); !exists {
				_ = os.Setenv(strings.TrimSpace(key), strings.TrimSpace(value))
			}
		}
	}
}

func mark(chapter *book.Chapter, wanted []exercise) (int, error) {
	byID := make(map[string]exercise, len(wanted))
	for _, e := range wanted {
		byID[e.ItemID] = e
	}
	var others, exercises []book.Item
	numbers := map[string]int{}
	for _, item := range chapter.Items {
		e, ok := byID[item.ID]
		if !ok {
			others = append(others, item)
			continue
		}
		item.Type = "puzzle"
		item.Prompt = fmt.Sprintf("Exercise %d-%d: find the best move.", chapter.Number, e.Number)
		item.SolutionPage = e.SolutionPage
		numbers[item.ID] = e.Number
		exercises = append(exercises, item)
		delete(byID, item.ID)
	}
	for id := range byID {
		return 0, fmt.Errorf("chapter %d has no item %q", chapter.Number, id)
	}
	sort.SliceStable(exercises, func(i, j int) bool { return numbers[exercises[i].ID] < numbers[exercises[j].ID] })
	chapter.Items = append(others, exercises...)
	return len(exercises), nil
}

func main() {
	input := flag.String("exercises", "../tmp/yusupov/exercises.json", "yusupov_exercises.py output")
	dumpPath := flag.String("dump", "", "write the stored book to this file and exit")
	outPath := flag.String("out", "", "also write the updated book JSON to this file")
	apply := flag.Bool("apply", false, "write the updated book to Neon (otherwise dry run)")
	flag.Parse()
	loadDotEnv(".env")
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := db.Connect(ctx, url)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer store.Close()

	rawBooks, err := store.LoadBooks(ctx)
	if err != nil {
		log.Fatal(err)
	}
	var stored json.RawMessage
	var current book.Book
	for _, raw := range rawBooks {
		var parsed book.Book
		if err := json.Unmarshal(raw, &parsed); err != nil {
			log.Fatalf("decode stored book: %v", err)
		}
		if parsed.ID == bookID {
			stored, current = raw, parsed
		}
	}
	if stored == nil {
		log.Fatalf("book %q was not found in Neon", bookID)
	}
	if *dumpPath != "" {
		if err := os.WriteFile(*dumpPath, stored, 0o644); err != nil {
			log.Fatal(err)
		}
		log.Printf("wrote %s", *dumpPath)
		return
	}

	raw, err := os.ReadFile(*input)
	if err != nil {
		log.Fatalf("read exercises: %v", err)
	}
	var chapters []chapterExercises
	if err := json.Unmarshal(raw, &chapters); err != nil {
		log.Fatalf("decode exercises: %v", err)
	}
	total := 0
	for _, wanted := range chapters {
		found := false
		for i := range current.Chapters {
			if current.Chapters[i].Number != wanted.Chapter {
				continue
			}
			count, err := mark(&current.Chapters[i], wanted.Exercises)
			if err != nil {
				log.Fatal(err)
			}
			total += count
			found = true
		}
		if !found {
			log.Fatalf("chapter %d is not in the stored book", wanted.Chapter)
		}
	}
	payload, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := book.ParseAndValidate(payload); err != nil {
		log.Fatalf("updated book failed validation: %v", err)
	}
	log.Printf("marked %d exercises as puzzles in %d chapters", total, len(chapters))
	if *outPath != "" {
		if err := os.WriteFile(*outPath, payload, 0o644); err != nil {
			log.Fatal(err)
		}
		log.Printf("wrote %s", *outPath)
	}
	if !*apply {
		log.Printf("dry run only; re-run with --apply to upsert Neon")
		return
	}
	if err := store.SaveBook(ctx, current.ID, payload); err != nil {
		log.Fatalf("save book: %v", err)
	}
	log.Printf("saved %q to Neon", current.ID)
}

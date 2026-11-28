package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/db"
)

type bookInfo struct {
	prefix string
	title  string
}

var books = map[string]bookInfo{
	"calculation":             {"calc", "Grandmaster Preparation: Calculation"},
	"thinking-inside-the-box": {"titb", "Grandmaster Preparation: Thinking Inside the Box"},
}

type parsedItem struct {
	DiagramNumber  int    `json:"diagramNumber"`
	PiecePlacement string `json:"piecePlacement"`
	SideToMove     string `json:"sideToMove"`
	BookPage       int    `json:"bookPage"`
	MasterPDFPage  int    `json:"masterPDFPage"`
	SourcePage     int    `json:"chapterPDFPage"`
	Exercise       int    `json:"exercise"`
	Test           bool   `json:"test"`
	SolutionPage   int    `json:"solutionPage"`
	StartFEN       string `json:"startFen"`
	Stats          struct {
		Moves  int `json:"moves"`
		Failed int `json:"failed"`
	} `json:"stats"`
	Line json.RawMessage `json:"line"`
}

type parsedBook struct {
	Chapters []struct {
		Number int          `json:"number"`
		Name   string       `json:"name"`
		Items  []parsedItem `json:"items"`
	} `json:"chapters"`
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

func expandPlacement(placement string) string {
	var b strings.Builder
	for _, r := range placement {
		switch {
		case r >= '1' && r <= '8':
			b.WriteString(strings.Repeat(".", int(r-'0')))
		case r != '/':
			b.WriteRune(r)
		}
	}
	return b.String()
}

func placementDiff(a, b string) int {
	x, y, diff := expandPlacement(a), expandPlacement(b), 0
	if len(x) != len(y) {
		return 64
	}
	for i := range x {
		if x[i] != y[i] {
			diff++
		}
	}
	return diff
}

func playable(id string, item book.Item) error {
	payload, err := json.Marshal(book.Book{ID: id, Chapters: []book.Chapter{{ID: "check", Number: 1, Items: []book.Item{item}}}})
	if err != nil {
		return err
	}
	_, err = book.ParseAndValidate(payload)
	return err
}

func main() {
	id := flag.String("book", "", "calculation or thinking-inside-the-box")
	root := flag.String("root", "", "parser output root (default ../tmp/<book>)")
	maxFailed := flag.Float64("max-failed-ratio", 0.10, "attach a solution's author line only if at most this share of its moves failed to parse")
	outPath := flag.String("out", "", "also write the book JSON to this file (for a local overlay; never touches Neon)")
	apply := flag.Bool("apply", false, "write the book to Neon (otherwise dry run)")
	flag.Parse()
	info, ok := books[*id]
	if !ok {
		log.Fatal("-book must be calculation or thinking-inside-the-box")
	}
	if *root == "" {
		*root = "../tmp/" + *id
	}
	loadDotEnv(".env")

	raw, err := os.ReadFile(*root + "/study.json")
	if err != nil {
		log.Fatalf("read study.json: %v", err)
	}
	var source parsedBook
	if err := json.Unmarshal(raw, &source); err != nil {
		log.Fatalf("decode study.json: %v", err)
	}

	out := book.Book{ID: *id, Title: info.title, Author: "Jacob Aagaard"}
	missing, illegal, unknownSide, puzzles, lines := 0, 0, 0, 0, 0
	for _, parsed := range source.Chapters {
		chapter := book.Chapter{ID: fmt.Sprintf("%s-ch%d", info.prefix, parsed.Number), Number: parsed.Number, Name: parsed.Name}
		for _, p := range parsed.Items {
			if p.PiecePlacement == "" {
				missing++
				continue
			}
			side := p.SideToMove
			if side != "w" && side != "b" {
				side = "w"
				unknownSide++
			}
			item := book.Item{
				ID: fmt.Sprintf("%s-diagram-%d", chapter.ID, p.DiagramNumber), ChapterID: chapter.ID, Type: "lesson",
				FEN: p.PiecePlacement + " " + side + " - - 0 1", SideToMove: side,
				Prompt: "Explore the position on the board.", SourcePage: p.SourcePage, BookPage: p.BookPage, MasterPDFPage: p.MasterPDFPage,
			}
			if p.Exercise > 0 || p.Test {
				item.Type = "puzzle"
				item.SolutionPage = p.SolutionPage
				if p.Exercise > 0 {
					item.Prompt = fmt.Sprintf("Exercise %d: find the best move.", p.Exercise)
				} else {
					item.Prompt = "Test yourself: find the best move."
				}
				puzzles++
				fields := strings.Fields(p.StartFEN)
				good := len(fields) > 1 && len(p.Line) > 0 && p.Stats.Moves > 0 && float64(p.Stats.Failed) <= *maxFailed*float64(p.Stats.Moves)
				if good && placementDiff(p.PiecePlacement, fields[0]) <= 3 {
					candidate := item
					candidate.FEN, candidate.SideToMove, candidate.Line = p.StartFEN, fields[1], p.Line
					if playable(*id, candidate) == nil {
						item = candidate
						lines++
					}
				}
			}
			if err := playable(*id, item); err != nil {
				log.Printf("skipping %s: %v", item.ID, err)
				illegal++
				continue
			}
			chapter.Items = append(chapter.Items, item)
		}
		if len(chapter.Items) > 0 && chapter.Items[0].Type == "lesson" {
			chapter.Items[0].SourcePage = 1
		}
		log.Printf("chapter %d %s: %d positions", chapter.Number, chapter.Name, len(chapter.Items))
		out.Chapters = append(out.Chapters, chapter)
	}

	payload, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := book.ParseAndValidate(payload); err != nil {
		log.Fatalf("book failed validation: %v", err)
	}
	log.Printf("%d puzzles; %d have an author line", puzzles, lines)
	log.Printf("%d diagrams had no recognized placement and %d failed validation (all skipped); %d have no side-to-move marker and default to White", missing, illegal, unknownSide)
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
	if err := store.SaveBook(ctx, out.ID, payload); err != nil {
		log.Fatalf("save book: %v", err)
	}
	log.Printf("saved %q to Neon", out.ID)
}

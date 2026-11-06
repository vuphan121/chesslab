package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/db"
)

const solutionPageBase = 151

var chapters = map[int]string{
	1: "Introduction", 2: "Weaknesses", 3: "Pieces", 4: "Prophylaxis", 5: "Exercises",
}

type parsedPosition struct {
	DiagramNumber  int    `json:"diagramNumber"`
	PiecePlacement string `json:"piecePlacement"`
	SideToMove     string `json:"sideToMove"`
	SourcePage     int    `json:"chapterPDFPage"`
	BookPage       int    `json:"bookPage"`
	MasterPDFPage  int    `json:"masterPDFPage"`
}

type commentaryGame struct {
	Exercise      int    `json:"exercise"`
	Page          int    `json:"page"`
	DiagramNumber int    `json:"diagramNumber"`
	StartFEN      string `json:"startFen"`
	Stats         struct {
		Moves  int `json:"moves"`
		Failed int `json:"failed"`
	} `json:"stats"`
	Line json.RawMessage `json:"line"`
}

type parsedChapter struct {
	Positions []parsedPosition `json:"positions"`
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

func main() {
	root := flag.String("root", "../tmp/positional-play", "parser output root (chapter-0..5)")
	commentary := flag.String("commentary", "../tmp/positional-play/commentary/games.json", "commentary_parser.py games.json (optional)")
	maxFailed := flag.Float64("max-failed-ratio", 0.10, "attach a game's author line only if at most this share of its moves failed to parse")
	outPath := flag.String("out", "", "also write the book JSON to this file (for a local overlay; never touches Neon)")
	puzzles := flag.Bool("exercise-puzzles", false, "turn exercises whose diagram matches a solution game into puzzles carrying the author's line")
	apply := flag.Bool("apply", false, "write the book to Neon (otherwise dry run)")
	flag.Parse()
	loadDotEnv(".env")

	games := map[int]commentaryGame{}
	if raw, err := os.ReadFile(*commentary); err == nil {
		var all []commentaryGame
		if err := json.Unmarshal(raw, &all); err != nil {
			log.Fatalf("decode commentary: %v", err)
		}
		for _, g := range all {
			games[g.Exercise] = g
		}
	}
	solutionPages, lineCount, puzzleCount := 0, 0, 0
	out := book.Book{ID: "positional-play", Title: "Grandmaster Preparation: Positional Play", Author: "Jacob Aagaard"}
	missing := 0
	for number := 1; number <= len(chapters); number++ {
		raw, err := os.ReadFile(filepath.Join(*root, fmt.Sprintf("chapter-%d", number-1), "positions.json"))
		if err != nil {
			log.Fatalf("read chapter %d: %v", number, err)
		}
		var source parsedChapter
		if err := json.Unmarshal(raw, &source); err != nil {
			log.Fatalf("decode chapter %d: %v", number, err)
		}
		chapter := book.Chapter{ID: fmt.Sprintf("pp-ch%d", number), Number: number, Name: chapters[number]}
		for _, p := range source.Positions {
			if p.PiecePlacement == "" {
				missing++
				continue
			}
			side := p.SideToMove
			if side != "w" && side != "b" {
				side = "w"
			}
			item := book.Item{
				ID: fmt.Sprintf("pp-ch%d-diagram-%d", number, p.DiagramNumber), ChapterID: chapter.ID, Type: "lesson",
				FEN: p.PiecePlacement + " " + side + " - - 0 1", SideToMove: side,
				Prompt: "Explore the position on the board.", SourcePage: p.SourcePage, BookPage: p.BookPage, MasterPDFPage: p.MasterPDFPage,
			}
			if g, ok := games[p.DiagramNumber]; ok && number == 5 {
				item.Prompt = fmt.Sprintf("Exercise %d: find the best move.", p.DiagramNumber)
				item.SolutionPage = g.Page - solutionPageBase
				solutionPages++
				good := g.StartFEN != "" && len(g.Line) > 0 && g.Stats.Moves > 0 && float64(g.Stats.Failed) <= *maxFailed*float64(g.Stats.Moves)
				fields := strings.Fields(g.StartFEN)
				if *puzzles {
					item.Type = "puzzle"
					puzzleCount++
				}
				if good && len(fields) > 1 && placementDiff(p.PiecePlacement, fields[0]) <= 3 && (p.SideToMove == "" || p.SideToMove == fields[1]) {
					lineCount++
					if *puzzles {
						item.FEN, item.SideToMove, item.Line = g.StartFEN, fields[1], g.Line
					}
				}
			}
			chapter.Items = append(chapter.Items, item)
		}
		log.Printf("chapter %d %s: %d positions", number, chapter.Name, len(chapter.Items))
		out.Chapters = append(out.Chapters, chapter)
	}
	payload, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := book.ParseAndValidate(payload); err != nil {
		log.Fatalf("book failed validation: %v", err)
	}
	log.Printf("%d exercises link to a solution page; %d have a usable author line; %d turned into puzzles", solutionPages, lineCount, puzzleCount)
	log.Printf("%d diagrams had no recognized placement and were skipped", missing)
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

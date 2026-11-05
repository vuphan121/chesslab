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

var chapters = map[int]string{
	1: "Introduction", 2: "Weaknesses", 3: "Pieces", 4: "Prophylaxis", 5: "Exercises", 6: "Solutions",
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

func nearestGame(placement string, games map[string]commentaryGame, used map[string]bool) (commentaryGame, bool) {
	want := expandPlacement(placement)
	best, bestDiff, ties := "", 99, 0
	for key := range games {
		if used[key] {
			continue
		}
		have, diff := expandPlacement(key), 0
		if len(have) != len(want) {
			continue
		}
		for i := range want {
			if want[i] != have[i] {
				diff++
			}
		}
		if diff < bestDiff {
			best, bestDiff, ties = key, diff, 1
		} else if diff == bestDiff {
			ties++
		}
	}
	if best == "" || bestDiff > 3 || ties != 1 {
		return commentaryGame{}, false
	}
	return games[best], true
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

	lines := map[int]commentaryGame{}
	if raw, err := os.ReadFile(*commentary); err == nil {
		var games []commentaryGame
		if err := json.Unmarshal(raw, &games); err != nil {
			log.Fatalf("decode commentary: %v", err)
		}
		for _, g := range games {
			if g.StartFEN != "" && len(g.Line) > 0 && g.Stats.Moves > 0 && float64(g.Stats.Failed) <= *maxFailed*float64(g.Stats.Moves) {
				lines[g.DiagramNumber] = g
			}
		}
	}
	byPlacement := map[string]commentaryGame{}
	for _, g := range lines {
		byPlacement[strings.Fields(g.StartFEN)[0]] = g
	}
	usedGames := map[string]bool{}
	attached, puzzleCount := 0, 0
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
			if g, ok := lines[p.DiagramNumber]; ok && number == 6 {
				item.FEN, item.SideToMove, item.Line = g.StartFEN, strings.Fields(g.StartFEN)[1], g.Line
				item.Prompt = fmt.Sprintf("Exercise %d: the author's solution and commentary.", g.Exercise)
				attached++
			}
			g, ok := byPlacement[p.PiecePlacement]
			if !ok && number == 5 && *puzzles {
				g, ok = nearestGame(p.PiecePlacement, byPlacement, usedGames)
			}
			if ok && number == 5 && *puzzles && (p.SideToMove == "" || p.SideToMove == strings.Fields(g.StartFEN)[1]) {
				usedGames[strings.Fields(g.StartFEN)[0]] = true
				item.Type, item.FEN, item.SideToMove, item.Line = "puzzle", g.StartFEN, strings.Fields(g.StartFEN)[1], g.Line
				item.Prompt = fmt.Sprintf("Exercise %d: find the best move.", g.Exercise)
				puzzleCount++
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
	log.Printf("%d exercises turned into puzzles", puzzleCount)
	log.Printf("%d exercise solutions with author lines attached", attached)
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

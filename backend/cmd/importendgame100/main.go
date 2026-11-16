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

type structure struct {
	Chapters []struct {
		Number int    `json:"number"`
		Name   string `json:"name"`
	} `json:"chapters"`
}

type parsedPosition struct {
	Pattern        int    `json:"pattern"`
	Title          string `json:"title"`
	PiecePlacement string `json:"piecePlacement"`
	SideToMove     string `json:"sideToMove"`
	SourcePage     int    `json:"chapterPDFPage"`
	MasterPDFPage  int    `json:"masterPDFPage"`
}

type override struct {
	Diagram        string `json:"diagram"`
	Accepted       bool   `json:"accepted"`
	PiecePlacement string `json:"piecePlacement"`
	SideToMove     string `json:"sideToMove"`
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

func main() {
	root := flag.String("root", "../tmp/endgame100", "parser output root (structure.json, chapter-1..15)")
	overridesPath := flag.String("overrides", "../tools/book-board-parser/work/review-endgame100/overrides.json", "review_server.py overrides (optional; diagram ids look like 3-21 = chapter-pattern)")
	outPath := flag.String("out", "", "also write the book JSON to this file (never touches Neon)")
	apply := flag.Bool("apply", false, "write the book to Neon (otherwise dry run)")
	flag.Parse()
	loadDotEnv(".env")

	var layout structure
	raw, err := os.ReadFile(filepath.Join(*root, "structure.json"))
	if err != nil {
		log.Fatalf("read structure: %v", err)
	}
	if err := json.Unmarshal(raw, &layout); err != nil {
		log.Fatalf("decode structure: %v", err)
	}
	overrides := map[string]override{}
	if raw, err := os.ReadFile(*overridesPath); err == nil {
		var saved struct {
			Items []override `json:"items"`
		}
		if err := json.Unmarshal(raw, &saved); err != nil {
			log.Fatalf("decode overrides: %v", err)
		}
		for _, o := range saved.Items {
			if o.Accepted && o.PiecePlacement != "" {
				overrides[o.Diagram] = o
			}
		}
	}

	out := book.Book{ID: "100-endgame-patterns", Title: "100 Endgame Patterns You Must Know", Author: "Jesus de la Villa"}
	missing, unknownSide, corrected := 0, 0, 0
	var drillItems []book.Item
	for _, ch := range layout.Chapters {
		raw, err := os.ReadFile(filepath.Join(*root, fmt.Sprintf("chapter-%d", ch.Number), "positions.json"))
		if err != nil {
			log.Fatalf("read chapter %d: %v", ch.Number, err)
		}
		var source struct {
			Positions []parsedPosition `json:"positions"`
		}
		if err := json.Unmarshal(raw, &source); err != nil {
			log.Fatalf("decode chapter %d: %v", ch.Number, err)
		}
		chapter := book.Chapter{ID: fmt.Sprintf("ep-ch%d", ch.Number), Number: ch.Number, Name: ch.Name}
		for _, p := range source.Positions {
			if o, ok := overrides[fmt.Sprintf("%d-%d", ch.Number, p.Pattern)]; ok {
				p.PiecePlacement = o.PiecePlacement
				if o.SideToMove == "w" || o.SideToMove == "b" {
					p.SideToMove = o.SideToMove
				}
				corrected++
			}
			if p.PiecePlacement == "" {
				missing++
				continue
			}
			side := p.SideToMove
			if side != "w" && side != "b" {
				side = "w"
				unknownSide++
			}
			chapter.Items = append(chapter.Items, book.Item{
				ID: fmt.Sprintf("ep-ch%d-pattern-%d", ch.Number, p.Pattern), ChapterID: chapter.ID, Type: "lesson",
				FEN: p.PiecePlacement + " " + side + " - - 0 1", SideToMove: side,
				Prompt: fmt.Sprintf("Pattern %d: %s", p.Pattern, p.Title), SourcePage: p.SourcePage, MasterPDFPage: p.MasterPDFPage,
			})
		}
		for _, lesson := range chapter.Items {
			drillItems = append(drillItems, book.Item{
				ID: strings.Replace(lesson.ID, "-pattern-", "-drill-", 1), ChapterID: "ep-drill", Type: "drill",
				FEN: lesson.FEN, SideToMove: lesson.SideToMove, Prompt: "Drill p" + lesson.Prompt[1:],
				SourcePage: lesson.SourcePage, MasterPDFPage: lesson.MasterPDFPage, SourceChapterID: chapter.ID,
			})
		}
		if len(chapter.Items) > 0 {
			chapter.Items[0].SourcePage = 1
		}
		log.Printf("chapter %d %s: %d patterns", ch.Number, chapter.Name, len(chapter.Items))
		out.Chapters = append(out.Chapters, chapter)
	}
	out.Chapters = append(out.Chapters, book.Chapter{ID: "ep-drill", Number: len(out.Chapters) + 1, Name: "Drill: play each pattern", Items: drillItems})
	payload, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := book.ParseAndValidate(payload); err != nil {
		log.Fatalf("book failed validation: %v", err)
	}
	log.Printf("%d patterns use a hand-labelled override; %d had no recognized placement and were skipped; %d had no side-to-move phrase and default to White", corrected, missing, unknownSide)
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

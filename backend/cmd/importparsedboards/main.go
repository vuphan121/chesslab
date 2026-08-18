// importparsedboards merges validated board-parser output into an existing
// Neon book. It is an offline admin command: it never runs in the API server
// and changes the database only when --apply is supplied.
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
	"sort"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/db"
)

var chapterNames = map[int]string{
	3: "Basic opening principles", 4: "Simple pawn endings", 5: "Double check", 6: "The value of the pieces",
	7: "The discovered attack", 8: "Centralizing the pieces", 9: "Mate in two moves", 10: "The opposition",
	11: "The pin", 12: "The double attack", 13: "Realizing a material advantage", 14: "Open files and Outposts",
	15: "Combinations", 16: "Queen against pawn", 17: "Stalemate motifs", 18: "Forced variations",
	19: "Combinations involving promotion", 20: "Weak points", 21: "Pawn combinations", 22: "The wrong bishop",
	23: "Smothered mate", 24: "Gambits",
}

type parsedPosition struct {
	Diagram          string `json:"diagram"`
	DiagramNumber    int    `json:"diagramNumber"`
	PiecePlacement   string `json:"piecePlacement"`
	RecognitionState string `json:"recognitionStatus"`
	SideToMove       string `json:"sideToMove"`
	SourcePage       int    `json:"chapterPDFPage"`
	BookPage         int    `json:"bookPage"`
	MasterPDFPage    int    `json:"masterPDFPage"`
}

type parsedChapter struct {
	Chapter   int              `json:"chapter"`
	Positions []parsedPosition `json:"positions"`
}

type reviewOverride struct {
	Chapter        int    `json:"chapter"`
	Diagram        string `json:"diagram"`
	Accepted       bool   `json:"accepted"`
	PiecePlacement string `json:"piecePlacement"`
	SideToMove     string `json:"sideToMove"`
}

type reviewOverrides struct {
	Items []reviewOverride `json:"items"`
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

func loadOverrides(path string) (map[string]reviewOverride, error) {
	if path == "" {
		return map[string]reviewOverride{}, nil
	}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]reviewOverride{}, nil
	}
	if err != nil {
		return nil, err
	}
	var payload reviewOverrides
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode review overrides: %w", err)
	}
	out := make(map[string]reviewOverride, len(payload.Items))
	for _, item := range payload.Items {
		out[item.Diagram] = item
	}
	return out, nil
}

func currentBook(ctx context.Context, store *db.Store, id string) (book.Book, error) {
	rawBooks, err := store.LoadBooks(ctx)
	if err != nil {
		return book.Book{}, err
	}
	for _, raw := range rawBooks {
		parsed, err := book.ParseAndValidate(raw)
		if err != nil {
			return book.Book{}, fmt.Errorf("validate stored book: %w", err)
		}
		if parsed.ID == id {
			return *parsed, nil
		}
	}
	return book.Book{}, fmt.Errorf("book %q was not found in Neon", id)
}

func main() {
	root := flag.String("root", "../tools/book-board-parser/work/build-up-your-chess-1", "parser output root")
	overridesPath := flag.String("review-overrides", "../tools/book-board-parser/work/review/overrides.json", "review overrides JSON")
	bookID := flag.String("book-id", "build-up-your-chess-1", "existing Neon book id")
	apply := flag.Bool("apply", false, "write the merged book to Neon (otherwise dry run)")
	flag.Parse()
	loadDotEnv(".env")
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	overrides, err := loadOverrides(*overridesPath)
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := db.Connect(ctx, url)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer store.Close()
	merged, err := currentBook(ctx, store, *bookID)
	if err != nil {
		log.Fatal(err)
	}

	kept := make([]book.Chapter, 0, len(merged.Chapters)+len(chapterNames))
	for _, chapter := range merged.Chapters {
		if _, replaced := chapterNames[chapter.Number]; !replaced {
			kept = append(kept, chapter)
		}
	}
	imported, skipped := 0, 0
	for chapterNumber := 3; chapterNumber <= 24; chapterNumber++ {
		path := filepath.Join(*root, fmt.Sprintf("chapter-%d", chapterNumber), "positions.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			log.Fatalf("read chapter %d: %v", chapterNumber, err)
		}
		var source parsedChapter
		if err := json.Unmarshal(raw, &source); err != nil {
			log.Fatalf("decode chapter %d: %v", chapterNumber, err)
		}
		if source.Chapter != chapterNumber {
			log.Fatalf("%s identifies chapter %d", path, source.Chapter)
		}
		chapter := book.Chapter{ID: fmt.Sprintf("buyc1-ch%d", chapterNumber), Number: chapterNumber, Name: chapterNames[chapterNumber]}
		for _, position := range source.Positions {
			placement, side := position.PiecePlacement, position.SideToMove
			if override, ok := overrides[position.Diagram]; ok && override.Accepted {
				if override.Chapter != chapterNumber {
					log.Fatalf("override %q belongs to chapter %d, not %d", override.Diagram, override.Chapter, chapterNumber)
				}
				if override.PiecePlacement != "" {
					placement = override.PiecePlacement
				}
				if override.SideToMove != "" {
					side = override.SideToMove
				}
			}
			if position.RecognitionState != "ok" && placement == "" {
				skipped++
				continue
			}
			if placement == "" || (side != "w" && side != "b") {
				skipped++
				continue
			}
			chapter.Items = append(chapter.Items, book.Item{
				ID:        fmt.Sprintf("buyc1-ch%d-diagram-%d", chapterNumber, position.DiagramNumber),
				ChapterID: chapter.ID, Type: "lesson", FEN: placement + " " + side + " - - 0 1", SideToMove: side,
				Prompt: "Explore the position on the board.", SourcePage: position.SourcePage, BookPage: position.BookPage, MasterPDFPage: position.MasterPDFPage,
			})
			imported++
		}
		kept = append(kept, chapter)
	}
	sort.Slice(kept, func(i, j int) bool { return kept[i].Number < kept[j].Number })
	merged.Chapters = kept
	payload, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := book.ParseAndValidate(payload); err != nil {
		log.Fatalf("merged book failed validation: %v", err)
	}
	log.Printf("prepared %d imported positions; %d diagrams await review; resulting book has %d chapters", imported, skipped, len(merged.Chapters))
	if !*apply {
		log.Printf("dry run only; re-run with --apply to upsert Neon")
		return
	}
	if err := store.SaveBook(ctx, merged.ID, payload); err != nil {
		log.Fatalf("save book: %v", err)
	}
	log.Printf("saved %q to Neon", merged.ID)
}

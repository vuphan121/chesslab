package book

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/chesslab/backend/internal/chess"
)

func LoadDir(dir string) []*Book {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("book: data dir %q unavailable (%v) — no books loaded", dir, err)
		return nil
	}

	var books []*Book
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		b, err := loadOne(path)
		if err != nil {
			log.Printf("book: skipping %s: %v", e.Name(), err)
			continue
		}
		books = append(books, b)
		itemCount := 0
		for _, ch := range b.Chapters {
			itemCount += len(ch.Items)
		}
		log.Printf("book: loaded %q (%s, %d chapters, %d items)", b.ID, b.Title, len(b.Chapters), itemCount)
	}
	return books
}

func loadOne(path string) (*Book, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseAndValidate(data)
}

func ParseAndValidate(data []byte) (*Book, error) {
	var b Book
	if err := json.Unmarshal(data, &b); err != nil {
		return nil, err
	}
	if b.ID == "" {
		return nil, fmt.Errorf("missing id")
	}
	if err := validateBook(&b); err != nil {
		return nil, err
	}
	return &b, nil
}

func validateBook(b *Book) error {
	for ci := range b.Chapters {
		ch := &b.Chapters[ci]
		for ii := range ch.Items {
			item := &ch.Items[ii]
			label := fmt.Sprintf("chapter %q item %q", ch.Name, item.ID)

			pos, err := chess.ParseFEN(item.FEN)
			if err != nil {
				return fmt.Errorf("%s: bad FEN: %w", label, err)
			}
			if got := pos.Turn.String(); got != item.SideToMove {
				return fmt.Errorf("%s: sideToMove %q does not match FEN's side to move %q", label, item.SideToMove, got)
			}

			item.SolutionUCI = nil
			for i, san := range item.Solution {
				m, ok := chess.FindLegalMoveBySAN(pos, san)
				if !ok {
					return fmt.Errorf("%s: solution ply %d %q is not a legal move from %s", label, i+1, san, chess.FEN(pos))
				}
				item.SolutionUCI = append(item.SolutionUCI, m.String())
				pos = chess.ApplyMove(pos, m)
			}
		}
	}
	return nil
}

func ChapterObjectKey(prefix string, b *Book, chapterID string) (string, bool) {
	if b == nil || b.ID == "" {
		return "", false
	}
	for _, chapter := range b.Chapters {
		if chapter.ID == chapterID && chapter.Number > 0 {
			prefix = strings.Trim(prefix, "/")
			if prefix == "" {
				prefix = "books"
			}
			return fmt.Sprintf("%s/%s/chapter-%d.pdf", prefix, b.ID, chapter.Number), true
		}
	}
	return "", false
}

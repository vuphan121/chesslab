// Package coach builds grounded per-move explanations for the AI Coach panel:
// curated opening-theory chunks (keyed by resolvedFen) plus engine/explorer
// data get folded into a prompt, and a local LLM (see llm.go) writes the prose.
package coach

import (
	"encoding/json"
	"fmt"
	"os"
)

// Chunk is one hand-authored, engine-validated piece of opening commentary,
// as produced by backend/data/opening-sources/*/validate_chunks.py.
type Chunk struct {
	MoveSequence   string `json:"moveSequence"`
	CommentaryText string `json:"commentaryText"`
	Source         struct {
		Title    string `json:"title"`
		Author   string `json:"author"`
		Location string `json:"location"`
	} `json:"source"`
	ResolvedFEN string  `json:"resolvedFen"`
	ECO         *string `json:"eco"`
	OpeningName *string `json:"openingName"`
}

// Index looks up opening-theory chunks by resolved FEN. Built once at startup
// and read-only after that, so it needs no locking.
type Index struct {
	byFEN map[string][]Chunk
}

// LoadIndex reads a chunks.validated.json file and groups its chunks by
// resolvedFen. Multiple chunks (even from different source books) can share
// the same FEN; they're kept as a list in encounter order.
func LoadIndex(path string) (*Index, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading chunks file: %w", err)
	}

	var chunks []Chunk
	if err := json.Unmarshal(data, &chunks); err != nil {
		return nil, fmt.Errorf("parsing chunks file: %w", err)
	}

	byFEN := make(map[string][]Chunk)
	for _, c := range chunks {
		if c.ResolvedFEN == "" {
			continue
		}
		byFEN[c.ResolvedFEN] = append(byFEN[c.ResolvedFEN], c)
	}

	return &Index{byFEN: byFEN}, nil
}

// Lookup returns the theory chunks attached to an exact FEN, or nil if the
// corpus doesn't cover this position. Most positions will return nil — the
// corpus covers specific book lines, not every possible position.
func (idx *Index) Lookup(fen string) []Chunk {
	return idx.byFEN[fen]
}

// Len reports how many distinct positions the index covers.
func (idx *Index) Len() int {
	return len(idx.byFEN)
}

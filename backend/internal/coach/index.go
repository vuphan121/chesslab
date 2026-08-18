package coach

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"github.com/chesslab/backend/internal/chess"
)

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

type TheoryMatch struct {
	Chunk      Chunk `json:"chunk"`
	PliesAhead int   `json:"pliesAhead"`
}

type LookupResult struct {
	Exact  []Chunk
	Prefix []TheoryMatch
}

const maxPrefixLookaheadPlies = 8

const maxPrefixMatches = 3

type Index struct {
	byFEN       map[string][]Chunk
	prefixByFEN map[string][]TheoryMatch
}

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
	prefixByFEN := make(map[string][]TheoryMatch)
	for _, c := range chunks {
		if c.ResolvedFEN == "" {
			continue
		}
		byFEN[c.ResolvedFEN] = append(byFEN[c.ResolvedFEN], c)

		tokens := chess.TokenizePGNMoves(c.MoveSequence)
		fens := chess.ReplayLine(tokens)
		if len(fens) == 0 || fens[len(fens)-1] != c.ResolvedFEN {

			continue
		}
		total := len(fens)
		for i := 0; i < total-1; i++ {
			pliesAhead := total - 1 - i
			if pliesAhead > maxPrefixLookaheadPlies {
				continue
			}
			fen := fens[i]
			prefixByFEN[fen] = append(prefixByFEN[fen], TheoryMatch{Chunk: c, PliesAhead: pliesAhead})
		}
	}

	return &Index{byFEN: byFEN, prefixByFEN: prefixByFEN}, nil
}

func (idx *Index) Lookup(fen string) LookupResult {
	if exact := idx.byFEN[fen]; len(exact) > 0 {
		return LookupResult{Exact: exact}
	}
	return LookupResult{Prefix: dedupePrefix(idx.prefixByFEN[fen])}
}

func dedupePrefix(matches []TheoryMatch) []TheoryMatch {
	if len(matches) == 0 {
		return nil
	}
	sorted := make([]TheoryMatch, len(matches))
	copy(sorted, matches)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].PliesAhead < sorted[j].PliesAhead })

	seen := make(map[string]bool)
	out := make([]TheoryMatch, 0, maxPrefixMatches)
	for _, m := range sorted {
		key := m.Chunk.Source.Author + "|" + m.Chunk.Source.Title
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, m)
		if len(out) >= maxPrefixMatches {
			break
		}
	}
	return out
}

func (idx *Index) Len() int {
	return len(idx.byFEN)
}

func (idx *Index) PrefixLen() int {
	return len(idx.prefixByFEN)
}

// Package coach builds grounded per-move explanations for the AI Coach panel:
// curated opening-theory chunks (keyed by resolvedFen) plus engine/explorer
// data get folded into a prompt, and a local LLM (see llm.go) writes the prose.
package coach

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"github.com/chesslab/backend/internal/chess"
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

// TheoryMatch is a "prefix" hit: the queried position isn't itself covered by
// the corpus, but it's PliesAhead half-moves before a position that continues
// into the same book line and IS covered — see Index.Lookup.
type TheoryMatch struct {
	Chunk      Chunk `json:"chunk"`
	PliesAhead int   `json:"pliesAhead"`
}

// LookupResult separates an exact hit (the corpus covers this precise
// position) from prefix hits (this position continues, a few moves later,
// into one or more positions the corpus covers — possibly via different
// books/lines, i.e. different ways this position can transpose). Prefix is
// only ever populated when Exact is empty — an exact hit is always the
// better answer when one exists.
type LookupResult struct {
	Exact  []Chunk
	Prefix []TheoryMatch
}

// maxPrefixLookaheadPlies bounds how far ahead a "this transposes toward
// known theory" hint is allowed to reach. A chunk 20 plies ahead isn't a
// useful signal for the move just played — only near-term continuations are.
const maxPrefixLookaheadPlies = 8

// maxPrefixMatches caps how many distinct transposition hints a single
// lookup surfaces, so the prompt doesn't get flooded when a position sits
// early in several long, mostly-overlapping annotated lines.
const maxPrefixMatches = 3

// Index looks up opening-theory chunks by resolved FEN. Built once at startup
// and read-only after that, so it needs no locking.
type Index struct {
	byFEN       map[string][]Chunk
	prefixByFEN map[string][]TheoryMatch
}

// LoadIndex reads a chunks.validated.json file and indexes it two ways:
// exact position -> chunk (byFEN, as before), and, for every chunk, every
// earlier position along its own move sequence -> that chunk plus how many
// plies ahead it is (prefixByFEN). The second index is what lets the coach
// say "this continues toward known theory a few moves from now" even when
// the exact position the user is looking at isn't itself annotated — most
// hand-authored chunks are anchored to the END of a line, not every position
// along the way.
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
			// Line didn't replay cleanly (shouldn't happen post-validation) or
			// is a single move with no "before" position worth indexing —
			// exact-match coverage above still applies, just skip prefixing.
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

// Lookup returns the theory covering a position: an exact hit if the corpus
// has commentary for this precise FEN, otherwise up to maxPrefixMatches
// nearby "this transposes toward known theory" hints (nearest first, deduped
// to one per source book so a single long annotated game doesn't crowd out
// every other hint). Both are empty for most positions — the corpus covers
// specific book lines, not every possible position.
func (idx *Index) Lookup(fen string) LookupResult {
	if exact := idx.byFEN[fen]; len(exact) > 0 {
		return LookupResult{Exact: exact}
	}
	return LookupResult{Prefix: dedupePrefix(idx.prefixByFEN[fen])}
}

// dedupePrefix sorts prefix hits nearest-first and keeps at most one per
// source book (Author+Title) — a single annotated game is chunked move by
// move, so an early position in that game can otherwise match a dozen
// near-duplicate hits that are really "the same game, a bit further on".
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

// Len reports how many distinct positions the index has exact coverage for.
func (idx *Index) Len() int {
	return len(idx.byFEN)
}

// PrefixLen reports how many distinct positions have a "transposes toward
// known theory" prefix hint (see Lookup) but no exact coverage of their own.
func (idx *Index) PrefixLen() int {
	return len(idx.prefixByFEN)
}

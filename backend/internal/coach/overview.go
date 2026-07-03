package coach

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// OverviewChunk is opening-level context prose — introductions, philosophy,
// typical plans, move-order notes — that is NOT tied to one specific position.
// Unlike a move Chunk (keyed by resolvedFen), these answer general "tell me
// about this opening" questions, so they carry no FEN and are retrieved by
// natural-language keyword match instead of exact lookup.
type OverviewChunk struct {
	Opening string `json:"opening"` // e.g. "Accelerated Dragon"
	Topic   string `json:"topic"`   // e.g. "philosophy", "introduction", "typical-plans", "move-order"
	Title   string `json:"title"`
	Text    string `json:"text"`
	Source  struct {
		Title    string `json:"title"`
		Author   string `json:"author"`
		Location string `json:"location"`
	} `json:"source"`
}

// OverviewIndex holds the opening-context corpus in memory and answers keyword
// queries against it. Built once at startup, read-only after — no locking.
type OverviewIndex struct {
	chunks []OverviewChunk
}

// LoadOverviewIndex reads an overview.json file (a flat list of
// OverviewChunk). Missing/empty file is not fatal — returns an empty index so
// the coach still runs, just without opening-context retrieval.
func LoadOverviewIndex(path string) (*OverviewIndex, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading overview file: %w", err)
	}
	var chunks []OverviewChunk
	if err := json.Unmarshal(data, &chunks); err != nil {
		return nil, fmt.Errorf("parsing overview file: %w", err)
	}
	return &OverviewIndex{chunks: chunks}, nil
}

// Len reports how many overview chunks are loaded.
func (idx *OverviewIndex) Len() int {
	if idx == nil {
		return 0
	}
	return len(idx.chunks)
}

// field weights: a query term matching the opening name/topic/title is a
// stronger signal than one buried in the body text.
const (
	weightOpening = 3
	weightTopic   = 3
	weightTitle   = 2
	weightText    = 1
)

// Search returns up to limit overview chunks best matching the free-text
// query, scored by weighted token overlap. Returns nil when nothing matches
// (a normal result — the coach then just answers without book context).
func (idx *OverviewIndex) Search(query string, limit int) []OverviewChunk {
	if idx == nil || len(idx.chunks) == 0 {
		return nil
	}
	qTokens := uniqueTokens(query)
	if len(qTokens) == 0 {
		return nil
	}

	type scored struct {
		chunk OverviewChunk
		score int
	}
	var results []scored

	for _, c := range idx.chunks {
		openingSet := tokenSet(c.Opening)
		topicSet := tokenSet(c.Topic)
		titleSet := tokenSet(c.Title)
		textSet := tokenSet(c.Text)

		score := 0
		for tok := range qTokens {
			// Take the strongest field a term appears in, so a term isn't
			// double-counted across fields.
			switch {
			case openingSet[tok]:
				score += weightOpening
			case topicSet[tok]:
				score += weightTopic
			case titleSet[tok]:
				score += weightTitle
			case textSet[tok]:
				score += weightText
			}
		}
		if score > 0 {
			results = append(results, scored{chunk: c, score: score})
		}
	}

	if len(results) == 0 {
		return nil
	}

	sort.SliceStable(results, func(i, j int) bool {
		return results[i].score > results[j].score
	})

	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}
	out := make([]OverviewChunk, len(results))
	for i, r := range results {
		out[i] = r.chunk
	}
	return out
}

// stopwords are common words that carry no retrieval signal — dropped so a
// query like "what is the idea of this opening" matches on "idea"/"opening",
// not on "what"/"is"/"the".
var stopwords = map[string]bool{
	"a": true, "an": true, "the": true, "is": true, "are": true, "was": true,
	"of": true, "to": true, "in": true, "on": true, "for": true, "and": true,
	"or": true, "what": true, "why": true, "how": true, "this": true, "that": true,
	"it": true, "with": true, "about": true, "does": true, "do": true, "can": true,
	"i": true, "you": true, "my": true, "me": true, "tell": true, "give": true,
}

// tokenize lowercases and splits on any non-alphanumeric run, dropping
// stopwords and 1-char tokens.
func tokenize(s string) []string {
	var out []string
	var b strings.Builder
	flush := func() {
		if b.Len() == 0 {
			return
		}
		w := b.String()
		b.Reset()
		if len(w) <= 1 || stopwords[w] {
			return
		}
		out = append(out, w)
	}
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			flush()
		}
	}
	flush()
	return out
}

func uniqueTokens(s string) map[string]bool {
	set := map[string]bool{}
	for _, t := range tokenize(s) {
		set[t] = true
	}
	return set
}

func tokenSet(s string) map[string]bool {
	return uniqueTokens(s)
}

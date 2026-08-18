package coach

import "testing"

func newTestOverview() *OverviewIndex {
	idx := &OverviewIndex{}
	mk := func(topic, title, text string) OverviewChunk {
		c := OverviewChunk{Opening: "Accelerated Dragon", Topic: topic, Title: title, Text: text}
		return c
	}
	idx.chunks = []OverviewChunk{
		mk("engine-vs-human", "Why engines underrate it",
			"Computers value material and static factors, inflating White's edge; the initiative and easy plans favor Black."),
		mk("philosophy", "It feels like playing White",
			"Black controls the tempo and determines the character of the struggle, keeping the initiative."),
		mk("maroczy", "The Maroczy Bind concern",
			"White's c4/e4 clamp gains space, but Black has real counterplay in the Gurgenidze System."),
	}
	return idx
}

func TestOverviewSearchRanksByRelevance(t *testing.T) {
	idx := newTestOverview()

	got := idx.Search("why does the accelerated dragon feel like playing white with the initiative", 3)
	if len(got) == 0 {
		t.Fatal("expected matches, got none")
	}
	if got[0].Topic != "philosophy" {
		t.Errorf("top hit topic = %q, want philosophy (title/text overlap on 'white'/'initiative')", got[0].Topic)
	}
}

func TestOverviewSearchEngineQuery(t *testing.T) {
	idx := newTestOverview()

	got := idx.Search("does the computer engine evaluation dislike this opening material", 3)
	if len(got) == 0 || got[0].Topic != "engine-vs-human" {
		t.Fatalf("expected engine-vs-human on top, got %+v", topicsOf(got))
	}
}

func TestOverviewSearchNoMatch(t *testing.T) {
	idx := newTestOverview()

	if got := idx.Search("french defense advance variation", 3); got != nil {
		t.Errorf("expected nil for an unrelated query, got %+v", topicsOf(got))
	}
}

func TestOverviewSearchLimit(t *testing.T) {
	idx := newTestOverview()

	got := idx.Search("accelerated dragon", 2)
	if len(got) != 2 {
		t.Errorf("limit not applied: got %d results, want 2", len(got))
	}
}

func TestOverviewNilSafe(t *testing.T) {
	var idx *OverviewIndex
	if idx.Len() != 0 {
		t.Error("nil index Len should be 0")
	}
	if got := idx.Search("anything", 3); got != nil {
		t.Error("nil index Search should return nil")
	}
}

func topicsOf(chunks []OverviewChunk) []string {
	out := make([]string, len(chunks))
	for i, c := range chunks {
		out[i] = c.Topic
	}
	return out
}

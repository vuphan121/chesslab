package api

import (
	"testing"

	"github.com/chesslab/backend/internal/db"
)

func TestStageOf(t *testing.T) {
	cases := []struct {
		h    db.CardHistory
		want lineStage
	}{
		{db.CardHistory{}, stageNotStarted},
		{db.CardHistory{Bits: 31, N: 5}, stageLearned},
		{db.CardHistory{Bits: 15, N: 4}, stageGettingThere},
		{db.CardHistory{Bits: 30, N: 5}, stageGettingThere},
		{db.CardHistory{Bits: 0, N: 3}, stageNeedsWork},
	}
	for _, c := range cases {
		if got := stageOf(c.h); got != c.want {
			t.Fatalf("stageOf(%+v) = %v, want %v", c.h, got, c.want)
		}
	}
}

func TestEstimateLineHistory(t *testing.T) {
	cards := map[string]db.CardBox{"a": {Box: 5, Seen: 8}, "b": {Box: 5, Seen: 9}, "c": {Box: 0, Seen: 2}}
	if bits, n, ok := estimateLineHistory([]string{"a", "b"}, cards); !ok || bits != 31 || n != 5 {
		t.Fatalf("top box everywhere: bits=%d n=%d ok=%v", bits, n, ok)
	}
	if bits, n, ok := estimateLineHistory([]string{"a", "x"}, cards); !ok || bits != 0 || n != 5 {
		t.Fatalf("an unseen card: bits=%d n=%d ok=%v", bits, n, ok)
	}
	if bits, n, ok := estimateLineHistory([]string{"c"}, cards); !ok || bits != 0 || n != 2 {
		t.Fatalf("only a missed card: bits=%d n=%d ok=%v", bits, n, ok)
	}
	if _, _, ok := estimateLineHistory([]string{"x"}, cards); ok {
		t.Fatal("nothing seen should not seed")
	}
}

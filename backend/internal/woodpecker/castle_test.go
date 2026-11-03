package woodpecker

import "testing"

func TestAssumeCastling(t *testing.T) {
	cases := map[string]string{
		"r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1":                         "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
		"4k2r/8/8/8/8/8/8/R3K3 b - - 0 1":                           "4k2r/8/8/8/8/8/8/R3K3 b Qk - 0 1",
		"r6r/1pp3k1/1b6/p2P1p2/P1N1pn2/2P2PP1/BP5P/4RR1K b - - 0 1": "r6r/1pp3k1/1b6/p2P1p2/P1N1pn2/2P2PP1/BP5P/4RR1K b - - 0 1",
	}
	for in, want := range cases {
		if got := assumeCastling(in); got != want {
			t.Errorf("%s: got %s want %s", in, got, want)
		}
	}
}

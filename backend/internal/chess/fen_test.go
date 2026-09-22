package chess

import "testing"

// A rank string that overflows 8 files (e.g. 8 empty squares followed by a
// piece, or two digit runs summing past 8) used to reach NewSquare with
// file==8, which returns NoSquare(-1) and panicked on pos.Board[-1] instead
// of being rejected as invalid input. ParseFEN is reachable straight from
// query params (?fen=) and request bodies, so a malformed FEN must return an
// error, never panic.
func TestParseFENRejectsOverflowingRank(t *testing.T) {
	cases := []string{
		"8p/8/8/8/8/8/8/8 w - - 0 1",  // digits then a piece past the 8th file
		"45/8/8/8/8/8/8/8 w - - 0 1",  // two digit runs summing to 9
		"pppppppppp/8/8/8/8/8/8/8 w - - 0 1", // too many piece chars
		"pppppp/8/8/8/8/8/8/8 w - - 0 1",     // rank too short
	}
	for _, fen := range cases {
		if _, err := ParseFEN(fen); err == nil {
			t.Errorf("ParseFEN(%q) returned no error, want a rejection", fen)
		}
	}
}

func TestParseFENAcceptsWellFormedRanks(t *testing.T) {
	if _, err := ParseFEN(StartFEN); err != nil {
		t.Fatalf("ParseFEN(StartFEN): %v", err)
	}
}

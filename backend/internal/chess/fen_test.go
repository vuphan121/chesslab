package chess

import "testing"

func TestParseFENRejectsOverflowingRank(t *testing.T) {
	cases := []string{
		"8p/8/8/8/8/8/8/8 w - - 0 1",
		"45/8/8/8/8/8/8/8 w - - 0 1",
		"pppppppppp/8/8/8/8/8/8/8 w - - 0 1",
		"pppppp/8/8/8/8/8/8/8 w - - 0 1",
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

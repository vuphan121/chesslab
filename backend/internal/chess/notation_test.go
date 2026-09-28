package chess

import "testing"

func TestSANDisambiguationThreeCompetitors(t *testing.T) {
	fen := "7k/2N5/8/1N6/8/2N5/8/7K w - - 0 1"
	pos, err := ParseFEN(fen)
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	move := Move{From: ParseSquare("c3"), To: ParseSquare("d5"), Flag: Normal}
	if got, want := SAN(pos, move), "N3d5"; got != want {
		t.Fatalf("SAN(c3-d5) = %q, want %q", got, want)
	}
}

func TestMovesToSANAndFENs_Chess960CastleEncoding(t *testing.T) {
	fen := "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"
	pos, err := ParseFEN(fen)
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}

	sans, fens := MovesToSANAndFENs(pos, []string{"e1h1"})
	if len(sans) != 1 || sans[0] != "O-O" {
		t.Fatalf("MovesToSANAndFENs(e1h1) sans = %v, want [\"O-O\"]", sans)
	}
	if len(fens) != 1 {
		t.Fatalf("MovesToSANAndFENs(e1h1) fens = %v, want 1 entry", fens)
	}

	fen2 := "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1"
	pos2, err := ParseFEN(fen2)
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	sans2, _ := MovesToSANAndFENs(pos2, []string{"e8a8"})
	if len(sans2) != 1 || sans2[0] != "O-O-O" {
		t.Fatalf("MovesToSANAndFENs(e8a8) sans = %v, want [\"O-O-O\"]", sans2)
	}
}

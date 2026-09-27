package chess

import "testing"

// Three white knights: c3 (the mover), c7 (shares c3's file), b4 (shares
// neither c3's file nor its rank) can all reach d5. Real SAN needs only the
// rank ("N3d5") since no competitor shares c3's rank — file alone wouldn't
// disambiguate against c7, but rank alone disambiguates against both. An
// earlier version of this logic decided needFile/needRank independently per
// competitor instead of across all of them, which over-qualified this exact
// shape (some competitor shares file, a different competitor doesn't) into
// the full square "Nc3d5".
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

// Lichess cloud-eval (and some Chess960-aware UCI engines) encode castling
// as the king "moving onto" its own rook's home square — e1h1 for O-O,
// e1a1 for O-O-O — rather than the standard e1g1/e1c1 our move generator
// produces. Real bug, caught live: a cloud-eval line whose first move was
// this encoding matched no legal move (GenerateLegalMoves never emits a
// king move more than one square), so MovesToSANAndFENs silently returned
// an empty SAN for the whole line — see normalizeChess960Castle.
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

	// A black king on its home rank, far enough right that a real
	// (non-castling) one-square move can never reach the h-file, still
	// resolves normally — normalizeChess960Castle only ever remaps a
	// same-rank king "move" that's otherwise illegal.
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

package chess

import "testing"

// Castling rights on a FEN don't guarantee a rook actually sits on the
// corner square (a hand-edited/malformed FEN can set "K" with no rook on
// h1). castleKSClear/castleQSClear used to only check the squares between
// king and corner were empty and unattacked, never that the corner square
// itself held a rook of the right color — so this position let White
// "castle" with a bishop on h1, teleporting it to f1.
func TestCastlingRequiresRookOnCorner(t *testing.T) {
	fen := "4k3/8/8/8/8/8/8/4K2b w K - 0 1"
	pos, err := ParseFEN(fen)
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	for _, m := range GenerateLegalMoves(pos) {
		if m.Flag == CastleKS {
			t.Fatalf("kingside castling was generated with no rook on h1: %+v", m)
		}
	}
}

func TestCastlingStillAllowedWithRookOnCorner(t *testing.T) {
	fen := "4k3/8/8/8/8/8/8/4K2R w K - 0 1"
	pos, err := ParseFEN(fen)
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	found := false
	for _, m := range GenerateLegalMoves(pos) {
		if m.Flag == CastleKS {
			found = true
		}
	}
	if !found {
		t.Fatalf("kingside castling was not generated even though a rook sits on h1")
	}
}

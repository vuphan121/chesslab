package chess

import "testing"

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

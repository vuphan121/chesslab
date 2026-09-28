package chess

import "testing"

func TestDoublePushNoAdjacentPawnLeavesEPUnset(t *testing.T) {
	g, err := NewGameFromFEN("test", "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPPN1PPP/R1BQKBNR b KQkq - 0 1")
	if err != nil {
		t.Fatalf("NewGameFromFEN: %v", err)
	}

	c5 := findMove(t, g, "c7", "c5")
	if err := g.ApplyMove(c5); err != nil {
		t.Fatalf("applying c5: %v", err)
	}

	if g.Pos.EP != NoSquare {
		t.Fatalf("EP = %v, want NoSquare (no white pawn on b4/d4... adjacent to c5's rank can capture it)", g.Pos.EP)
	}
	wantFEN := "rnbqkbnr/pp3ppp/4p3/2pp4/3PP3/8/PPPN1PPP/R1BQKBNR w KQkq - 0 2"
	if got := FEN(g.Pos); got != wantFEN {
		t.Fatalf("FEN = %q, want %q", got, wantFEN)
	}
}

func TestDoublePushWithAdjacentPawnSetsEP(t *testing.T) {
	g, err := NewGameFromFEN("test", "rnbqkbnr/pppppppp/8/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
	if err != nil {
		t.Fatalf("NewGameFromFEN: %v", err)
	}

	d5 := findMove(t, g, "d7", "d5")
	if err := g.ApplyMove(d5); err != nil {
		t.Fatalf("applying d5: %v", err)
	}

	if g.Pos.EP == NoSquare {
		t.Fatalf("EP = NoSquare, want d6 (e5 pawn can capture en passant)")
	}
	if got := ParseSquare("d6"); g.Pos.EP != got {
		t.Fatalf("EP = %v, want d6 (%v)", g.Pos.EP, got)
	}

	found := false
	for _, m := range g.LegalMoves() {
		if m.From == ParseSquare("e5") && m.To == ParseSquare("d6") && m.Flag == EnPassant {
			found = true
		}
	}
	if !found {
		t.Fatalf("exd6 e.p. not found in legal moves")
	}
}

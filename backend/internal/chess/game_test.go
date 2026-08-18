package chess

import "testing"

func TestGameResetDiscardsTree(t *testing.T) {
	g := NewGame("test")

	e4 := findMove(t, g, "e2", "e4")
	if err := g.ApplyMove(e4); err != nil {
		t.Fatalf("applying e4: %v", err)
	}
	e5 := findMove(t, g, "e7", "e5")
	if err := g.ApplyMove(e5); err != nil {
		t.Fatalf("applying e5: %v", err)
	}

	g.Reset()

	if len(g.Root.Children) != 0 {
		t.Fatalf("Reset() left %d stale children on the root, want 0", len(g.Root.Children))
	}
	if g.Current != g.Root {
		t.Fatalf("Reset() did not move Current back to the (new) root")
	}

	d4 := findMove(t, g, "d2", "d4")
	if err := g.ApplyMove(d4); err != nil {
		t.Fatalf("applying d4 after reset: %v", err)
	}
	if len(g.Root.Children) != 1 {
		t.Fatalf("after reset + one move, root should have exactly 1 child (no stale sideline), got %d", len(g.Root.Children))
	}
	if g.Root.Children[0].SAN != "d4" {
		t.Fatalf("expected the sole child to be d4, got %q", g.Root.Children[0].SAN)
	}
}

func TestGameResetToDiscardsTree(t *testing.T) {
	g := NewGame("test")

	e4 := findMove(t, g, "e2", "e4")
	if err := g.ApplyMove(e4); err != nil {
		t.Fatalf("applying e4: %v", err)
	}

	catalanFEN := "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"
	if err := g.ResetTo(catalanFEN); err != nil {
		t.Fatalf("ResetTo: %v", err)
	}

	if len(g.Root.Children) != 0 {
		t.Fatalf("ResetTo() left %d stale children on the root, want 0", len(g.Root.Children))
	}
	if g.Current != g.Root {
		t.Fatalf("ResetTo() did not move Current back to the (new) root")
	}
	if FEN(g.Pos) != catalanFEN {
		t.Fatalf("ResetTo() root FEN = %q, want %q", FEN(g.Pos), catalanFEN)
	}

	oo := findMove(t, g, "e1", "g1")
	if err := g.ApplyMove(oo); err != nil {
		t.Fatalf("applying O-O after ResetTo: %v", err)
	}
	if len(g.Root.Children) != 1 {
		t.Fatalf("after ResetTo + one move, root should have exactly 1 child, got %d", len(g.Root.Children))
	}
}

func findMove(t *testing.T, g *Game, from, to string) Move {
	t.Helper()
	fromSq := ParseSquare(from)
	toSq := ParseSquare(to)
	if fromSq == NoSquare || toSq == NoSquare {
		t.Fatalf("invalid square in %s->%s", from, to)
	}
	for _, m := range g.LegalMoves() {
		if m.From == fromSq && m.To == toSq {
			return m
		}
	}
	t.Fatalf("no legal move %s->%s in current position", from, to)
	return Move{}
}

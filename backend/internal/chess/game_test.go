package chess

import "testing"

// TestGameResetDiscardsTree covers the PGN-paste bug: pasting a line that
// diverges from whatever was already on the board must replace the game
// outright, not branch a sideline off the stale root. GotoNode(root) alone
// doesn't clear Children, so a diverging ApplyMove after it used to create
// exactly that stale sideline; Reset must actually give the root a clean
// Children slice.
func TestGameResetDiscardsTree(t *testing.T) {
	g := NewGame("test")

	// Play 1.e4 e5, then reset and play 1.d4 instead.
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

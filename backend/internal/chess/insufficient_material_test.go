package chess

import "testing"

func TestIsInsufficientMaterial(t *testing.T) {
	cases := []struct {
		name string
		fen  string
		want bool
	}{
		{"bare kings", "4k3/8/8/8/8/8/8/4K3 w - - 0 1", true},
		{"king+bishop vs king", "4k3/8/8/8/8/8/3B4/4K3 w - - 0 1", true},
		{"king+knight vs king", "4k3/8/8/8/8/8/3N4/4K3 w - - 0 1", true},
		{"same-color bishops both sides", "4k3/8/8/8/5b2/8/8/2B1K3 w - - 0 1", true},
		{"opposite-color bishops both sides is a forced win", "4k3/8/8/8/5b2/8/8/3BK3 w - - 0 1", false},
		{"king+bishop+knight vs king is a forced win", "4k3/8/8/8/8/8/2NB4/4K3 w - - 0 1", false},
		{"king+two knights vs king is not auto-drawn", "4k3/8/8/8/8/8/2NN4/4K3 w - - 0 1", false},
		{"a single pawn is sufficient", "4k3/8/8/8/8/8/3P4/4K3 w - - 0 1", false},
		{"a single rook is sufficient", "4k3/8/8/8/8/8/3R4/4K3 w - - 0 1", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pos, err := ParseFEN(c.fen)
			if err != nil {
				t.Fatalf("ParseFEN(%q): %v", c.fen, err)
			}
			g := &Game{Pos: pos}
			if got := g.IsInsufficientMaterial(); got != c.want {
				t.Fatalf("IsInsufficientMaterial(%q) = %v, want %v", c.fen, got, c.want)
			}
		})
	}
}

package chess

import "testing"

func TestNormalizeSetupCastling(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"adds rights for home king and rooks", "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"},
		{"drops a right whose rook is missing", "1rb1nrk1/5p1p/p1q1p1p1/1pbp2N1/2P2P2/PP1BP3/1B4PP/1R1QK2R w KQ - 0 1", "1rb1nrk1/5p1p/p1q1p1p1/1pbp2N1/2P2P2/PP1BP3/1B4PP/1R1QK2R w K - 0 1"},
		{"king off its square means no rights", "r3k2r/8/8/8/8/8/8/R4K1R b KQkq - 0 1", "r3k2r/8/8/8/8/8/8/R4K1R b kq - 0 1"},
		{"no castling possible", "6k1/8/8/8/8/8/8/6K1 w - - 0 1", "6k1/8/8/8/8/8/8/6K1 w - - 0 1"},
		{"already right is unchanged", StartFEN, StartFEN},
	}
	for _, tc := range cases {
		got, err := NormalizeSetupCastling(tc.in)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

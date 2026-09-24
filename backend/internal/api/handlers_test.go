package api

import (
	"testing"

	"github.com/chesslab/backend/internal/chess"
)

func TestGameStateIncludesGameOverReason(t *testing.T) {
	game, err := chess.NewGameFromFEN("draw", "8/8/8/8/8/8/4k3/6K1 w - - 0 1")
	if err != nil {
		t.Fatal(err)
	}

	state := toGameState(game)
	if !state.IsGameOver || !state.IsDraw || state.GameOverReason != "insufficient material" {
		t.Fatalf("unexpected game-over state: %+v", state)
	}
}

func TestMoveTreePlyParityFollowsSideToMove(t *testing.T) {
	cases := []struct {
		name, fen, san string
		rootPly        int
	}{
		{"initial position", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e4", 0},
		{"black to move, move 1", "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1", "Nf6", 1},
		{"white to move, move 5", "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 1 5", "c4", 8},
	}
	for _, tc := range cases {
		g, err := chess.NewGameFromFEN("g", tc.fen)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		m, ok := chess.FindLegalMoveBySAN(g.Pos, tc.san)
		if !ok {
			t.Fatalf("%s: %s not legal", tc.name, tc.san)
		}
		if err := g.ApplyMove(m); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		tree := toGameState(g).MoveTree
		if tree.Ply != tc.rootPly {
			t.Errorf("%s: root ply = %d, want %d", tc.name, tree.Ply, tc.rootPly)
		}
		// Move lists treat odd plies as White's moves.
		whiteMoved := g.Pos.Turn == chess.Black
		if got := tree.Children[0].Ply; (got%2 == 1) != whiteMoved {
			t.Errorf("%s: first move has ply %d, wrong parity for the side that moved", tc.name, got)
		}
	}
}

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

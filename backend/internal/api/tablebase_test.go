package api

import (
	"testing"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/lichess"
)

func intPtr(n int) *int { return &n }

func TestFlipTablebaseCategory(t *testing.T) {
	cases := map[string]string{
		"win":          "loss",
		"loss":         "win",
		"cursed-win":   "blessed-loss",
		"blessed-loss": "cursed-win",
		"maybe-win":    "maybe-loss",
		"maybe-loss":   "maybe-win",
		"draw":         "draw",
	}
	for in, want := range cases {
		if got := flipTablebaseCategory(in, true); got != want {
			t.Errorf("flipTablebaseCategory(%q, true) = %q, want %q", in, got, want)
		}
		if got := flipTablebaseCategory(in, false); got != in {
			t.Errorf("flipTablebaseCategory(%q, false) = %q, want %q (unchanged)", in, got, in)
		}
	}
}

func TestBestTablebaseMove(t *testing.T) {
	// The exact live KPvK response (4k3/8/4K3/4P3/8/8/8/8 w - - 0 1): Kd6 and
	// Kf6 both hand Black (now to move) a "loss" with the SAME DTZ (-2), but
	// different DTM (-20 vs -22) — a DTZ-only tie-break can't distinguish
	// the faster mate from the slower one, which is exactly the gap fixed by
	// preferring DTM. Kd5/Kf5 only draw.
	moves := []lichess.TablebaseMove{
		{UCI: "e6f6", Category: "loss", DTZ: intPtr(-2), DTM: intPtr(-22)},
		{UCI: "e6d6", Category: "loss", DTZ: intPtr(-2), DTM: intPtr(-20)},
		{UCI: "e6d5", Category: "draw", DTZ: intPtr(0)},
		{UCI: "e6f5", Category: "draw", DTZ: intPtr(0)},
	}
	best := bestTablebaseMove(moves)
	if best == nil || best.UCI != "e6d6" {
		t.Fatalf("bestTablebaseMove = %+v, want e6d6 (fastest forced loss for the opponent, by DTM despite tied DTZ)", best)
	}

	if got := bestTablebaseMove(nil); got != nil {
		t.Errorf("bestTablebaseMove(nil) = %+v, want nil", got)
	}
}

func TestTablebaseAnalysis_WhiteToMoveWin(t *testing.T) {
	pos, err := chess.ParseFEN("4k3/8/4K3/4P3/8/8/8/8 w - - 0 1")
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	tb := &lichess.TablebaseResult{
		Category: "win",
		DTZ:      intPtr(3),
		DTM:      intPtr(21),
		Moves: []lichess.TablebaseMove{
			{UCI: "e6d6", Category: "loss", DTZ: intPtr(-2), DTM: intPtr(-20)},
			{UCI: "e6d5", Category: "draw", DTZ: intPtr(0)},
		},
	}

	result := tablebaseAnalysis(pos, tb)

	if result.TablebaseCategory != "win" {
		t.Errorf("TablebaseCategory = %q, want %q (White to move, White-relative unchanged)", result.TablebaseCategory, "win")
	}
	if result.TablebaseDTZ == nil || *result.TablebaseDTZ != 3 {
		t.Errorf("TablebaseDTZ = %v, want 3", result.TablebaseDTZ)
	}
	if result.Score <= 0 {
		t.Errorf("Score = %d, want positive (White winning)", result.Score)
	}
	// 21 plies -> ceil(21/2) = 11 moves, positive since White (the mover) is winning.
	if result.Mate != 11 {
		t.Errorf("Mate = %d, want 11", result.Mate)
	}
	if result.BestMove != "e6d6" {
		t.Errorf("BestMove = %q, want e6d6", result.BestMove)
	}
}

func TestTablebaseAnalysis_BlackToMoveWin(t *testing.T) {
	// Same shape but with Black to move and winning — verifies the
	// White-relative flip: category flips win->loss, DTZ/Mate negate.
	pos, err := chess.ParseFEN("4k3/8/4K3/4P3/8/8/8/8 b - - 0 1")
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	tb := &lichess.TablebaseResult{
		Category: "win",
		DTZ:      intPtr(5),
		DTM:      intPtr(9),
	}

	result := tablebaseAnalysis(pos, tb)

	if result.TablebaseCategory != "loss" {
		t.Errorf("TablebaseCategory = %q, want %q (Black winning is a White-relative loss)", result.TablebaseCategory, "loss")
	}
	if result.TablebaseDTZ == nil || *result.TablebaseDTZ != -5 {
		t.Errorf("TablebaseDTZ = %v, want -5", result.TablebaseDTZ)
	}
	if result.Score >= 0 {
		t.Errorf("Score = %d, want negative (Black winning)", result.Score)
	}
	if result.Mate != -5 { // ceil(9/2) = 5, negated for White-relative
		t.Errorf("Mate = %d, want -5", result.Mate)
	}
}

func TestTablebaseAnalysis_NoDTM(t *testing.T) {
	// 7-man positions never carry a DTM on Lichess's server (verified live) —
	// Score should still reflect the decisive result, Mate should stay 0
	// rather than fabricate a distance.
	pos, err := chess.ParseFEN("4k3/8/4K3/4P3/8/8/8/8 w - - 0 1")
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	tb := &lichess.TablebaseResult{Category: "win", DTZ: intPtr(3)}

	result := tablebaseAnalysis(pos, tb)
	if result.Mate != 0 {
		t.Errorf("Mate = %d, want 0 (no DTM available)", result.Mate)
	}
	if result.Score <= 0 {
		t.Errorf("Score = %d, want positive sentinel", result.Score)
	}
}

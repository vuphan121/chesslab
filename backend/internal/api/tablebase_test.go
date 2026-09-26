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
		"syzygy-win":   "syzygy-loss",
		"syzygy-loss":  "syzygy-win",
		"draw":         "draw",
		"unknown":      "unknown",
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
	// bestTablebaseMove trusts Lichess's documented "best first" ordering —
	// it must return element 0 regardless of category/DTZ/DTM shape.
	moves := []lichess.TablebaseMove{
		{UCI: "e6d6", Category: "loss", DTZ: intPtr(-2), DTM: intPtr(-20)},
		{UCI: "e6f6", Category: "loss", DTZ: intPtr(-2), DTM: intPtr(-22)},
		{UCI: "e6d5", Category: "draw", DTZ: intPtr(0)},
	}
	if best := bestTablebaseMove(moves); best == nil || best.UCI != "e6d6" {
		t.Fatalf("bestTablebaseMove = %+v, want e6d6 (moves[0])", best)
	}

	// Regression for the bug this replaced: the old rank+DTM-tie-break logic
	// collapsed "loss" and "blessed-loss" into one tier and preferred
	// whichever had the algebraically larger DTM — here that was the
	// blessed-loss move (a 50-move-rule DRAW), wrongly beating a real loss
	// for the opponent (a real win for us) listed first by Lichess.
	winThenDraw := []lichess.TablebaseMove{
		{UCI: "real_win", Category: "loss", DTZ: intPtr(-6), DTM: intPtr(-80)},
		{UCI: "actually_a_draw", Category: "blessed-loss", DTZ: intPtr(-60), DTM: intPtr(-10)},
	}
	if best := bestTablebaseMove(winThenDraw); best == nil || best.UCI != "real_win" {
		t.Fatalf("bestTablebaseMove = %+v, want real_win (moves[0], not the higher-DTM blessed-loss)", best)
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

func TestTablebaseAnalysis_BlessedLossIsNotShownAsDecisive(t *testing.T) {
	// Live repro: 8/8/8/7p/3K1N2/5N2/2k5/8 b - - 50 1 returns category
	// "blessed-loss" with dtm: -138 — a provable DRAW under the 50-move rule
	// (Black can always claim it), not a forced mate. Before this fix, Mate
	// was derived from the raw DTM regardless of category, producing a
	// fabricated "#69" (White-relative) for a legally drawn position.
	pos, err := chess.ParseFEN("8/8/8/7p/3K1N2/5N2/2k5/8 b - - 50 1")
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	tb := &lichess.TablebaseResult{Category: "blessed-loss", DTZ: intPtr(-51), DTM: intPtr(-138)}

	result := tablebaseAnalysis(pos, tb)
	if result.Mate != 0 {
		t.Errorf("Mate = %d, want 0 (blessed-loss is a 50-move-rule draw, not a forced mate)", result.Mate)
	}
	if result.Score != 0 {
		t.Errorf("Score = %d, want 0 (not decisive)", result.Score)
	}
	if result.TablebaseCategory != "cursed-win" {
		t.Errorf("TablebaseCategory = %q, want %q (Black's blessed-loss is White's cursed-win)", result.TablebaseCategory, "cursed-win")
	}
}

func TestTablebaseAnalysis_SyzygyWinLossAreDecisive(t *testing.T) {
	pos, err := chess.ParseFEN("4k3/8/4K3/4P3/8/8/8/8 w - - 0 1")
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	tb := &lichess.TablebaseResult{Category: "syzygy-win", DTZ: intPtr(3), DTM: intPtr(21)}

	result := tablebaseAnalysis(pos, tb)
	if result.Score <= 0 {
		t.Errorf("Score = %d, want positive (syzygy-win is decisive)", result.Score)
	}
	if result.Mate != 11 {
		t.Errorf("Mate = %d, want 11 (syzygy-win should carry a real DTM like win)", result.Mate)
	}
}

func TestTablebaseAnalysis_UnknownStaysNeutral(t *testing.T) {
	pos, err := chess.ParseFEN("4k3/8/4K3/4P3/8/8/8/8 w - - 0 1")
	if err != nil {
		t.Fatalf("ParseFEN: %v", err)
	}
	tb := &lichess.TablebaseResult{Category: "unknown"}

	result := tablebaseAnalysis(pos, tb)
	if result.Score != 0 || result.Mate != 0 {
		t.Errorf("Score/Mate = %d/%d, want 0/0 for an unresolved position", result.Score, result.Mate)
	}
	if result.TablebaseCategory != "unknown" {
		t.Errorf("TablebaseCategory = %q, want %q", result.TablebaseCategory, "unknown")
	}
}

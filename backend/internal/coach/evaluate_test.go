package coach

import "testing"

func TestEvaluateMoveLegalSAN(t *testing.T) {
	tools := &Tools{}
	const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

	res, err := tools.EvaluateMove(startFEN, "Nf3")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Legal {
		t.Fatalf("Nf3 should be legal from the start position")
	}
	if res.Move != "Nf3" {
		t.Errorf("canonical SAN = %q, want Nf3", res.Move)
	}
	if res.UCI != "g1f3" {
		t.Errorf("UCI = %q, want g1f3", res.UCI)
	}
	if res.ResultingFEN == "" {
		t.Error("expected a resulting FEN")
	}
}

func TestEvaluateMoveAcceptsUCI(t *testing.T) {
	tools := &Tools{}
	const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

	res, err := tools.EvaluateMove(startFEN, "e2e4")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Legal || res.Move != "e4" {
		t.Errorf("e2e4 should resolve to legal SAN e4, got legal=%v move=%q", res.Legal, res.Move)
	}
}

func TestEvaluateMoveIllegal(t *testing.T) {
	tools := &Tools{}
	const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

	res, err := tools.EvaluateMove(startFEN, "Nf6")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Legal {
		t.Errorf("Nf6 should not be legal for White from the start position")
	}
	if res.Note == "" {
		t.Error("expected a note explaining the move is not legal")
	}
}

func TestEvaluateMoveStripsAnnotations(t *testing.T) {
	tools := &Tools{}
	const startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

	res, err := tools.EvaluateMove(startFEN, "e4!?")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Legal || res.Move != "e4" {
		t.Errorf("e4!? should resolve to legal e4, got legal=%v move=%q", res.Legal, res.Move)
	}
}

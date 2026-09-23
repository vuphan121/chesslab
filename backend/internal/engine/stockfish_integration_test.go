package engine

import (
	"os"
	"testing"
)

const startingFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

func stockfishForIntegrationTest(t *testing.T) *Engine {
	t.Helper()
	path := os.Getenv("STOCKFISH_PATH")
	if path == "" {
		t.Skip("STOCKFISH_PATH is not set")
	}
	eng, err := New(path)
	if err != nil {
		t.Fatalf("starting Stockfish: %v", err)
	}
	t.Cleanup(eng.Close)
	return eng
}

func TestAnalyzeRecoversAfterStockfishProcessDies(t *testing.T) {
	eng := stockfishForIntegrationTest(t)
	if err := eng.cmd.Process.Kill(); err != nil {
		t.Fatalf("killing Stockfish: %v", err)
	}

	got, err := eng.Analyze(startingFEN, 1, 4)
	if err != nil {
		t.Fatalf("Analyze did not recover after Stockfish exited: %v", err)
	}
	if got.BestMove == "" || len(got.Lines) == 0 {
		t.Fatalf("recovered analysis is incomplete: %+v", got)
	}
}

func TestStopAndDrainKeepsNextAnalysisClean(t *testing.T) {
	eng := stockfishForIntegrationTest(t)

	eng.mu.Lock()
	if err := eng.send("position fen " + startingFEN); err != nil {
		eng.mu.Unlock()
		t.Fatalf("sending position: %v", err)
	}
	if err := eng.send("go infinite"); err != nil {
		eng.mu.Unlock()
		t.Fatalf("starting search: %v", err)
	}
	eng.stopAndDrainLocked()
	eng.mu.Unlock()

	got, err := eng.Analyze(startingFEN, 1, 4)
	if err != nil {
		t.Fatalf("analysis after stop: %v", err)
	}
	if got.BestMove == "" || len(got.Lines) == 0 {
		t.Fatalf("analysis after stop is incomplete: %+v", got)
	}
}

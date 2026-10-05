package api

import (
	"errors"
	"os"
	"testing"

	"github.com/chesslab/backend/internal/engine"
)

func TestPrecomputeEngineIsOnlyStartedWhenAPositionNeedsIt(t *testing.T) {
	calls := 0
	h := &Handler{}
	h.SetPrecomputeEngineFactory(func() (*engine.Engine, error) {
		calls++
		return nil, errors.New("no stockfish here")
	})
	if !h.precomputeAvailable() {
		t.Fatal("a factory means precompute can use stockfish")
	}
	get, release := h.lazyPrecomputeEngine()
	if calls != 0 {
		t.Fatalf("the engine started before anyone asked for it (%d calls)", calls)
	}
	release()
	if calls != 0 {
		t.Fatal("releasing an engine that never started must not start one")
	}
	if get() != nil || get() != nil || get() != nil {
		t.Fatal("a failed start should return no engine")
	}
	if calls != 1 {
		t.Fatalf("a failed start is not retried within a run, got %d calls", calls)
	}
}

func TestPrecomputeWithoutFactoryOrEngineHasNoStockfish(t *testing.T) {
	h := &Handler{}
	if h.precomputeAvailable() {
		t.Fatal("no engine and no factory means unavailable")
	}
	get, release := h.lazyPrecomputeEngine()
	defer release()
	if get() != nil {
		t.Fatal("expected no engine")
	}
}

func TestEachRunStartsItsOwnEngineSession(t *testing.T) {
	calls := 0
	h := &Handler{}
	h.SetPrecomputeEngineFactory(func() (*engine.Engine, error) {
		calls++
		return nil, errors.New("down")
	})
	for run := 1; run <= 3; run++ {
		get, release := h.lazyPrecomputeEngine()
		get()
		release()
		if calls != run {
			t.Fatalf("run %d should start the engine once, total calls %d", run, calls)
		}
	}
}

func TestPrecomputeEngineStartsOnDemandAndIsClosedAfterTheRun(t *testing.T) {
	path := os.Getenv("STOCKFISH_PATH")
	if path == "" {
		t.Skip("STOCKFISH_PATH not set")
	}
	starts := 0
	h := &Handler{}
	h.SetPrecomputeEngineFactory(func() (*engine.Engine, error) {
		starts++
		return engine.NewLowPriority(path)
	})
	get, release := h.lazyPrecomputeEngine()
	first := get()
	if first == nil || starts != 1 {
		t.Fatalf("expected one engine start, got engine=%v starts=%d", first, starts)
	}
	if get() != first || starts != 1 {
		t.Fatal("the same engine should be reused for the whole run")
	}
	release()
	release()
	get2, release2 := h.lazyPrecomputeEngine()
	defer release2()
	if get2() == nil || starts != 2 {
		t.Fatalf("a new run should start a fresh engine, starts=%d", starts)
	}
}

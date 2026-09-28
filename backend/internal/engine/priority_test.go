package engine

import (
	"os/exec"
	"reflect"
	"runtime"
	"testing"
)

func TestCommandNormalPriorityRunsEngineDirectly(t *testing.T) {
	e := &Engine{path: "/usr/games/stockfish"}
	got := e.command().Args
	if want := []string{"/usr/games/stockfish"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %v, want %v", got, want)
	}
}

func TestCommandLowPriorityUsesNiceOnLinux(t *testing.T) {
	e := &Engine{path: "/usr/games/stockfish", lowPriority: true}
	got := e.command().Args

	nicePath, err := exec.LookPath("nice")
	if runtime.GOOS != "linux" || err != nil {
		if want := []string{"/usr/games/stockfish"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("args = %v, want %v", got, want)
		}
		return
	}
	if want := []string{nicePath, "-n", "19", "/usr/games/stockfish"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %v, want %v", got, want)
	}
}

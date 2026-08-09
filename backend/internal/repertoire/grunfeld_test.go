package repertoire

import (
	"os"
	"testing"

	"github.com/chesslab/backend/internal/chess"
)

func TestGrunfeldStudyLoadsByChapter(t *testing.T) {
	data, err := os.ReadFile("../../data/repertoires/grunfeld.pgn")
	if err != nil {
		t.Fatalf("read Grunfeld PGN: %v", err)
	}
	chapters, err := ParsePGN(string(data))
	if err != nil {
		t.Fatalf("ParsePGN: %v", err)
	}
	if len(chapters) != 2 {
		t.Fatalf("got %d chapters, want 2", len(chapters))
	}
	for i, want := range []string{"Exchange variation", "Exchange variation sidelines"} {
		if chapters[i].Name != want {
			t.Errorf("chapter %d name = %q, want %q", i+1, chapters[i].Name, want)
		}
	}

	cfg, err := LoadConfig("../../data/repertoires/grunfeld.config.json")
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	rep, err := BuildRepertoire(chapters, cfg)
	if err != nil {
		t.Fatalf("BuildRepertoire: %v", err)
	}
	if rep.Side != chess.Black {
		t.Errorf("Side = %v, want Black", rep.Side)
	}
	if len(rep.Cards) == 0 {
		t.Error("expected at least one Black drill card")
	}
}

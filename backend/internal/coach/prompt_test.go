package coach

import (
	"strings"
	"testing"
)

func TestMoverAndPly(t *testing.T) {
	cases := []struct {
		name      string
		fen       string
		wantMover string
		wantPly   int
	}{

		{"after white's first move", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", "White", 1},

		{"after black's first move", "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", "Black", 2},

		{"after white's second move", "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", "White", 3},
		{"unparseable", "not a fen", "", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mover, ply := moverAndPly(c.fen)
			if mover != c.wantMover || ply != c.wantPly {
				t.Errorf("moverAndPly(%q) = (%q, %d), want (%q, %d)", c.fen, mover, ply, c.wantMover, c.wantPly)
			}
		})
	}
}

func TestShowEngineEval(t *testing.T) {
	book := &MoveQuality{Category: CategoryBook}
	blunder := &MoveQuality{Category: CategoryBlunder}
	good := &MoveQuality{Category: CategoryGood}

	cases := []struct {
		name    string
		ply     int
		quality *MoveQuality
		want    bool
	}{
		{"opening book move -> suppress", 3, book, false},
		{"opening good move -> suppress", 4, good, false},
		{"opening move, no verdict -> suppress", 5, nil, false},
		{"opening blunder -> show", 6, blunder, true},
		{"past opening -> always show", 12, good, true},
		{"unparseable ply -> show", 0, good, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := showEngineEval(c.ply, c.quality); got != c.want {
				t.Errorf("showEngineEval(%d, %v) = %v, want %v", c.ply, c.quality, got, c.want)
			}
		})
	}
}

func TestBuildExplainPromptSuppressesOpeningEval(t *testing.T) {
	req := ExplainRequest{
		FEN:         "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
		LastMoveSAN: "e4",
		Analysis:    &AnalysisInput{EngineName: "Test", Depth: 20, Score: 30},
	}
	_, user := BuildExplainPrompt(req, LookupResult{}, &MoveQuality{Category: CategoryBest})

	if strings.Contains(user, "Engine evaluation") {
		t.Errorf("expected no engine-evaluation section for an early book move, got:\n%s", user)
	}
	if !strings.Contains(user, "played by White") {
		t.Errorf("expected the prompt to name White as the mover, got:\n%s", user)
	}
}

func TestPerspectiveLine(t *testing.T) {
	cases := []struct {
		name         string
		mover        string
		viewerColor  string
		wantContains []string
		wantEmpty    bool
	}{
		{
			name:  "no mover -> empty (root position)",
			mover: "", viewerColor: "w",
			wantEmpty: true,
		},
		{
			name:  "no viewer given -> defaults to mover, same-side framing",
			mover: "White", viewerColor: "",
			wantContains: []string{"coaching White", "played by White", "same side"},
		},
		{
			name:  "viewer same as mover -> same-side framing",
			mover: "White", viewerColor: "w",
			wantContains: []string{"coaching White", "played by White", "same side"},
		},
		{
			name:  "viewer differs from mover -> third-person framing",
			mover: "Black", viewerColor: "w",
			wantContains: []string{"coaching White", "played by Black", "OTHER side", "third person"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := perspectiveLine(c.mover, c.viewerColor)
			if c.wantEmpty {
				if got != "" {
					t.Errorf("perspectiveLine(%q, %q) = %q, want empty", c.mover, c.viewerColor, got)
				}
				return
			}
			for _, want := range c.wantContains {
				if !strings.Contains(got, want) {
					t.Errorf("perspectiveLine(%q, %q) = %q, want it to contain %q", c.mover, c.viewerColor, got, want)
				}
			}
		})
	}
}

func TestBuildExplainPromptViewerDiffersFromMover(t *testing.T) {
	req := ExplainRequest{
		FEN:         "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
		LastMoveSAN: "e5",
		ViewerColor: "w",
	}
	_, user := BuildExplainPrompt(req, LookupResult{}, nil)
	if !strings.Contains(user, "coaching White") || !strings.Contains(user, "played by Black") {
		t.Errorf("expected viewer(White)/mover(Black) framing in prompt, got:\n%s", user)
	}
}

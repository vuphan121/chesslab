package repertoire

import (
	"os"
	"testing"

	"github.com/chesslab/backend/internal/chess"
)

const demoPGNPath = "../../data/repertoires/catalan-white.pgn"
const catalanFEN = "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"
const catalanNc6FEN = "r1bqkb1r/ppp2ppp/2n1pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"
const catalanC5FEN = "rnbqkb1r/pp3ppp/4pn2/2p5/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 1 5"
const catalanClosedFEN = "rnbq1rk1/ppp1bppp/4pn2/3p4/2PP4/5NP1/PP2PPBP/RNBQ1RK1 b - - 0 1"
const catalanClosedDxc4FEN = "rnbq1rk1/ppp1bppp/4pn2/8/2pP4/5NP1/PP2PPBP/RNBQ1RK1 w - - 0 1"

func loadDemoChapters(t *testing.T) []*Chapter {
	t.Helper()
	data, err := os.ReadFile(demoPGNPath)
	if err != nil {
		t.Fatalf("read demo pgn: %v", err)
	}
	chapters, err := ParsePGN(string(data))
	if err != nil {
		t.Fatalf("ParsePGN: %v", err)
	}
	return chapters
}

func TestParsePGN_SixChapters(t *testing.T) {
	chapters := loadDemoChapters(t)
	if len(chapters) != 6 {
		t.Fatalf("got %d chapters, want 6", len(chapters))
	}
	wantNames := []string{
		"Open, a6 b5",
		"Open, a6 Nc6",
		"Open, Nc6",
		"Open, c5",
		"Closed",
		"Closed with dxc4",
	}
	for i, want := range wantNames {
		if chapters[i].Name != want {
			t.Errorf("chapter %d name = %q, want %q", i+1, chapters[i].Name, want)
		}
	}
}

func TestParsePGN_CustomStartFEN(t *testing.T) {

	chapters := loadDemoChapters(t)
	want := map[string]string{
		"Open, a6 b5":      catalanFEN,
		"Open, a6 Nc6":     catalanFEN,
		"Open, Nc6":        catalanNc6FEN,
		"Open, c5":         catalanC5FEN,
		"Closed":           catalanClosedFEN,
		"Closed with dxc4": catalanClosedDxc4FEN,
	}
	wantTurn := map[string]string{
		"Closed": "b",
	}
	for _, ch := range chapters {
		wantFEN, ok := want[ch.Name]
		if !ok {
			t.Fatalf("unexpected chapter %q", ch.Name)
		}
		if ch.StartFEN != wantFEN {
			t.Errorf("%s: StartFEN = %q, want %q", ch.Name, ch.StartFEN, wantFEN)
		}
		if ch.Root.FEN != wantFEN {
			t.Errorf("%s: root.FEN = %q, want %q", ch.Name, ch.Root.FEN, wantFEN)
		}
		turn := "w"
		if t2, ok := wantTurn[ch.Name]; ok {
			turn = t2
		}
		if ch.Root.Pos.Turn.String() != turn {
			t.Errorf("%s: root side to move = %s, want %s", ch.Name, ch.Root.Pos.Turn, turn)
		}
	}
}

func TestParsePGN_Chapter3HasFourOpponentAlternatesAndNestedVariation(t *testing.T) {
	root := loadDemoChapters(t)[2].Root
	qa4 := findChild(t, root, "Qa4")

	if len(qa4.Children) != 5 {
		t.Fatalf("Qa4 node has %d children, want 5 (Bb4+ mainline + 4 opponent alternates)", len(qa4.Children))
	}
	bb4 := findChild(t, qa4, "Bb4+")
	bd2 := findChild(t, bb4, "Bd2")

	if len(bd2.Children) != 3 {
		t.Fatalf("Bd2 node has %d children, want 3 (Nd5 mainline + Bxd2+ and Bd6 sidelines)", len(bd2.Children))
	}
	bd6 := findChild(t, bd2, "Bd6")
	na3 := findChild(t, bd6, "Na3")
	if len(na3.Children) != 2 {
		t.Fatalf("Na3 (under Bd6) has %d children, want 2 (Ne4 mainline + Bxa3 nested sideline)", len(na3.Children))
	}
}

func TestParsePGN_Chapter1RootHasIntroCommentAndTwoChildren(t *testing.T) {
	root := loadDemoChapters(t)[0].Root
	if root.Comment == "" {
		t.Error("chapter 1 root should carry the intro comment (attaches before any move)")
	}
	if len(root.Children) != 2 {
		t.Fatalf("chapter 1 root has %d children, want 2 (O-O mainline + a4 sideline)", len(root.Children))
	}
	if root.Children[0].SAN != "O-O" {
		t.Errorf("chapter 1 root children[0] = %q, want O-O (mainline)", root.Children[0].SAN)
	}
	if root.Children[1].SAN != "a4" {
		t.Errorf("chapter 1 root children[1] = %q, want a4 (sideline)", root.Children[1].SAN)
	}

	if root.Children[0].Comment == "" {
		t.Error("O-O node should carry the study's comment text")
	}
}

func TestParsePGN_Chapter2HasDeeplyNestedVariation(t *testing.T) {
	root := loadDemoChapters(t)[1].Root

	oo := findChild(t, root, "O-O")
	nc6 := findChild(t, oo, "Nc6")
	if len(nc6.Children) != 2 {
		t.Fatalf("Nc6 node has %d children, want 2 (e3 mainline + Nc3 sideline)", len(nc6.Children))
	}
	e3 := findChild(t, nc6, "e3")
	if len(e3.Children) != 2 {
		t.Fatalf("e3 node has %d children, want 2 (Bd7 mainline + Rb8 sideline)", len(e3.Children))
	}
	rb8 := findChild(t, e3, "Rb8")
	nfd2 := findChild(t, rb8, "Nfd2")

	if len(nfd2.Children) != 2 {
		t.Fatalf("Nfd2 node has %d children, want 2 (e5 mainline + Qd7 nested sideline)", len(nfd2.Children))
	}
	e5 := findChild(t, nfd2, "e5")
	if len(e5.Children) != 1 {
		t.Fatalf("e5 node has %d children, want 1 (Bxc6+ mainline continues)", len(e5.Children))
	}
	qd7 := findChild(t, nfd2, "Qd7")
	if len(qd7.Children) == 0 {
		t.Fatal("Qd7 (depth-3 nested variation) should have its own continuation")
	}
}

func TestParsePGN_EveryMoveReplaysLegally(t *testing.T) {

	loadDemoChapters(t)
}

func TestParsePGN_AllLinesReplayExactly(t *testing.T) {
	chapters := loadDemoChapters(t)
	total := 0
	for _, ch := range chapters {
		var walk func(node *Node, path []string)
		walk = func(node *Node, path []string) {
			if len(node.Children) == 0 {
				total++
				verifyLineReplaysExactly(t, ch.Name, ch.StartFEN, path, node.FEN)
				return
			}
			for _, child := range node.Children {
				walk(child, append(path, child.SAN))
			}
		}
		walk(ch.Root, nil)
	}
	if total == 0 {
		t.Fatal("walked zero lines — test isn't exercising anything")
	}
	t.Logf("verified %d full lines across %d chapters", total, len(chapters))
}

func verifyLineReplaysExactly(t *testing.T, chapterName, startFEN string, sans []string, wantFinalFEN string) {
	t.Helper()
	pos, err := chess.ParseFEN(startFEN)
	if err != nil {
		t.Fatalf("chapter %q: bad start FEN %q: %v", chapterName, startFEN, err)
	}
	for i, san := range sans {
		m, ok := chess.FindLegalMoveBySAN(pos, san)
		if !ok {
			t.Fatalf("chapter %q, line %v: ply %d token %q did not resolve to any legal move", chapterName, sans, i+1, san)
		}
		if got := chess.SAN(pos, m); got != san {
			t.Errorf("chapter %q, line %v: ply %d token %q replayed as %q instead", chapterName, sans, i+1, san, got)
		}
		pos = chess.ApplyMove(pos, m)
	}
	if got := chess.FEN(pos); got != wantFinalFEN {
		t.Errorf("chapter %q, line %v: final FEN mismatch\n got:  %s\n want: %s", chapterName, sans, got, wantFinalFEN)
	}
}

func findChild(t *testing.T, n *Node, san string) *Node {
	t.Helper()
	for _, c := range n.Children {
		if c.SAN == san {
			return c
		}
	}
	t.Fatalf("no child %q under node at ply %d (fen %s)", san, n.Ply, n.FEN)
	return nil
}

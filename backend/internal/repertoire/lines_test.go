package repertoire

import "testing"

func TestLinesSkipExcludedAndMatchIDs(t *testing.T) {
	root := &Node{FEN: "r1 w - - 0 1"}
	a := &Node{SAN: "e4", FEN: "r2 b - - 0 2"}
	b := &Node{SAN: "d4", FEN: "r3 b - - 0 2", Excluded: true}
	a1 := &Node{SAN: "e5", FEN: "r4 w - - 0 3"}
	root.Children = []*Node{a, b}
	a.Children = []*Node{a1}
	rep := &Repertoire{
		Chapters: []*Chapter{{ID: "ch1", Root: root}},
		Cards:    []*Card{{ID: CardKey(root.FEN)}, {ID: CardKey(a1.FEN)}},
	}
	lines := Lines(rep)
	if len(lines) != 1 || lines[0].ID != "ch1:e4 e5" || lines[0].ChapterID != "ch1" {
		t.Fatalf("lines = %+v", lines)
	}
	if len(lines[0].CardIDs) != 2 {
		t.Fatalf("card ids = %v", lines[0].CardIDs)
	}
}

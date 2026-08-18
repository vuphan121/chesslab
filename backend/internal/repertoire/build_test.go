package repertoire

import (
	"testing"

	"github.com/chesslab/backend/internal/chess"
)

func buildDemo(t *testing.T) *Repertoire {
	t.Helper()
	chapters := loadDemoChapters(t)
	cfg, err := LoadConfig("../../data/repertoires/catalan-white.config.json")
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	rep, err := BuildRepertoire(chapters, cfg)
	if err != nil {
		t.Fatalf("BuildRepertoire: %v", err)
	}
	return rep
}

func TestBuildRepertoire_Side(t *testing.T) {
	rep := buildDemo(t)
	if rep.Side != chess.White {
		t.Errorf("Side = %v, want White", rep.Side)
	}
}

func TestBuildRepertoire_CardCount(t *testing.T) {
	rep := buildDemo(t)
	if len(rep.Cards) != 130 {
		names := make([]string, 0, len(rep.Cards))
		for _, c := range rep.Cards {
			names = append(names, c.ID)
		}
		t.Fatalf("got %d cards, want 130 (see docs/opening-trainer/data-format.md §2.3): %v", len(rep.Cards), names)
	}
}

func TestBuildRepertoire_Chapter4IsIndependent(t *testing.T) {
	rep := buildDemo(t)
	ch4 := chapterByName(t, rep, "Open, c5")
	if ch4.StartFEN == catalanFEN || ch4.StartFEN == catalanNc6FEN {
		t.Fatal("chapter 4 should not share another chapter's start position")
	}
	root4 := findCard(t, rep, CardKey(ch4.StartFEN))
	if len(root4.ChapterIDs) != 1 || root4.ChapterIDs[0] != ch4.ID {
		t.Errorf("chapter 4 root card ChapterIDs = %v, want just [%s]", root4.ChapterIDs, ch4.ID)
	}
	if len(root4.Answers) != 1 || root4.Answers[0].SAN != "O-O" || !root4.Answers[0].Primary {
		t.Errorf("chapter 4 root card answers = %+v, want exactly primary O-O", root4.Answers)
	}
	if len(root4.ExcludedAnswers) != 0 {
		t.Errorf("chapter 4 root card excludedAnswers = %+v, want none", root4.ExcludedAnswers)
	}
}

func TestBuildRepertoire_Chapter3IsIndependent(t *testing.T) {
	rep := buildDemo(t)
	ch3 := chapterByName(t, rep, "Open, Nc6")
	if ch3.StartFEN == catalanFEN {
		t.Fatal("chapter 3 should not share chapter 1/2's start position")
	}
	root3 := findCard(t, rep, CardKey(ch3.StartFEN))
	if len(root3.ChapterIDs) != 1 || root3.ChapterIDs[0] != ch3.ID {
		t.Errorf("chapter 3 root card ChapterIDs = %v, want just [%s]", root3.ChapterIDs, ch3.ID)
	}
	if len(root3.Answers) != 1 || root3.Answers[0].SAN != "Qa4" || !root3.Answers[0].Primary {
		t.Errorf("chapter 3 root card answers = %+v, want exactly primary Qa4", root3.Answers)
	}
	if len(root3.ExcludedAnswers) != 0 {
		t.Errorf("chapter 3 root card excludedAnswers = %+v, want none", root3.ExcludedAnswers)
	}
}

func TestBuildRepertoire_Chapter6IsIndependent(t *testing.T) {
	rep := buildDemo(t)
	ch6 := chapterByName(t, rep, "Closed with dxc4")
	if ch6.StartFEN == catalanFEN || ch6.StartFEN == catalanNc6FEN || ch6.StartFEN == catalanC5FEN {
		t.Fatal("chapter 6 should not share another chapter's start position")
	}
	root6 := findCard(t, rep, CardKey(ch6.StartFEN))
	if len(root6.ChapterIDs) != 1 || root6.ChapterIDs[0] != ch6.ID {
		t.Errorf("chapter 6 root card ChapterIDs = %v, want just [%s]", root6.ChapterIDs, ch6.ID)
	}
	if len(root6.Answers) != 1 || root6.Answers[0].SAN != "Qc2" || !root6.Answers[0].Primary {
		t.Errorf("chapter 6 root card answers = %+v, want exactly primary Qc2", root6.Answers)
	}
	if len(root6.ExcludedAnswers) != 0 {
		t.Errorf("chapter 6 root card excludedAnswers = %+v, want none", root6.ExcludedAnswers)
	}
}

func TestBuildRepertoire_Chapter5RootIsOpponentToMove(t *testing.T) {
	rep := buildDemo(t)
	ch5 := chapterByName(t, rep, "Closed")
	if _, ok := findCardOK(rep, CardKey(ch5.StartFEN)); ok {
		t.Fatal("chapter 5 root (Black to move) should not itself be a card")
	}
	replies := rep.Replies[CardKey(ch5.StartFEN)]
	if len(replies) != 1 || replies[0].SAN != "c6" {
		t.Fatalf("chapter 5 root replies = %+v, want exactly {c6}", replies)
	}
	c6 := findChild(t, ch5.Root, "c6")
	card := findCard(t, rep, CardKey(c6.FEN))
	if len(card.Answers) != 1 || card.Answers[0].SAN != "Qc2" || !card.Answers[0].Primary {
		t.Errorf("chapter 5 card after c6 answers = %+v, want exactly primary Qc2", card.Answers)
	}
}

func TestBuildRepertoire_RootCardSharedAcrossChapters(t *testing.T) {
	rep := buildDemo(t)
	root := findCard(t, rep, CardKey(catalanFEN))
	if len(root.ChapterIDs) != 2 {
		t.Errorf("root card ChapterIDs = %v, want both chapters", root.ChapterIDs)
	}
	if len(root.Answers) != 1 || root.Answers[0].SAN != "O-O" || !root.Answers[0].Primary {
		t.Errorf("root card answers = %+v, want exactly primary O-O", root.Answers)
	}
	if len(root.ExcludedAnswers) != 1 || root.ExcludedAnswers[0].SAN != "a4" {
		t.Errorf("root card excludedAnswers = %+v, want excluded a4", root.ExcludedAnswers)
	}
}

func TestBuildRepertoire_NoCardsInExcludedSubtree(t *testing.T) {
	rep := buildDemo(t)

	ch1 := chapterByName(t, rep, "Open, a6 b5")
	a4 := findChild(t, ch1.Root, "a4")
	if !a4.Excluded {
		t.Fatal("a4 node should be marked Excluded")
	}
	nc6bad := findChild(t, a4, "Nc6")
	if !nc6bad.ExcludedSubtree {
		t.Fatal("Nc6 under excluded a4 should inherit ExcludedSubtree")
	}
	if card, ok := findCardOK(rep, CardKey(nc6bad.FEN)); ok {
		t.Errorf("expected no card in the excluded a4 subtree, found %+v", card)
	}
}

func TestBuildRepertoire_AlternateAnswerBothAccepted(t *testing.T) {
	rep := buildDemo(t)
	ch2 := chapterByName(t, rep, "Open, a6 Nc6")
	oo := findChild(t, ch2.Root, "O-O")
	nc6 := findChild(t, oo, "Nc6")

	card := findCard(t, rep, CardKey(nc6.FEN))
	if len(card.Answers) != 2 {
		t.Fatalf("O-O Nc6 card answers = %+v, want 2 (e3 primary, Nc3 alternate)", card.Answers)
	}
	var primary, alt *Answer
	for i := range card.Answers {
		if card.Answers[i].Primary {
			primary = &card.Answers[i]
		} else {
			alt = &card.Answers[i]
		}
	}
	if primary == nil || primary.SAN != "e3" {
		t.Errorf("primary answer = %+v, want e3", primary)
	}
	if alt == nil || alt.SAN != "Nc3" {
		t.Errorf("alternate answer = %+v, want Nc3", alt)
	}
}

func TestBuildRepertoire_ReplyPoolMergesAcrossChapters(t *testing.T) {
	rep := buildDemo(t)
	ch1 := chapterByName(t, rep, "Open, a6 b5")
	oo := findChild(t, ch1.Root, "O-O")
	replies := rep.Replies[CardKey(oo.FEN)]
	if len(replies) != 2 {
		t.Fatalf("replies after O-O = %+v, want exactly {b5, Nc6}", replies)
	}
	sans := map[string]bool{}
	for _, r := range replies {
		sans[r.SAN] = true
	}
	if !sans["b5"] || !sans["Nc6"] {
		t.Errorf("replies after O-O = %+v, want b5 and Nc6", replies)
	}
}

func chapterByName(t *testing.T, rep *Repertoire, name string) *Chapter {
	t.Helper()
	for _, ch := range rep.Chapters {
		if ch.Name == name {
			return ch
		}
	}
	t.Fatalf("no chapter named %q", name)
	return nil
}

func findCard(t *testing.T, rep *Repertoire, id string) *Card {
	t.Helper()
	c, ok := findCardOK(rep, id)
	if !ok {
		t.Fatalf("no card with id %q", id)
	}
	return c
}

func findCardOK(rep *Repertoire, id string) (*Card, bool) {
	for _, c := range rep.Cards {
		if c.ID == id {
			return c, true
		}
	}
	return nil, false
}

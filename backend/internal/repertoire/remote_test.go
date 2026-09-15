package repertoire

import (
	"slices"
	"strings"
	"testing"
)

// These exercise the "refresh" path end to end at the parse/build level
// (ParseAndBuild is exactly what fetchAndSaveRepertoire calls after
// downloading a study's fresh PGN export) — the scenarios a user hits when
// they edit a Lichess study and click "Update": a wholly new chapter
// appearing, an existing line being shortened/lengthened/changed, and one
// broken chapter not silently corrupting the rest of the repertoire.

func singleChapterPGN(chapterName, movetext string) string {
	return `[Event "Test: ` + chapterName + `"]
[ChapterName "` + chapterName + `"]

` + movetext + ` *
`
}

func singleChapterPGNWithFEN(chapterName, fen, movetext string) string {
	return `[Event "Test: ` + chapterName + `"]
[ChapterName "` + chapterName + `"]
[FEN "` + fen + `"]
[SetUp "1"]

` + movetext + ` *
`
}

func multiChapterPGN(chapters map[string]string, order []string) string {
	var sb strings.Builder
	for _, name := range order {
		sb.WriteString(singleChapterPGN(name, chapters[name]))
		sb.WriteString("\n\n")
	}
	return sb.String()
}

func TestParseAndBuild_RefreshPicksUpANewlyAddedChapter(t *testing.T) {
	before := multiChapterPGN(map[string]string{
		"A": "1. d4 d5 2. c4",
	}, []string{"A"})
	rep, err := ParseAndBuild(before, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("initial build: %v", err)
	}
	if len(rep.Chapters) != 1 {
		t.Fatalf("chapters = %d, want 1", len(rep.Chapters))
	}

	// Simulates the user adding a new chapter to the study and clicking
	// "Update" — a full re-fetch + re-parse + re-build, same as a live
	// refresh, not an incremental diff.
	after := multiChapterPGN(map[string]string{
		"A": "1. d4 d5 2. c4",
		"B": "1. e4 e6 2. d4 d5 3. Nc3",
	}, []string{"A", "B"})
	rep2, err := ParseAndBuild(after, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("refreshed build: %v", err)
	}
	if len(rep2.Chapters) != 2 {
		t.Fatalf("chapters after refresh = %d, want 2", len(rep2.Chapters))
	}
	names := map[string]bool{}
	for _, ch := range rep2.Chapters {
		names[ch.Name] = true
	}
	if !names["A"] || !names["B"] {
		t.Fatalf("expected both chapters present, got %v", names)
	}

	// Chapter A's own cards must be unaffected by the sibling addition —
	// same position, same answer.
	var aCardCount, bCardCount int
	for _, c := range rep2.Cards {
		if slices.Contains(c.ChapterIDs, rep2.Chapters[0].ID) {
			aCardCount++
		}
		if slices.Contains(c.ChapterIDs, rep2.Chapters[1].ID) {
			bCardCount++
		}
	}
	if aCardCount == 0 || bCardCount == 0 {
		t.Fatalf("expected cards in both chapters, got A=%d B=%d", aCardCount, bCardCount)
	}
}

func TestParseAndBuild_RefreshShortensAnEditedLine(t *testing.T) {
	// Reproduces exactly what was observed live against the real Catalan
	// study: a chapter's line had an extra trailing move that was later
	// removed upstream. Refreshing must drop the stale move, not keep it
	// around as a leftover card.
	tarraschFEN := "rnbqkbnr/pp3ppp/4p3/2pp4/2PP4/5N2/PP2PPPP/RNBQKB1R w KQkq - 0 1"
	before := singleChapterPGNWithFEN("Tarrasch", tarraschFEN, "1. cxd5 exd5 2. g3 Be7 3. Bg2 Nc6 4. O-O Nf6 5. Nc3 O-O 6. dxc5 Bxc5 7. Bg5")
	rep, err := ParseAndBuild(before, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("initial build: %v", err)
	}
	initialCount := len(rep.Cards)

	after := singleChapterPGNWithFEN("Tarrasch", tarraschFEN, "1. cxd5 exd5 2. g3 Be7 3. Bg2 Nc6 4. O-O Nf6 5. Nc3 O-O 6. dxc5 Bxc5")
	rep2, err := ParseAndBuild(after, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("refreshed build: %v", err)
	}
	if len(rep2.Cards) != initialCount-1 {
		t.Fatalf("cards after shortening = %d, want %d (one fewer)", len(rep2.Cards), initialCount-1)
	}
	for _, c := range rep2.Cards {
		for _, a := range c.Answers {
			if a.SAN == "Bg5" {
				t.Fatalf("stale answer %q from the removed move survived the refresh", a.SAN)
			}
		}
	}
}

func TestParseAndBuild_RefreshUpdatesAChangedAnswer(t *testing.T) {
	// The move itself changes, not just line length — same position, a
	// different recorded answer after the study is edited.
	before := singleChapterPGN("A", "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4")
	rep, err := ParseAndBuild(before, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("initial build: %v", err)
	}
	root := rep.Chapters[0].Root
	if len(root.Children) != 1 || root.Children[0].SAN != "d4" {
		t.Fatalf("unexpected initial tree shape")
	}

	after := singleChapterPGN("A", "1. c4 Nf6 2. Nc3 e6 3. d4 Bb4")
	rep2, err := ParseAndBuild(after, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("refreshed build: %v", err)
	}
	root2 := rep2.Chapters[0].Root
	if len(root2.Children) != 1 || root2.Children[0].SAN != "c4" {
		t.Fatalf("root's move after refresh = %v, want exactly [c4] — the old d4 answer must not linger", root2.Children)
	}
}

func TestParseAndBuild_RefreshAddsANewVariationToAnExistingLine(t *testing.T) {
	before := singleChapterPGN("A", "1. d4 d5 2. c4 e6")
	rep, err := ParseAndBuild(before, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("initial build: %v", err)
	}
	initialCount := len(rep.Cards)

	after := singleChapterPGN("A", "1. d4 d5 2. c4 e6 (2... c6 3. Nf3)")
	rep2, err := ParseAndBuild(after, &Config{ID: "test", Name: "Test", Side: "w"})
	if err != nil {
		t.Fatalf("refreshed build: %v", err)
	}
	if len(rep2.Cards) <= initialCount {
		t.Fatalf("cards after adding a variation = %d, want more than %d", len(rep2.Cards), initialCount)
	}
}

func TestParseAndBuild_OneBrokenChapterFailsTheWholeRefreshRatherThanPartiallyCorrupting(t *testing.T) {
	// A refresh is a full re-fetch + re-parse + re-build, not an
	// incremental per-chapter merge — so a typo'd/illegal move anywhere in
	// the study must fail the whole ParseAndBuild call. This is what makes
	// it safe for fetchAndSaveRepertoire to only persist/replace the saved
	// source AFTER a successful build: a bad edit upstream leaves whatever
	// was last known-good untouched instead of silently dropping just the
	// broken chapter and half-updating everything else.
	good := singleChapterPGN("Good", "1. d4 d5 2. c4")
	broken := singleChapterPGN("Broken", "1. d4 Nz3") // Nz3 is not a legal/parseable move
	combined := good + "\n\n" + broken

	if _, err := ParseAndBuild(combined, &Config{ID: "test", Name: "Test", Side: "w"}); err == nil {
		t.Fatal("expected ParseAndBuild to fail when any one chapter is malformed, got nil error")
	}
}

func TestStudyID(t *testing.T) {
	for _, raw := range []string{
		"https://lichess.org/study/pYmWdR27",
		"https://lichess.org/study/pYmWdR27/KXWPZNBT",
	} {
		id, err := StudyID(raw)
		if err != nil || id != "pYmWdR27" {
			t.Fatalf("StudyID(%q) = %q, %v", raw, id, err)
		}
	}
}

func TestStudyIDRejectsNonStudyURLs(t *testing.T) {
	for _, raw := range []string{"https://example.com/study/pYmWdR27", "https://lichess.org/game/export/pYmWdR27", "https://lichess.org/study/nope"} {
		if _, err := StudyID(raw); err == nil {
			t.Fatalf("StudyID(%q) unexpectedly succeeded", raw)
		}
	}
}

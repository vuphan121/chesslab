package api

import (
	"strconv"
	"testing"

	"github.com/chesslab/backend/internal/db"
)

// Regression test for the bug reported live against a multi-chapter Grunfeld
// repertoire: within a single urgency band, a chapter whose cards all score
// high (e.g. a mainstream system with far more Lichess games than the
// repertoire's other chapters) must not crowd out every other chapter from
// the front of the result. See docs/opening-trainer/daily-training.md.
func TestInterleaveByChapter_DiversifiesAcrossChapters(t *testing.T) {
	band := []todayTrainingCandidate{}
	for i := 0; i < 40; i++ {
		band = append(band, todayTrainingCandidate{
			entry:      dummyEntry("popular", i),
			chapterKey: "rep|popular",
			score:      0.9,
		})
	}
	for i := 0; i < 5; i++ {
		band = append(band, todayTrainingCandidate{
			entry:      dummyEntry("rare", i),
			chapterKey: "rep|rare",
			score:      0.1,
		})
	}

	result := interleaveByChapter(band)
	if len(result) != len(band) {
		t.Fatalf("expected %d results, got %d", len(band), len(result))
	}

	// Taking the front slice the size of a typical linesPerDay setting must
	// include the rare chapter, not just the 40 higher-scoring "popular"
	// cards — that was the actual failure mode.
	const linesPerDay = 10
	seenRare := false
	for _, c := range result[:linesPerDay] {
		if c.chapterKey == "rep|rare" {
			seenRare = true
		}
	}
	if !seenRare {
		t.Fatalf("expected the rare chapter to appear in the first %d picks, got none", linesPerDay)
	}

	// Within the popular chapter's own run, order must still follow score
	// (importance is preserved as the in-chapter ranking signal).
	if result[0].chapterKey != "rep|popular" || result[1].chapterKey != "rep|rare" {
		t.Fatalf("expected round-robin order [popular, rare, ...], got [%s, %s]", result[0].chapterKey, result[1].chapterKey)
	}
}

func dummyEntry(chapter string, i int) db.TodayTrainingEntry {
	return db.TodayTrainingEntry{RepertoireID: "rep", CardID: chapter + "-" + strconv.Itoa(i)}
}

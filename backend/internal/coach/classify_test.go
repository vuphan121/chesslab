package coach

import "testing"

// A gambit: the engine sees a real deficit (mover's win% drops a lot), but the
// resulting position is established theory — the human-facing verdict must be
// Book, not Mistake/Blunder.
func TestGambitNotGradedAsMistake(t *testing.T) {
	// evalBefore ~ +20cp (mover slightly better), evalAfterRaw ~ +150cp from the
	// opponent's perspective (i.e. the mover is now ~150cp worse) — a big win%
	// swing that would eval-grade as Mistake or Blunder.
	mq := classifyByEval(20, 0, 150, 0)
	if !worseThanGood(mq.EngineCategory) {
		t.Fatalf("expected the eval grade to be Inaccuracy-or-worse, got %s (lost %.1f%%)",
			mq.EngineCategory, mq.WinPercentLost)
	}

	mq.applyBookContext(BookEstablished, 4200, "King's Gambit", false)

	if mq.Category != CategoryBook {
		t.Errorf("established gambit: Category = %s, want Book", mq.Category)
	}
	if mq.EngineCategory == CategoryBook {
		t.Errorf("EngineCategory should retain the raw eval grade, got Book")
	}
	if mq.Note == "" {
		t.Error("expected a human-facing note explaining the gambit tradeoff")
	}
}

// A genuinely bad move that is NOT in any book stays a Mistake/Blunder.
func TestBadNoveltyStaysGraded(t *testing.T) {
	mq := classifyByEval(20, 0, 150, 0)
	engineGrade := mq.EngineCategory

	mq.applyBookContext(BookNovelty, 0, "", false)

	if mq.Category != engineGrade {
		t.Errorf("novelty: Category = %s, want the eval grade %s", mq.Category, engineGrade)
	}
	if mq.Category == CategoryBook {
		t.Error("a novelty must never be labeled Book")
	}
}

// A good move that's also established theory keeps its (good) eval grade — the
// Book override only fires when the eval grade is bad.
func TestGoodBookMoveKeepsGrade(t *testing.T) {
	mq := classifyByEval(20, 0, -25, 0) // mover stayed fine / improved
	if worseThanGood(mq.EngineCategory) {
		t.Fatalf("setup: expected a good eval grade, got %s", mq.EngineCategory)
	}

	mq.applyBookContext(BookEstablished, 9000, "Ruy Lopez", false)

	if mq.Category != mq.EngineCategory {
		t.Errorf("good book move: Category = %s, want eval grade %s", mq.Category, mq.EngineCategory)
	}
	if mq.BookStatus != BookEstablished {
		t.Errorf("BookStatus = %s, want established", mq.BookStatus)
	}
}

func TestBookStatusFromGames(t *testing.T) {
	cases := []struct {
		games int
		want  BookStatus
	}{
		{0, BookNovelty},
		{1, BookRare},
		{bookEstablishedGames - 1, BookRare},
		{bookEstablishedGames, BookEstablished},
		{100000, BookEstablished},
	}
	for _, c := range cases {
		if got := bookStatusFromGames(c.games); got != c.want {
			t.Errorf("bookStatusFromGames(%d) = %s, want %s", c.games, got, c.want)
		}
	}
}

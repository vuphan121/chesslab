package coach

import (
	"fmt"
	"math"
)

type MoveCategory string

const (
	CategoryBest       MoveCategory = "Best"
	CategoryExcellent  MoveCategory = "Excellent"
	CategoryGood       MoveCategory = "Good"
	CategoryInaccuracy MoveCategory = "Inaccuracy"
	CategoryMistake    MoveCategory = "Mistake"
	CategoryBlunder    MoveCategory = "Blunder"

	CategoryBook MoveCategory = "Book"
)

type BookStatus string

const (
	BookEstablished BookStatus = "established"

	BookRare BookStatus = "rare"

	BookNovelty BookStatus = "novelty"

	BookUnknown BookStatus = "unknown"
)

const bookEstablishedGames = 25

type MoveQuality struct {
	Category         MoveCategory `json:"category"`
	EngineCategory   MoveCategory `json:"engineCategory"`
	WinPercentBefore float64      `json:"winPercentBefore"`
	WinPercentAfter  float64      `json:"winPercentAfter"`
	WinPercentLost   float64      `json:"winPercentLost"`
	EvalBeforeCp     int          `json:"evalBeforeCp"`
	EvalAfterCp      int          `json:"evalAfterCp"`
	BookStatus       BookStatus   `json:"bookStatus"`
	BookGames        int          `json:"bookGames"`
	OpeningName      string       `json:"openingName,omitempty"`
	InTheoryCorpus   bool         `json:"inTheoryCorpus"`

	Note string `json:"note"`
}

func winPercent(cp, mate int) float64 {
	if mate != 0 {
		if mate > 0 {
			return 100
		}
		return 0
	}
	return 50 + 50*(2/(1+math.Exp(-0.00368208*float64(cp)))-1)
}

func classifyByWinPercentLost(lost float64) MoveCategory {
	switch {
	case lost < 1:
		return CategoryBest
	case lost < 3.5:
		return CategoryExcellent
	case lost < 7:
		return CategoryGood
	case lost < 10:
		return CategoryInaccuracy
	case lost < 20:
		return CategoryMistake
	default:
		return CategoryBlunder
	}
}

func worseThanGood(c MoveCategory) bool {
	return c == CategoryInaccuracy || c == CategoryMistake || c == CategoryBlunder
}

func classifyByEval(evalBeforeCp, mateBefore, evalAfterRawCp, mateAfterRaw int) MoveQuality {
	evalAfterCp := -evalAfterRawCp
	mateAfter := -mateAfterRaw

	wpBefore := winPercent(evalBeforeCp, mateBefore)
	wpAfter := winPercent(evalAfterCp, mateAfter)

	lost := wpBefore - wpAfter
	if lost < 0 {
		lost = 0
	}

	cat := classifyByWinPercentLost(lost)
	return MoveQuality{
		Category:         cat,
		EngineCategory:   cat,
		WinPercentBefore: round1(wpBefore),
		WinPercentAfter:  round1(wpAfter),
		WinPercentLost:   round1(lost),
		EvalBeforeCp:     evalBeforeCp,
		EvalAfterCp:      evalAfterCp,
		BookStatus:       BookUnknown,
	}
}

func (mq *MoveQuality) applyBookContext(status BookStatus, games int, openingName string, inCorpus bool) {
	mq.BookStatus = status
	mq.BookGames = games
	mq.OpeningName = openingName
	mq.InTheoryCorpus = inCorpus

	established := status == BookEstablished || inCorpus
	named := ""
	if openingName != "" {
		named = fmt.Sprintf(" (%s)", openingName)
	}

	switch {
	case established && worseThanGood(mq.EngineCategory):
		mq.Category = CategoryBook
		mq.Note = fmt.Sprintf(
			"Established opening theory%s. The engine's raw eval alone would call this %s, but it's a recognized "+
				"line — if it's a gambit, the deficit is a deliberate trade for development/initiative/attack, not "+
				"an error. Present it as a real, playable choice and briefly say what the trade buys; don't scold "+
				"the eval, and don't cite the game count unless it's genuinely striking.",
			named, mq.EngineCategory)

	case established:
		mq.Note = fmt.Sprintf(
			"A solid, well-known book move%s; the engine agrees. One short sentence is enough — don't cite the "+
				"game count for a move this ordinary.", named)

	case status == BookRare:
		mq.Note = fmt.Sprintf(
			"Rarely played%s but not unheard of — judge it mostly on engine evaluation (%s). Offbeat isn't "+
				"automatically bad; mention it's an uncommon try, but there's little data to lean on.",
			named, mq.EngineCategory)

	case status == BookNovelty:
		mq.Note = fmt.Sprintf(
			"Leaves known theory entirely (a novelty) — no book to lean on, so judge it on the engine evaluation "+
				"(%s). New is not automatically bad; say it's uncharted and let the eval drive the verdict.",
			mq.EngineCategory)

	default:
		mq.Note = fmt.Sprintf(
			"Opening database unavailable, so this is graded on engine evaluation alone (%s). Don't call an "+
				"offbeat-looking move a mistake with high confidence.",
			mq.EngineCategory)
	}
}

func bookStatusFromGames(games int) BookStatus {
	switch {
	case games >= bookEstablishedGames:
		return BookEstablished
	case games > 0:
		return BookRare
	default:
		return BookNovelty
	}
}

func round1(f float64) float64 {
	return math.Round(f*10) / 10
}

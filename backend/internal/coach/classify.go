package coach

import (
	"fmt"
	"math"
)

// MoveCategory is a rule-based move-quality label, modeled on the categories
// chess.com/Lichess show in their post-game review (Best/Excellent/Good/
// Inaccuracy/Mistake/Blunder), plus a Book category that overrides the
// eval-based grade for established opening theory (see BookStatus).
type MoveCategory string

const (
	CategoryBest       MoveCategory = "Best"
	CategoryExcellent  MoveCategory = "Excellent"
	CategoryGood       MoveCategory = "Good"
	CategoryInaccuracy MoveCategory = "Inaccuracy"
	CategoryMistake    MoveCategory = "Mistake"
	CategoryBlunder    MoveCategory = "Blunder"
	// CategoryBook is not an eval grade — it's what a move gets when it's
	// established opening theory whose engine eval looks worse than "Good".
	// This is the gambit case: the engine dislikes the material/eval, but a
	// known line (especially a named gambit) is a deliberate, playable choice,
	// not a human "mistake".
	CategoryBook MoveCategory = "Book"
)

// BookStatus describes how well-known a move is according to the opening
// database (Lichess explorer, rated 2000+) and the curated theory corpus —
// the second axis, alongside engine eval, that a human uses to judge an
// opening move.
type BookStatus string

const (
	// BookEstablished: the resulting position is reached often enough in
	// strong games to count as real theory. A gambit that reaches here is a
	// recognized gambit, not a blunder.
	BookEstablished BookStatus = "established"
	// BookRare: played before but not common — offbeat but not unheard of.
	BookRare BookStatus = "rare"
	// BookNovelty: not in the database at all (0 games). The move has left
	// known theory — uncharted, judged on eval alone, but "new" is not the
	// same as "bad".
	BookNovelty BookStatus = "novelty"
	// BookUnknown: the database couldn't be consulted (e.g. explorer
	// unavailable / no LICHESS_TOKEN). Fall back to the pure eval grade.
	BookUnknown BookStatus = "unknown"
)

// bookEstablishedGames is the game-count threshold (in the rated-2000+
// explorer pool) at/above which a resulting position counts as established
// theory. Heuristic and tunable — set low because the 2000+ filter already
// shrinks the pool, so even offbeat-but-real gambit lines clear it while
// one-off transpositions don't.
const bookEstablishedGames = 25

// MoveQuality is the result of classifying a move. It carries two verdicts on
// purpose: EngineCategory is the pure eval-based grade, and Category is the
// human-facing verdict that reconciles the eval with book knowledge (they
// differ exactly in the gambit/theory case). EvalBeforeCp/EvalAfterCp are
// both from the mover's own perspective, so they're directly comparable.
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
	// Note is a plain-language reconciliation of eval vs. book, written for the
	// LLM to lean on so it frames gambits/novelties correctly for a human.
	Note string `json:"note"`
}

// winPercent converts an engine score to an estimated win probability (0-100)
// using the sigmoid Lichess's analysis code uses to turn centipawns into
// "expected points" (public/open-source formula: winPercent = 50 + 50 *
// (2/(1+e^(-0.00368208*cp)) - 1)). Mate scores map to the extremes.
func winPercent(cp, mate int) float64 {
	if mate != 0 {
		if mate > 0 {
			return 100
		}
		return 0
	}
	return 50 + 50*(2/(1+math.Exp(-0.00368208*float64(cp)))-1)
}

// classifyByWinPercentLost buckets a move by how much win probability it gave
// up relative to the best available continuation. Thresholds are a public
// approximation of chess.com's game-review categories (chess.com's own
// "Expected Points Model" is proprietary and additionally rating-adjusted —
// this is not a reverse-engineered replica, just a reasonable rule-based
// stand-in):
//
//	< 1%    Best         1-3.5%  Excellent    3.5-7%  Good
//	7-10%   Inaccuracy   10-20%  Mistake      >=20%   Blunder
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

// worseThanGood reports whether an eval grade is bad enough that book context
// should be allowed to override it (Inaccuracy or worse).
func worseThanGood(c MoveCategory) bool {
	return c == CategoryInaccuracy || c == CategoryMistake || c == CategoryBlunder
}

// classifyByEval produces the pure eval-based MoveQuality (no book context
// yet — BookStatus is left BookUnknown for the caller to fill in via
// applyBookContext). evalBeforeCp/mateBefore are from the mover's perspective
// (the side to move in the "before" position). evalAfterRawCp/mateAfterRaw
// are raw engine output for the "after" position, which is from the
// *opponent's* perspective (they're now on move) — this negates them so both
// sides of the comparison share the mover's perspective.
func classifyByEval(evalBeforeCp, mateBefore, evalAfterRawCp, mateAfterRaw int) MoveQuality {
	evalAfterCp := -evalAfterRawCp
	mateAfter := -mateAfterRaw

	wpBefore := winPercent(evalBeforeCp, mateBefore)
	wpAfter := winPercent(evalAfterCp, mateAfter)

	lost := wpBefore - wpAfter
	if lost < 0 {
		lost = 0 // the move did at least as well as the pre-move estimate
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

// applyBookContext reconciles the eval grade with opening-database knowledge,
// setting the human-facing Category and Note. This is where a gambit stops
// being a "Mistake": if a move reaches established theory (or the curated
// corpus) but the engine grade is Inaccuracy-or-worse, the final Category
// becomes Book and the Note explains the tradeoff. Novelties (0 games) get a
// note that they've left known theory and are judged on eval alone.
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

	default: // BookUnknown — explorer couldn't be consulted
		mq.Note = fmt.Sprintf(
			"Opening database unavailable, so this is graded on engine evaluation alone (%s). Don't call an "+
				"offbeat-looking move a mistake with high confidence.",
			mq.EngineCategory)
	}
}

// bookStatusFromGames maps a resulting position's rated-game count to a
// BookStatus. Only call this when the explorer lookup actually succeeded — a
// genuine 0 means novelty, whereas an explorer failure should stay
// BookUnknown (handled by the caller, not here).
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

package coach

import (
	"fmt"
	"strings"
)

// LineInput is one engine PV, already resolved to SAN by the caller (mirrors
// api.LineJSON without importing the api package, to avoid an import cycle).
type LineInput struct {
	Score int
	Mate  int
	Moves []string
}

// AnalysisInput is the grounding data the frontend already fetched via
// GET /api/games/{id}/analysis for this position.
type AnalysisInput struct {
	EngineName string
	Depth      int
	Score      int // centipawns, white's perspective
	Mate       int
	Lines      []LineInput
}

// ExplorerMoveInput is one candidate move's stats from the opening explorer.
type ExplorerMoveInput struct {
	SAN      string
	Games    int
	SharePct float64
	WhitePct float64
	DrawPct  float64
	BlackPct float64
}

// ExplorerInput is the grounding data the frontend already fetched via
// GET /api/games/{id}/explorer for this position.
type ExplorerInput struct {
	TotalGames  int
	OpeningName string
	OpeningECO  string
	Moves       []ExplorerMoveInput
}

// ExplainRequest is everything needed to explain the move that was just
// played/navigated to. FEN is the position *after* that move; PrevFEN is the
// position *before* it (empty at the game's start), used to classify the move.
type ExplainRequest struct {
	FEN         string
	PrevFEN     string
	LastMoveSAN string
	Analysis    *AnalysisInput
	Explorer    *ExplorerInput
}

const generalPrinciples = `General chess principles to draw on when book theory doesn't cover a
position: control of the center, piece development and activity, king safety, pawn structure
(weaknesses, majorities, breaks), tempo, and material vs. compensation.`

// gambitPhilosophy is shared by both paths — it's the core "don't scold a real
// gambit" framing the user asked for. Engine eval alone is the wrong yardstick
// for opening theory.
const gambitPhilosophy = `How to judge an opening move like a human, not just an engine:

- Engine evaluation is ONE input, not the verdict. Many legitimate, respected openings — especially
  gambits (King's Gambit, Evans Gambit, Smith-Morra, Danish, Benko, etc.) — deliberately give up a
  pawn or accept a small evaluation dip in exchange for development, initiative, open lines, central
  control, or attacking chances. That trade is the whole point; it is NOT a mistake.
- If a move is established opening theory (played in a meaningful number of strong games, or named as
  a known opening/gambit), do NOT call it an inaccuracy/mistake/blunder just because the engine shows
  a small deficit. Call it what it is — a real, playable book line — and explain what the sacrifice
  or concession buys.
- Only treat an eval drop as a genuine error when the move is NOT established theory. A move that has
  left the opening database entirely (a novelty) is uncharted, not automatically bad — say it's new,
  and let the engine eval guide the assessment there since there's no book to lean on.
- Reserve "mistake"/"blunder" for moves that are both eval-losing AND not backed by real theory.`

const systemPrompt = `You are a chess opening coach explaining moves to an improving club player.

Rules:
- You are NOT a chess engine and must not invent tactical or positional claims. All numeric/tactical
  facts (evaluation, best moves, win rates) are given to you below as ground truth — use them, don't
  recompute or second-guess them.
- If opening-theory excerpts are provided, ground your explanation in them and attribute ideas to
  their source when it adds credibility (e.g. "as Nielsen & Hansen note...").
- If no theory excerpt is provided, explain the move using the engine/explorer data plus general
  principles — say so plainly rather than inventing book knowledge that isn't there.
- Judge the move like a human, not just an engine (see the gambit guidance below): if the explorer
  shows this is a popular/named line, don't frame an eval dip as an error.
- If a move-quality verdict is provided, let it set the tone of your opening sentence (e.g. name it a
  strong book move, a solid choice, an inaccuracy, or — for an established gambit the engine dislikes —
  a playable book sacrifice). Follow its framing guidance; don't contradict it with the raw eval.
- Write 2-4 sentences, coach voice: direct, concrete, no filler, no restating the move in words the
  reader can already see on the board.

` + gambitPhilosophy + `

` + generalPrinciples

// BuildExplainPrompt assembles the system+user prompt for the per-move
// explanation path. chunks may be nil/empty (most positions won't have book
// commentary) and quality may be nil (when the prior position is unknown).
func BuildExplainPrompt(req ExplainRequest, chunks []Chunk, quality *MoveQuality) (system, user string) {
	var b strings.Builder

	fmt.Fprintf(&b, "Position (FEN): %s\n", req.FEN)
	if req.LastMoveSAN != "" {
		fmt.Fprintf(&b, "Move just played: %s\n", req.LastMoveSAN)
	}

	if quality != nil {
		b.WriteString("\nRule-based move-quality verdict for the move just played (trust this over raw eval):\n")
		fmt.Fprintf(&b, "- Verdict: %s (engine-only grade would be %s)\n", quality.Category, quality.EngineCategory)
		fmt.Fprintf(&b, "- Win probability lost: %.1f%% (book status: %s, %d rated games)\n",
			quality.WinPercentLost, quality.BookStatus, quality.BookGames)
		if quality.Note != "" {
			fmt.Fprintf(&b, "- How to frame it: %s\n", quality.Note)
		}
	}

	if req.Analysis != nil {
		a := req.Analysis
		b.WriteString("\nEngine evaluation (white's perspective):\n")
		if a.Mate != 0 {
			fmt.Fprintf(&b, "- Mate in %d\n", a.Mate)
		} else {
			fmt.Fprintf(&b, "- Score: %+d centipawns (depth %d, %s)\n", a.Score, a.Depth, a.EngineName)
		}
		for i, line := range a.Lines {
			if i >= 3 {
				break
			}
			fmt.Fprintf(&b, "- Line %d: %s\n", i+1, strings.Join(line.Moves, " "))
		}
	}

	if req.Explorer != nil && req.Explorer.TotalGames > 0 {
		e := req.Explorer
		fmt.Fprintf(&b, "\nLichess opening explorer (rated 2000+ games, %d total from this position", e.TotalGames)
		if e.OpeningName != "" {
			fmt.Fprintf(&b, ", opening: %s", e.OpeningName)
		}
		b.WriteString("):\n")
		for i, m := range e.Moves {
			if i >= 5 {
				break
			}
			fmt.Fprintf(&b, "- %s: %.0f%% of games, W/D/L %.0f/%.0f/%.0f%%\n",
				m.SAN, m.SharePct, m.WhitePct, m.DrawPct, m.BlackPct)
		}
	}

	if len(chunks) == 0 {
		b.WriteString("\nNo opening-theory excerpt covers this exact position — explain using the data above and general principles.\n")
	} else {
		b.WriteString("\nOpening-theory excerpts covering this exact position:\n")
		for _, c := range chunks {
			fmt.Fprintf(&b, "- (%s, %s): %s\n", c.Source.Title, c.Source.Location, c.CommentaryText)
		}
	}

	return systemPrompt, b.String()
}

package coach

import (
	"fmt"
	"strconv"
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
// ViewerColor ("w"/"b") is which side the human is currently studying from —
// the frontend derives it from the board-flip toggle, so flipping the board
// re-frames whose perspective the coach speaks from. Empty means unknown, in
// which case the coach defaults to the side that actually made the move.
type ExplainRequest struct {
	FEN         string
	PrevFEN     string
	LastMoveSAN string
	ViewerColor string
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
- "You"/"we" always means whichever side you are told below you are coaching — the human's chosen
  viewing side, which may or may not be the side that made the move being explained. Follow the exact
  framing instruction given below for this move: if the mover and the side you're coaching are the
  same, describe the move as something you/we did; if they differ, describe the move in the third
  person by color name (it was the opponent's move) and address any follow-up guidance to the side
  you're coaching.
- If opening-theory excerpts are provided, each is labeled "Author: ... | Book: ... | Location: ...".
  You may credit an idea ONLY to the name in that exact "Author" field. The "Location" field is just
  where the passage sits in the book (e.g. a chapter title) and may itself contain a person's name
  (a chapter of someone's games, a co-author, an opponent) — that name is NEVER who to credit unless
  it is identical to the "Author" field. NEVER name a person, book, or quotation that isn't given to
  you verbatim below. If unsure, state the idea with no attribution at all — that is always safe.
- If no theory excerpt is provided, explain the move using the engine/explorer data plus general
  principles — say so plainly rather than inventing book knowledge that isn't there.
- If no engine evaluation is provided below, do NOT refer to what "the engine" thinks or cite any
  centipawn/eval number — this is intentional for early book moves; explain from theory and general
  principles instead.
- Judge the move like a human, not just an engine (see the gambit guidance below): if the explorer
  shows this is a popular/named line, don't frame an eval dip as an error.
- If a move-quality verdict is provided, let it set the tone of your opening sentence (e.g. name it a
  strong book move, a solid choice, an inaccuracy, or — for an established gambit the engine dislikes —
  a playable book sacrifice). Follow its framing guidance; don't contradict it with the raw eval.

Length and tone — be brief by default:
- A plain, comfortable book move with nothing special going on gets 1 short sentence: name the move's
  quality/idea and stop. Do not add a second sentence just to restate that it's "established theory" or
  "a deliberate plan" in different words.
- Use 2-3 sentences only when there's an actual idea to unpack: a concrete plan, a sacrifice's
  compensation, a tactical point, or a genuine mistake/blunder. Never pad to fill space.
- Do not cite exact game counts, percentages, or win/draw/loss splits unless the number itself is the
  interesting fact (e.g. a rare try, a near-novelty, or a surprisingly lopsided score). For an ordinary
  well-known book move, say "well-known"/"rarely played" in plain words instead of quoting figures.
- Do not quote or name a source unless it adds a concrete point beyond what plain principles already
  say — quoting a source to say "stay consistent with theory" is not worth it.
- Never write meta-commentary about the act of following a plan (e.g. "we're not just reacting, we're
  playing deliberately") — say what the move does, not that a plan exists.
- Coach voice: direct and concrete. Never restate the move in words the reader can already see on the
  board.

` + gambitPhilosophy + `

` + generalPrinciples

// openingEvalPly is the half-move depth through which the coach treats a
// position as "still in the opening". Within it, a not-obviously-bad move gets
// no engine-eval mention (tiny early eval swings are theory/development noise,
// not something to quote at the player). See showEngineEval.
const openingEvalPly = 10

// isSeriousError reports whether a move-quality verdict is bad enough to be
// worth citing the engine eval for even in the opening (a real Mistake/Blunder).
func isSeriousError(c MoveCategory) bool {
	return c == CategoryMistake || c == CategoryBlunder
}

// moverAndPly derives, from the FEN of the position *after* a move, which color
// made that move and the half-move (ply) count. The FEN's side-to-move field is
// the player now on move (the opponent of the mover); the fullmove number plus
// that field give the ply. Returns ("", 0) if the FEN can't be parsed.
func moverAndPly(fen string) (mover string, ply int) {
	fields := strings.Fields(fen)
	if len(fields) < 6 {
		return "", 0
	}
	fullMove, err := strconv.Atoi(fields[5])
	if err != nil || fullMove < 1 {
		return "", 0
	}
	switch fields[1] {
	case "w": // black is on move now, so black just moved
		return "Black", (fullMove - 1) * 2
	case "b": // white is on move now, so white just moved
		return "White", (fullMove-1)*2 + 1
	}
	return "", 0
}

// viewerName maps a "w"/"b" viewer-color field (which side the human is
// currently studying from, sent by the frontend based on board orientation)
// to a display name. Empty/unrecognized input returns "".
func viewerName(color string) string {
	switch color {
	case "w":
		return "White"
	case "b":
		return "Black"
	default:
		return ""
	}
}

// perspectiveLine builds the per-request instruction telling the model whose
// side "you/we" refers to. viewerColor is the human's chosen viewing side; if
// unset, the viewer defaults to the mover (preserving the plain "explain from
// whoever moved" behavior for callers that don't track a flip state, e.g. an
// older frontend build or a future non-board caller).
func perspectiveLine(mover, viewerColor string) string {
	if mover == "" {
		return ""
	}
	viewer := viewerName(viewerColor)
	if viewer == "" {
		viewer = mover
	}
	if viewer == mover {
		return fmt.Sprintf("You are coaching %s. This move was played by %s (the same side) — describe it as something you/we did.\n", viewer, mover)
	}
	return fmt.Sprintf(
		"You are coaching %s. This move was just played by %s (the OTHER side) — describe %s's move in the "+
			"third person by name (e.g. \"%s played...\"). It is now %s's turn to move, but %s has NOT moved yet: "+
			"do NOT invent, name, or narrate any move for %s as if it already happened. Only give forward-looking "+
			"ideas or plans for %s to consider, phrased as suggestions (e.g. \"you could look to challenge the "+
			"center\"), never as something already done.\n",
		viewer, mover, mover, mover, viewer, viewer, viewer, viewer)
}

// showEngineEval gates whether the engine evaluation is put in front of the
// model at all. Past the opening it's always shown; inside the opening it's
// suppressed unless the move is a genuine Mistake/Blunder — so early book moves
// don't get narrated with "+0.3, the engine slightly prefers...". An unparseable
// ply (0) is treated as "not in the opening" so we never over-suppress.
func showEngineEval(ply int, quality *MoveQuality) bool {
	if ply <= 0 || ply > openingEvalPly {
		return true
	}
	return quality != nil && isSeriousError(quality.Category)
}

// BuildExplainPrompt assembles the system+user prompt for the per-move
// explanation path. chunks may be nil/empty (most positions won't have book
// commentary) and quality may be nil (when the prior position is unknown).
func BuildExplainPrompt(req ExplainRequest, chunks []Chunk, quality *MoveQuality) (system, user string) {
	var b strings.Builder

	mover, ply := moverAndPly(req.FEN)
	showEval := showEngineEval(ply, quality)

	fmt.Fprintf(&b, "Position (FEN): %s\n", req.FEN)
	if req.LastMoveSAN != "" {
		fmt.Fprintf(&b, "Move just played: %s\n", req.LastMoveSAN)
	}
	if req.LastMoveSAN != "" {
		b.WriteString(perspectiveLine(mover, req.ViewerColor))
	}

	if quality != nil {
		b.WriteString("\nRule-based move-quality verdict for the move just played (trust this over raw eval):\n")
		fmt.Fprintf(&b, "- Verdict: %s (engine-only grade would be %s)\n", quality.Category, quality.EngineCategory)
		if showEval {
			fmt.Fprintf(&b, "- Win probability lost: %.1f%% (book status: %s, %d rated games)\n",
				quality.WinPercentLost, quality.BookStatus, quality.BookGames)
		} else {
			// In the opening for a fine move, keep the book grounding but omit the
			// win% number so the model has no eval figure to parrot.
			fmt.Fprintf(&b, "- Book status: %s (%d rated games)\n", quality.BookStatus, quality.BookGames)
		}
		if quality.Note != "" {
			fmt.Fprintf(&b, "- How to frame it: %s\n", quality.Note)
		}
	}

	if req.Analysis != nil && showEval {
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
			fmt.Fprintf(&b, "- Author: %s | Book: %s | Location: %s\n  Commentary: %s\n",
				c.Source.Author, c.Source.Title, c.Source.Location, c.CommentaryText)
		}
	}

	return systemPrompt, b.String()
}

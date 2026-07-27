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

Output format: your entire response is the explanation itself, shown directly to the player. Never
add a "Note:", a parenthetical aside, or any other meta-commentary about which rule you followed, how
you phrased something, or why you wrote it the way you did — that is for you only, never for output.
If you catch yourself about to explain your own phrasing choice, delete it instead.

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
  Use them as your OWN knowledge of the position — never name the book title, the author, or any other
  person in your explanation. No "as [Author] notes", no "according to [Book]", not even in passing.
  State the idea itself, unattributed, every time. (The labels are for you to tell a real idea from an
  unrelated name sitting next to it — e.g. a "Location" chapter title naming someone who isn't the
  source — not something to surface to the reader.)
- If no theory excerpt is provided, explain the move using the engine/explorer data plus general
  principles — say so plainly rather than inventing book knowledge that isn't there.
- If instead you're given "nearby" theory (positions a few moves ahead, via the same continuation,
  that the corpus covers, even though this exact position isn't itself annotated), you may mention
  that the game can transpose toward that known line — but that commentary describes a LATER
  position, not this one. Never present it as being about the move just played, never quote it as if
  it explains the current move's own idea, and never describe any of those further-ahead moves as
  already played — they haven't happened yet.
- If no engine SCORE is provided below (early book move), do NOT refer to what "the engine" thinks or
  cite any centipawn/eval number. You may still be given an "Expected continuation" — the engine's own
  predicted moves, each explicitly labeled "White: ..." / "Black: ..." — that IS legitimate ground
  truth for what happens next (e.g. "White recaptures the pawn, then plays c4"). Trust the label on
  each move for whose move it is; do not re-derive it yourself by counting alternation, and never
  attach a number or the word "engine" to it.
- Judge the move like a human, not just an engine (see the gambit guidance below): if the explorer
  shows this is a popular/named line, don't frame an eval dip as an error.
- If a move-quality verdict is provided, let it set the tone of your opening sentence (e.g. name it a
  strong book move, a solid choice, an inaccuracy, or — for an established gambit the engine dislikes —
  a playable book sacrifice). Follow its framing guidance; don't contradict it with the raw eval.

Length and tone — be brief, but never at the cost of the actual point:
- If a theory excerpt or explorer data gives a concrete reason for the move — what it stops, prepares,
  fights for, or transposes to, not just "it's known theory" — say that reason plainly in a second
  sentence. That reason is the entire value of grounding this in a real book; dropping it to save a
  sentence is wrong.
- The reason you state must be a paraphrase of what's ACTUALLY in the commentary below — not a
  rewrite, not an upgrade, not a plausible-sounding addition. Every specific claim in your explanation
  (a plan, a target square, a pawn break like "a future ...b5 push", "prepares to develop the
  queenside", anything else concrete) must trace back to something stated in the theory excerpt,
  engine lines, or explorer data. If you can't point to where a claim came from in the data below,
  cut it — do not add it just because it sounds plausible for the opening in general. If the given
  reason is strategic/practical rather than a crisp tactical point (e.g. "declines a gambit whose
  soundness is unclear; transposes into a structure we already know how to play"), say exactly that
  plainly — a real but modest reason beats a fabricated specific-sounding one, and a fabricated one
  can flatly contradict the eval/win% you were also given (e.g. calling a move that LOST win
  probability something that "strengthens" the position).
- The word "gambit" — and the decline/accept framing — belongs ONLY on a position that IS a gambit:
  material is actually being offered or given back somewhere in the line, and the theory
  excerpt/verdict below actually says so. Most opening moves are not a gambit at all. If the given
  commentary describes DECLINING a gambit (giving back extra material to sidestep a sharp or unclear
  line) or ACCEPTING one, say so explicitly — that's the single most important thing to state, don't
  bury it under generic "solid book move" framing. But if nothing below mentions a gambit, DO NOT use
  the word "gambit" or "decline"/"accept" framing at all — reaching for that phrasing out of habit
  when it isn't actually a gambit is a fabrication just like inventing any other fact.
- If an "Expected continuation" is given below, your explanation MUST include its first labeled move
  as a concrete fact — e.g. "White recaptures with Bxd3" — using the exact color label given, not one
  you infer. This is not optional flavor; a reader asking "what happens next" wants that answer, and
  it's real data you were handed, not a guess.
- If there truly is no concrete reason available (no theory excerpt, nothing beyond "this is normal"),
  1 short sentence is enough: name the move's quality and stop.
- Either way, never add a sentence or clause that just restates the same verdict in different words
  (e.g. "...and fits into the standard setup" tacked onto "a solid, well-known book move" says nothing
  new — cut it).
- Use up to 3 sentences only when there's real substance to unpack: a concrete plan, a sacrifice's
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
// formatContinuation renders an engine PV as an explicitly color-labeled,
// capped sequence ("White: Bxd3, Black: Nc6, White: c4, Black: e6") instead
// of a bare space-separated SAN string. A bare list forces the model to
// track whose move is whose by counting alternation, which it does
// unreliably in practice (observed live: given "Bxd3 Nc6 c4 e6..." it
// described the position's own move as "stopping" c4 — the very next move
// in that same list, played by the opponent). Labeling every move removes
// that failure mode structurally instead of just telling the model not to
// make it. sideToMoveFEN is the "w"/"b" field of the FEN the line starts
// from; capPlies bounds how many moves are shown (deep lines are noise and
// more surface area to misread, not more useful signal).
func formatContinuation(moves []string, sideToMoveFEN string, capPlies int) string {
	color := "White"
	if sideToMoveFEN == "b" {
		color = "Black"
	}
	parts := make([]string, 0, capPlies)
	for i, m := range moves {
		if i >= capPlies {
			break
		}
		parts = append(parts, fmt.Sprintf("%s: %s", color, m))
		if color == "White" {
			color = "Black"
		} else {
			color = "White"
		}
	}
	return strings.Join(parts, ", ")
}

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
// explanation path. theory may be entirely empty (most positions won't have
// book commentary, exact or nearby) and quality may be nil (when the prior
// position is unknown).
func BuildExplainPrompt(req ExplainRequest, theory LookupResult, quality *MoveQuality) (system, user string) {
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

	if req.Analysis != nil {
		a := req.Analysis
		if showEval {
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
		} else if len(a.Lines) > 0 && len(a.Lines[0].Moves) > 0 {
			// Numeric eval is suppressed this early, but the engine's own predicted
			// continuation is still real ground truth for "what happens next" — just
			// with no score/depth/engine-name attached to parrot. Color-labeled and
			// capped — see formatContinuation.
			stm := "w"
			if fields := strings.Fields(req.FEN); len(fields) > 1 {
				stm = fields[1]
			}
			fmt.Fprintf(&b, "\nExpected continuation (no score — early book position; each move is "+
				"labeled with whose move it is, use that label, don't count alternation yourself): %s\n",
				formatContinuation(a.Lines[0].Moves, stm, 4))
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

	switch {
	case len(theory.Exact) > 0:
		b.WriteString("\nOpening-theory excerpts covering this exact position:\n")
		for _, c := range theory.Exact {
			fmt.Fprintf(&b, "- Author: %s | Book: %s | Location: %s\n  Commentary: %s\n",
				c.Source.Author, c.Source.Title, c.Source.Location, c.CommentaryText)
		}
	case len(theory.Prefix) > 0:
		b.WriteString("\nNo excerpt covers this EXACT position, but it continues (via the same moves) into " +
			"position(s) the corpus does cover — use these only as \"this can transpose toward known theory\" " +
			"context, not as commentary on the move just played:\n")
		for _, m := range theory.Prefix {
			c := m.Chunk
			fmt.Fprintf(&b, "- %d ply ahead | Author: %s | Book: %s | Location: %s\n  Commentary (about that LATER position): %s\n",
				m.PliesAhead, c.Source.Author, c.Source.Title, c.Source.Location, c.CommentaryText)
		}
	default:
		b.WriteString("\nNo opening-theory excerpt covers this exact position — explain using the data above and general principles.\n")
	}

	return systemPrompt, b.String()
}

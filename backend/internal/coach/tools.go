package coach

import (
	"fmt"
	"strings"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/lichess"
)

// PositionEval is a normalized analysis result — Lichess cloud eval and local
// Stockfish both report raw score/mate from the perspective of the side to
// move in the analyzed FEN; this just picks whichever source answered.
type PositionEval struct {
	EngineName string
	Depth      int
	Score      int // centipawns, side-to-move perspective
	Mate       int
	Lines      []LineInput
}

// Tools bundles the dependencies the coach agent's tool calls need: an engine
// for on-demand analysis, the move-theory index (keyed by FEN), and the
// opening-overview index (natural-language queried). (The opening explorer
// needs no dependency — lichess.FetchExplorer reads LICHESS_TOKEN itself.)
type Tools struct {
	Engine   *engine.Engine
	Index    *Index
	Overview *OverviewIndex
}

// NewTools bundles the coach's shared dependencies, used by both the per-move
// Service (Path 1) and the freeform Agent (Path 2).
func NewTools(eng *engine.Engine, index *Index, overview *OverviewIndex) *Tools {
	return &Tools{Engine: eng, Index: index, Overview: overview}
}

// AnalyzePosition tries Lichess's cached cloud eval first (fast, no local
// engine needed), falling back to local Stockfish — same policy as
// api.AnalyzeGame, just keyed by an arbitrary FEN instead of a stored game's
// current position.
func (t *Tools) AnalyzePosition(fen string) (*PositionEval, error) {
	if cloud, err := lichess.Fetch(fen, 3); err == nil && cloud != nil {
		pos, perr := chess.ParseFEN(fen)
		// Lichess cloud eval reports cp/mate White-relative, but PositionEval's
		// contract (and classifyByEval, which consumes it) is side-to-move
		// relative — matching the local Stockfish path below. So negate when
		// Black is to move to convert White-relative → side-to-move.
		flip := perr == nil && pos.Turn == chess.Black
		result := &PositionEval{EngineName: "Lichess Cloud", Depth: cloud.Depth}
		for i, pv := range cloud.PVs {
			score, mate := 0, 0
			if pv.CP != nil {
				score = *pv.CP
			}
			if pv.Mate != nil {
				mate = *pv.Mate
			}
			if flip {
				score, mate = -score, -mate
			}
			var sans []string
			if perr == nil {
				sans, _ = chess.MovesToSANAndFENs(pos, strings.Fields(pv.Moves))
			}
			if i == 0 {
				result.Score = score
				result.Mate = mate
			}
			result.Lines = append(result.Lines, LineInput{Score: score, Mate: mate, Moves: sans})
		}
		return result, nil
	}

	if t.Engine == nil {
		return nil, fmt.Errorf("no engine configured and lichess cloud eval unavailable for this position")
	}
	raw, err := t.Engine.Analyze(fen, 3, 18)
	if err != nil {
		return nil, fmt.Errorf("stockfish analysis failed: %w", err)
	}
	pos, perr := chess.ParseFEN(fen)
	result := &PositionEval{EngineName: t.Engine.Name}
	for i, l := range raw.Lines {
		var sans []string
		if perr == nil {
			sans, _ = chess.MovesToSANAndFENs(pos, l.Moves)
		}
		if i == 0 {
			result.Score = l.Score
			result.Mate = l.Mate
			result.Depth = l.Depth
		}
		result.Lines = append(result.Lines, LineInput{Score: l.Score, Mate: l.Mate, Moves: sans})
	}
	return result, nil
}

// ExplorerStats wraps the Lichess opening-explorer lookup for an arbitrary FEN.
func (t *Tools) ExplorerStats(fen string) (*lichess.ExplorerResponse, error) {
	return lichess.FetchExplorer(fen)
}

// RetrieveTheory looks up curated opening-theory for a FEN — an exact hit if
// the corpus covers this precise position, otherwise nearby "transposes
// toward known theory" hints. See Index.Lookup.
func (t *Tools) RetrieveTheory(fen string) LookupResult {
	if t.Index == nil {
		return LookupResult{}
	}
	return t.Index.Lookup(fen)
}

// overviewResultLimit caps how many opening-context passages a single
// retrieval returns, to keep the prompt focused.
const overviewResultLimit = 4

// RetrieveOpeningContext searches the opening-overview corpus (introductions,
// philosophy, typical plans) by free-text query — used for general "tell me
// about this opening" questions, not position-specific ones.
func (t *Tools) RetrieveOpeningContext(query string) []OverviewChunk {
	if t.Overview == nil {
		return nil
	}
	return t.Overview.Search(query, overviewResultLimit)
}

// ClassifyMove runs the two analyses a move-quality judgment needs (before
// and after the move), grades it by engine win-probability swing, then layers
// in opening-book context so established theory (especially gambits) isn't
// mislabeled a mistake and novelties are flagged as uncharted. See
// classify.go for the win-probability model, thresholds, and book rules.
func (t *Tools) ClassifyMove(fenBefore, fenAfter string) (MoveQuality, error) {
	before, err := t.AnalyzePosition(fenBefore)
	if err != nil {
		return MoveQuality{}, fmt.Errorf("analyzing position before move: %w", err)
	}
	after, err := t.AnalyzePosition(fenAfter)
	if err != nil {
		return MoveQuality{}, fmt.Errorf("analyzing position after move: %w", err)
	}

	return t.classifyWithBook(fenBefore, fenAfter, before, after)
}

// classifyWithBook grades an already-analyzed before/after pair and layers in
// the opening-book context. Shared by ClassifyMove and EvaluateMove.
func (t *Tools) classifyWithBook(fenBefore, fenAfter string, before, after *PositionEval) (MoveQuality, error) {
	mq := classifyByEval(before.Score, before.Mate, after.Score, after.Mate)

	// Book context: how well-known is the position the move reaches? Explorer
	// game count is the general signal (covers all openings/gambits); the
	// curated corpus is a secondary "we have book coverage" flag. An explorer
	// failure leaves BookUnknown so we don't mislabel a real line a novelty.
	status, games, openingName := BookUnknown, 0, ""
	if exp, expErr := t.ExplorerStats(fenAfter); expErr == nil && exp != nil {
		games = exp.White + exp.Draws + exp.Black
		if exp.Opening != nil {
			openingName = exp.Opening.Name
		}
		status = bookStatusFromGames(games)
	}
	inCorpus := len(t.RetrieveTheory(fenAfter).Exact) > 0
	mq.applyBookContext(status, games, openingName, inCorpus)

	return mq, nil
}

// EvaluateMoveResult is what evaluate_move reports for a candidate move a user
// named from a given position ("can I play Nf3 here?").
type EvaluateMoveResult struct {
	Requested    string       `json:"requested"`
	Legal        bool         `json:"legal"`
	Move         string       `json:"move,omitempty"` // canonical SAN, if legal
	UCI          string       `json:"uci,omitempty"`
	ResultingFEN string       `json:"resultingFen,omitempty"`
	Quality      *MoveQuality `json:"quality,omitempty"` // omitted if analysis failed
	Note         string       `json:"note,omitempty"`
}

// EvaluateMove applies a user-named move (SAN like "Nf3"/"O-O" or UCI like
// "g1f3") to a position using the Go engine as the authority on legality, then
// returns the resulting position and a book-aware quality verdict. This is how
// the agent answers "from this position, can I play X?" — the LLM can't be
// trusted to compute the resulting FEN itself, so it delegates to the engine.
func (t *Tools) EvaluateMove(fen, moveStr string) (EvaluateMoveResult, error) {
	res := EvaluateMoveResult{Requested: moveStr}

	pos, err := chess.ParseFEN(fen)
	if err != nil {
		return res, fmt.Errorf("invalid fen: %w", err)
	}

	want := normalizeMoveToken(moveStr)
	if want == "" {
		return res, fmt.Errorf("no move given")
	}

	for _, m := range chess.GenerateLegalMoves(pos) {
		uci := moveUCI(m)
		san := chess.SAN(pos, m)
		if strings.EqualFold(uci, want) || strings.EqualFold(normalizeMoveToken(san), want) {
			res.Legal = true
			res.Move = san
			res.UCI = uci
			_, fens := chess.MovesToSANAndFENs(pos, []string{uci})
			if len(fens) > 0 {
				res.ResultingFEN = fens[0]
				if q, cerr := t.ClassifyMove(fen, res.ResultingFEN); cerr == nil {
					res.Quality = &q
				} else {
					res.Note = "resulting position found, but analysis was unavailable to grade it"
				}
			}
			return res, nil
		}
	}

	res.Note = "not a legal move in this position"
	return res, nil
}

// moveUCI renders a move as lowercase from+to (+ promotion piece), e.g.
// "g1f3", "e7e8q".
func moveUCI(m chess.Move) string {
	uci := m.From.String() + m.To.String()
	if m.IsPromotion() {
		uci += m.PromotionPiece().String()
	}
	return uci
}

// normalizeMoveToken strips SAN decorations (check/mate marks, "!"/"?"
// annotations) and normalizes castling to the letter-O form, so a user's
// "Nf3!", "0-0", or "Nf3+" all compare cleanly against generated SANs/UCIs.
func normalizeMoveToken(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "+#!?")
	s = strings.ReplaceAll(s, "0-0-0", "O-O-O")
	s = strings.ReplaceAll(s, "0-0", "O-O")
	return s
}

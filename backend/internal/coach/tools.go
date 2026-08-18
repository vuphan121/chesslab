package coach

import (
	"fmt"
	"strings"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/lichess"
)

type PositionEval struct {
	EngineName string
	Depth      int
	Score      int
	Mate       int
	Lines      []LineInput
}

type Tools struct {
	Engine   *engine.Engine
	Index    *Index
	Overview *OverviewIndex
}

func NewTools(eng *engine.Engine, index *Index, overview *OverviewIndex) *Tools {
	return &Tools{Engine: eng, Index: index, Overview: overview}
}

func (t *Tools) AnalyzePosition(fen string) (*PositionEval, error) {
	if cloud, err := lichess.Fetch(fen, 3); err == nil && cloud != nil {
		pos, perr := chess.ParseFEN(fen)

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

func (t *Tools) ExplorerStats(fen string) (*lichess.ExplorerResponse, error) {
	return lichess.FetchExplorer(fen)
}

func (t *Tools) RetrieveTheory(fen string) LookupResult {
	if t.Index == nil {
		return LookupResult{}
	}
	return t.Index.Lookup(fen)
}

const overviewResultLimit = 4

func (t *Tools) RetrieveOpeningContext(query string) []OverviewChunk {
	if t.Overview == nil {
		return nil
	}
	return t.Overview.Search(query, overviewResultLimit)
}

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

func (t *Tools) classifyWithBook(fenBefore, fenAfter string, before, after *PositionEval) (MoveQuality, error) {
	mq := classifyByEval(before.Score, before.Mate, after.Score, after.Mate)

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

type EvaluateMoveResult struct {
	Requested    string       `json:"requested"`
	Legal        bool         `json:"legal"`
	Move         string       `json:"move,omitempty"`
	UCI          string       `json:"uci,omitempty"`
	ResultingFEN string       `json:"resultingFen,omitempty"`
	Quality      *MoveQuality `json:"quality,omitempty"`
	Note         string       `json:"note,omitempty"`
}

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

func moveUCI(m chess.Move) string {
	uci := m.From.String() + m.To.String()
	if m.IsPromotion() {
		uci += m.PromotionPiece().String()
	}
	return uci
}

func normalizeMoveToken(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "+#!?")
	s = strings.ReplaceAll(s, "0-0-0", "O-O-O")
	s = strings.ReplaceAll(s, "0-0", "O-O")
	return s
}

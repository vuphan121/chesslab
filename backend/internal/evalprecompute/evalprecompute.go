package evalprecompute

import (
	"fmt"
	"strings"
	"time"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/engine"
	"github.com/chesslab/backend/internal/lichess"
	"github.com/chesslab/backend/internal/repertoire"
)

const (
	MultiPV        = 5
	StockfishDepth = 22
	cloudTimeout   = 3 * time.Second
)

const CronStockfishMoveTime = 3 * time.Minute

func EnumeratePositions(reps []*repertoire.Repertoire) []string {
	seen := make(map[string]bool)
	var out []string
	for _, rep := range reps {
		for _, ch := range rep.Chapters {
			walk(ch.Root, seen, &out)
		}
	}
	return out
}

func walk(n *repertoire.Node, seen map[string]bool, out *[]string) {
	if n == nil || n.ExcludedSubtree {
		return
	}
	key := repertoire.CardKey(n.FEN)
	if !seen[key] {
		seen[key] = true
		*out = append(*out, key)
	}
	for _, c := range n.Children {
		walk(c, seen, out)
	}
}

func Compute(eng *engine.Engine, fenKey string) (db.PositionEval, error) {
	return ComputeWithMoveTime(eng, fenKey, 0)
}

func ComputeWithMoveTime(eng *engine.Engine, fenKey string, moveTime time.Duration) (db.PositionEval, error) {
	return ComputeWithProvider(func() *engine.Engine { return eng }, fenKey, moveTime)
}

func ComputeWithProvider(engineFor func() *engine.Engine, fenKey string, moveTime time.Duration) (db.PositionEval, error) {
	fen := fenKey
	if len(strings.Fields(fenKey)) == 4 {
		fen = fenKey + " 0 1"
	}
	pos, err := chess.ParseFEN(fen)
	if err != nil {
		return db.PositionEval{}, fmt.Errorf("parse fen %q: %w", fen, err)
	}

	if probe, perr := chess.NewGameFromFEN("", fen); perr == nil && probe.IsGameOver() {
		return db.PositionEval{FENKey: fenKey}, nil
	}

	if cloud, cerr := lichess.FetchWithTimeout(fen, MultiPV, cloudTimeout); cerr == nil && cloud != nil && len(cloud.PVs) > 0 {
		return fromCloud(fenKey, pos, cloud), nil
	}

	eng := engineFor()
	if eng == nil {
		return db.PositionEval{}, fmt.Errorf("no cloud eval cached and no local engine available for %q", fen)
	}
	raw, err := eng.AnalyzeTimed(fen, MultiPV, StockfishDepth, moveTime)
	if err != nil {
		return db.PositionEval{}, fmt.Errorf("stockfish analyze: %w", err)
	}
	return fromStockfish(fenKey, pos, raw), nil
}

func fromCloud(fenKey string, pos *chess.Position, cloud *lichess.CloudEval) db.PositionEval {
	out := db.PositionEval{FENKey: fenKey, Depth: cloud.Depth, EngineName: "Lichess Cloud"}
	for i, pv := range cloud.PVs {
		if i >= MultiPV {
			break
		}
		moves := strings.Fields(pv.Moves)
		if len(moves) == 0 {
			continue
		}
		score, mate := 0, 0
		if pv.CP != nil {
			score = *pv.CP
		}
		if pv.Mate != nil {
			mate = *pv.Mate
		}
		if i == 0 {
			out.Score, out.Mate = score, mate
		}
		out.BestMoves = append(out.BestMoves, db.PositionEvalMove{
			Rank: i + 1, SAN: firstSAN(pos, moves[0]), UCI: moves[0], Score: score, Mate: mate,
		})
	}
	return out
}

func fromStockfish(fenKey string, pos *chess.Position, raw *engine.Analysis) db.PositionEval {
	flip := pos.Turn == chess.Black
	out := db.PositionEval{FENKey: fenKey, EngineName: "Stockfish"}
	for i, l := range raw.Lines {
		if i >= MultiPV || len(l.Moves) == 0 {
			continue
		}
		score, mate := l.Score, l.Mate
		if flip {
			score, mate = -score, -mate
		}
		if i == 0 {
			out.Score, out.Mate, out.Depth = score, mate, l.Depth
		}
		out.BestMoves = append(out.BestMoves, db.PositionEvalMove{
			Rank: i + 1, SAN: firstSAN(pos, l.Moves[0]), UCI: l.Moves[0], Score: score, Mate: mate,
		})
	}
	return out
}

func firstSAN(pos *chess.Position, uci string) string {
	sans := chess.MovesToSAN(pos, []string{uci})
	if len(sans) == 0 {
		return ""
	}
	return sans[0]
}

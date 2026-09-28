// Package evalprecompute walks every opening-trainer repertoire's move
// trees and computes a deep, MultiPV engine eval for every distinct
// position — shared by the one-off cmd/precomputeevals backfill CLI and the
// recurring POST /api/cron/precompute-evals endpoint (internal/api/
// cron_handler.go), same split as repertoire.ParseAndBuild being shared by
// cmd/seedrepertoires and the import/refresh HTTP handlers.
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

// MultiPV/StockfishDepth mirror analyzePosition's "full" live-analysis pass
// but deeper — this runs offline, so it isn't latency-bound the way a live
// /analysis request is.
const (
	MultiPV        = 5
	StockfishDepth = 22
	cloudTimeout   = 3 * time.Second
)

// CronStockfishMoveTime caps how long the recurring cron endpoint spends on
// one Stockfish-fallback position. The search still stops as soon as it hits
// StockfishDepth, so this is only a ceiling for a slow machine: the small
// shared-CPU production instance needs well over 30s (the engine's default
// hard timeout, which made every fallback fail) to reach depth 22 with 5
// lines. Deliberately generous — the cron is meant to be a slow, patient
// backlog drain, not fast. If a search does hit the cap it stops cleanly and
// the row records the depth actually reached. The one-off
// cmd/precomputeevals backfill passes 0 (depth-only).
const CronStockfishMoveTime = 3 * time.Minute

// EnumeratePositions walks every chapter's full node tree — not just Card
// (decision-point) positions — so every ply of every line gets an eval: the
// trainer's line-complete eval bar/suggestion arrows need to work
// step-by-step through a finished line, including the opponent's replies,
// not just at the positions where the user has to answer. Excluded
// subtrees are skipped (ExcludedSubtree already covers both the excluded
// move itself and everything beneath it, mirroring repertoire.build.go's
// "no cards generated anywhere inside an excluded line"). Returns distinct
// CardKey-normalized FENs, deduped across every repertoire/chapter — a
// position shared by two repertoires is only computed once.
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

// Compute evaluates one position: Lichess cloud-eval first (already
// White-relative, already MultiPV-capable via lichess.Fetch, and real
// repertoire positions — sourced from Lichess studies — are likely to
// already be cached there), falling back to local Stockfish. eng may be
// nil (Stockfish unavailable) — a cloud miss then just fails outright for
// that position rather than fabricating a result, same "degrade, don't
// fake it" stance as the rest of this app.
//
// Normalizes to White-relative using the exact same flip rule
// analyzePosition (internal/api/handlers.go) already applies to Stockfish
// output, so this table's convention matches every other eval surface —
// see root CLAUDE.md's "Eval sign convention" for why getting this
// backwards is a real, easy-to-reintroduce bug.
func Compute(eng *engine.Engine, fenKey string) (db.PositionEval, error) {
	return ComputeWithMoveTime(eng, fenKey, 0)
}

// ComputeWithMoveTime is Compute with a per-position wall-clock cap on the
// Stockfish fallback (see CronStockfishMoveTime). moveTime <= 0 = uncapped.
func ComputeWithMoveTime(eng *engine.Engine, fenKey string, moveTime time.Duration) (db.PositionEval, error) {
	// fenKey is CardKey(fen) — missing the halfmove/fullmove fields.
	// ParseFEN needs a complete FEN; the padding values never affect
	// legality or analysis, only move-count bookkeeping this call ignores.
	fen := fenKey
	if len(strings.Fields(fenKey)) == 4 {
		fen = fenKey + " 0 1"
	}
	pos, err := chess.ParseFEN(fen)
	if err != nil {
		return db.PositionEval{}, fmt.Errorf("parse fen %q: %w", fen, err)
	}

	// A finished-game position (checkmate/stalemate) has no "next move" to
	// suggest — same guard analyzePosition/EvalFEN already apply live.
	if probe, perr := chess.NewGameFromFEN("", fen); perr == nil && probe.IsGameOver() {
		return db.PositionEval{FENKey: fenKey}, nil
	}

	if cloud, cerr := lichess.FetchWithTimeout(fen, MultiPV, cloudTimeout); cerr == nil && cloud != nil && len(cloud.PVs) > 0 {
		return fromCloud(fenKey, pos, cloud), nil
	}

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

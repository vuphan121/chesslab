import { Chess, type Square } from 'chess.js'
import type { Analysis, AnalysisLine } from '@/lib/api/client'
import type { UciInfo } from './uci'

export const BROWSER_ENGINE_NAME = 'Stockfish 19 Lite (browser)'

function castlingToKingMove(game: Chess, uci: string): string {
  const king = game.get(uci.slice(0, 2) as Square)
  const target = game.get(uci.slice(2, 4) as Square)
  if (uci.length !== 4 || king?.type !== 'k' || target?.type !== 'r' || target.color !== king.color) return uci
  const rank = uci[1]
  return `${uci.slice(0, 2)}${uci[2] > uci[0] ? 'g' : 'c'}${rank}`
}

export function sanAndFens(fen: string, uciMoves: string[]): { sans: string[]; fens: string[]; played: string[] } {
  const game = new Chess(fen)
  const sans: string[] = []
  const fens: string[] = []
  const played: string[] = []
  for (const raw of uciMoves) {
    const uci = castlingToKingMove(game, raw)
    try {
      const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined })
      sans.push(move.san)
      fens.push(game.fen())
      played.push(uci)
    } catch {
      break
    }
  }
  return { sans, fens, played }
}

export function buildAnalysis(fen: string, infos: UciInfo[], engineName = BROWSER_ENGINE_NAME): Analysis | null {
  const sorted = [...infos].sort((a, b) => a.multipv - b.multipv)
  if (sorted.length === 0) return null
  const sign = fen.split(' ')[1] === 'b' ? -1 : 1
  const lines: AnalysisLine[] = sorted.map((info) => {
    const { sans, fens, played } = sanAndFens(fen, info.pv)
    return {
      score: info.scoreKind === 'cp' ? sign * info.scoreValue : 0,
      mate: info.scoreKind === 'mate' ? sign * info.scoreValue : 0,
      depth: info.depth,
      moves: sans,
      uciMoves: played,
      fens,
    }
  })
  const top = lines[0]
  return {
    bestMove: top.uciMoves[0] ?? '',
    score: top.score,
    mate: top.mate,
    depth: top.depth,
    engineName,
    lines,
  }
}

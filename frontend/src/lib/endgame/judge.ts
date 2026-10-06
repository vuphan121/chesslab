import { Chess } from 'chess.js'
import type { EndgameGoal } from './positions'
import type { TbMove, TbResult } from './tablebase'

export type Outcome = 'win' | 'draw' | 'loss'

export const DRAW_MOVE_LIMIT = 20
const WIN_LIMIT_FLOOR = 25
const WIN_LIMIT_FACTOR = 1.25
const WIN_LIMIT_EXTRA = 15

export function outcomeOf(category: string): Outcome | null {
  if (category === 'win' || category === 'maybe-win') return 'win'
  if (category === 'loss' || category === 'maybe-loss') return 'loss'
  if (category === 'draw' || category === 'cursed-win' || category === 'blessed-loss') return 'draw'
  return null
}

function invert(outcome: Outcome | null): Outcome | null {
  if (outcome === 'win') return 'loss'
  if (outcome === 'loss') return 'win'
  return outcome
}

export function keepsGoal(goal: EndgameGoal, outcome: Outcome | null): boolean {
  if (outcome === null) return true
  return goal === 'win' ? outcome === 'win' : outcome !== 'loss'
}

export function userOutcomeAfterMove(move: TbMove): Outcome | null {
  return invert(outcomeOf(move.category))
}

export function keptMoves(goal: EndgameGoal, tb: TbResult): TbMove[] {
  return tb.moves
    .filter((m) => keepsGoal(goal, userOutcomeAfterMove(m)))
    .sort((a, b) => Math.abs(a.dtz ?? 0) - Math.abs(b.dtz ?? 0))
}

const OPPONENT_RANK: Record<Outcome, number> = { loss: 0, draw: 1, win: 2 }

export function chooseReply(tb: TbResult, rng: () => number = Math.random): TbMove | null {
  if (tb.moves.length === 0) return null
  const rank = (m: TbMove) => OPPONENT_RANK[outcomeOf(m.category) ?? 'draw']
  const best = Math.min(...tb.moves.map(rank))
  const tied = tb.moves.filter((m) => rank(m) === best)
  if (best === OPPONENT_RANK.win) {
    const longest = Math.max(...tied.map((m) => Math.abs(m.dtz ?? 0)))
    const slowest = tied.filter((m) => Math.abs(m.dtz ?? 0) === longest)
    return slowest[Math.floor(rng() * slowest.length) % slowest.length]
  }
  return tied[Math.floor(rng() * tied.length) % tied.length]
}

export function moveLimit(goal: EndgameGoal, dtz: number | null | undefined): number {
  if (goal === 'draw') return DRAW_MOVE_LIMIT
  return Math.max(WIN_LIMIT_FLOOR, Math.ceil(Math.abs(dtz ?? 0) * WIN_LIMIT_FACTOR) + WIN_LIMIT_EXTRA)
}

export function uciFor(fen: string, from: string, to: string, promotion?: string): string | null {
  const legal = new Chess(fen).moves({ verbose: true }).find((m) => {
    if (m.from !== from || m.to !== to) return false
    if (m.promotion) return m.promotion === (promotion && 'qrbn'.includes(promotion) ? promotion : 'q')
    return true
  })
  return legal ? `${legal.from}${legal.to}${legal.promotion ?? ''}` : null
}

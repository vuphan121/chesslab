import { Chess } from 'chess.js'
import type { Color, Piece } from '@/lib/chess/types'
import type { EndgameObjective, EndgamePosition } from './positions'
import type { TbResult } from './tablebase'
import { outcomeOf } from './judge'

export const CUSTOM_KEY = 'chesslab:endgames:custom'
export const MAX_PIECES = 7
export const MAX_NAME_LENGTH = 40
export const OBJECTIVES: { key: EndgameObjective; label: string }[] = [
  { key: 'checkmate', label: 'Win by checkmate' },
  { key: 'promotion', label: 'Win by promoting a pawn' },
  { key: 'draw', label: 'Hold the draw' },
]

export type SetupPieces = Record<string, Piece>

const FILES = 'abcdefgh'

export function boardToFen(pieces: SetupPieces, turn: Color): string {
  const rows: string[] = []
  for (let rank = 8; rank >= 1; rank--) {
    let row = ''
    let empty = 0
    for (const file of FILES) {
      const piece = pieces[`${file}${rank}`]
      if (!piece) {
        empty++
        continue
      }
      if (empty > 0) row += empty
      empty = 0
      row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type
    }
    if (empty > 0) row += empty
    rows.push(row)
  }
  return `${rows.join('/')} ${turn} - - 0 1`
}

export function fenToBoard(fen: string): { pieces: SetupPieces; turn: Color } {
  const [board, turn] = fen.split(' ')
  const pieces: SetupPieces = {}
  board.split('/').forEach((row, index) => {
    let file = 0
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch)
        continue
      }
      pieces[`${FILES[file]}${8 - index}`] = {
        type: ch.toLowerCase() as Piece['type'],
        color: ch === ch.toUpperCase() ? 'w' : 'b',
      }
      file++
    }
  })
  return { pieces, turn: turn === 'b' ? 'b' : 'w' }
}

function kingSquare(pieces: SetupPieces, color: Color): string | null {
  return Object.entries(pieces).find(([, p]) => p.type === 'k' && p.color === color)?.[0] ?? null
}

export function validateSetup(pieces: SetupPieces, turn: Color, objective: EndgameObjective): string[] {
  const errors: string[] = []
  const all = Object.entries(pieces)
  const whiteKings = all.filter(([, p]) => p.type === 'k' && p.color === 'w').length
  const blackKings = all.filter(([, p]) => p.type === 'k' && p.color === 'b').length
  if (whiteKings !== 1 || blackKings !== 1) errors.push('Each side needs exactly one king.')
  if (all.length > MAX_PIECES) errors.push(`At most ${MAX_PIECES} pieces, so the tablebase can judge it.`)
  if (all.some(([sq, p]) => p.type === 'p' && (sq[1] === '1' || sq[1] === '8'))) errors.push('Pawns cannot stand on the first or last rank.')
  if (errors.length > 0) return errors

  const wk = kingSquare(pieces, 'w')!
  const bk = kingSquare(pieces, 'b')!
  if (Math.abs(FILES.indexOf(wk[0]) - FILES.indexOf(bk[0])) <= 1 && Math.abs(Number(wk[1]) - Number(bk[1])) <= 1) {
    return ['The kings cannot touch.']
  }
  const other: Color = turn === 'w' ? 'b' : 'w'
  try {
    if (new Chess(boardToFen(pieces, other)).isCheck()) return ['The side that is not to move cannot be in check.']
    const game = new Chess(boardToFen(pieces, turn))
    if (game.isGameOver()) return ['The position is already over (mate, stalemate or a dead draw).']
  } catch {
    return ['That is not a legal position.']
  }
  if (objective === 'promotion' && !all.some(([, p]) => p.type === 'p' && p.color === turn)) {
    return ['Promotion needs a pawn for the side to move.']
  }
  return []
}

export interface Verdict {
  ok: boolean
  text: string
}

export function verdictFor(objective: EndgameObjective, turn: Color, tb: TbResult): Verdict {
  const outcome = outcomeOf(tb.category)
  const side = turn === 'w' ? 'White' : 'Black'
  const other = turn === 'w' ? 'Black' : 'White'
  if (outcome === null) return { ok: true, text: 'The tablebase could not classify this position.' }
  const result =
    tb.category === 'cursed-win'
      ? `${side} has only a cursed win (a draw under the 50-move rule)`
      : tb.category === 'blessed-loss'
        ? `${side} loses only under the 50-move rule`
        : outcome === 'win'
          ? `${side} wins`
          : outcome === 'loss'
            ? `${other} wins`
            : 'Drawn'
  if (objective === 'draw') {
    return outcome === 'loss'
      ? { ok: false, text: `${result}. ${side} cannot hold the draw.` }
      : { ok: true, text: `${result}. ${side} can hold the draw.` }
  }
  return outcome === 'win'
    ? { ok: true, text: `${result}.` }
    : { ok: false, text: `${result}. ${side} cannot win this.` }
}

export function buildCustomPosition(input: {
  id: string
  name: string
  group: string
  fen: string
  objective: EndgameObjective
  randomize: boolean
}): EndgamePosition {
  return {
    id: input.id,
    name: input.name.trim().slice(0, MAX_NAME_LENGTH),
    group: input.group.trim(),
    fens: [input.fen],
    goal: input.objective === 'draw' ? 'draw' : 'win',
    ...(input.objective === 'promotion' ? { endsOnPromotion: true } : {}),
    custom: true,
    objective: input.objective,
    randomize: input.randomize,
  }
}

function isObjective(value: unknown): value is EndgameObjective {
  return value === 'checkmate' || value === 'promotion' || value === 'draw'
}

export function parseCustomPositions(raw: string | null): EndgamePosition[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: EndgamePosition[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const v = item as Record<string, unknown>
      if (typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.group !== 'string' || typeof v.fen !== 'string' || !isObjective(v.objective)) continue
      const { pieces, turn } = fenToBoard(v.fen)
      if (validateSetup(pieces, turn, v.objective).length > 0) continue
      out.push(buildCustomPosition({ id: v.id, name: v.name, group: v.group, fen: v.fen, objective: v.objective, randomize: v.randomize === true }))
    }
    return out
  } catch {
    return []
  }
}

export function serializeCustomPositions(positions: EndgamePosition[]): string {
  return JSON.stringify(
    positions.map((p) => ({ id: p.id, name: p.name, group: p.group, fen: p.fens[0], objective: p.objective, randomize: p.randomize === true })),
  )
}

export function newCustomId(now: number = Date.now(), rng: () => number = Math.random): string {
  return `custom-${now.toString(36)}-${Math.floor(rng() * 36 ** 4).toString(36)}`
}

import type { Color, Piece, PieceType, Square } from './types'

const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

const DISPLAY_ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p']

export interface MaterialSurplus {
  type: PieceType
  count: number
}

export interface MaterialDiff {
  white: MaterialSurplus[]
  black: MaterialSurplus[]
  advantage: number
}

export function computeMaterialDiff(pieces: Record<Square, Piece>): MaterialDiff {
  const counts: Record<Color, Record<PieceType, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  }
  for (const square in pieces) {
    const piece = pieces[square]
    counts[piece.color][piece.type]++
  }

  const white: MaterialSurplus[] = []
  const black: MaterialSurplus[] = []
  let advantage = 0

  for (const type of DISPLAY_ORDER) {
    const delta = counts.w[type] - counts.b[type]
    advantage += delta * PIECE_VALUES[type]
    if (delta > 0) white.push({ type, count: delta })
    else if (delta < 0) black.push({ type, count: -delta })
  }

  return { white, black, advantage }
}

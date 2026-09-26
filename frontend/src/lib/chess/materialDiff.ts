import type { Color, Piece, PieceType, Square } from './types'

// Standard piece values (kings excluded — they never differ in count).
const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

// Rendering order matches Lichess's convention: pawns last, everything else
// roughly by descending value.
const DISPLAY_ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p']

export interface MaterialSurplus {
  type: PieceType
  count: number
}

export interface MaterialDiff {
  // Piece types + counts the White side has MORE of on the board than Black
  // — i.e. Black's missing (captured) pieces of that type, rendered next to
  // White. Empty when White has no surplus of any type.
  white: MaterialSurplus[]
  // Same, mirrored: White's missing pieces, rendered next to Black.
  black: MaterialSurplus[]
  // Signed point value, White-relative (positive = White ahead). 0 when the
  // total material value is equal, even if individual piece types differ.
  advantage: number
}

// computeMaterialDiff compares on-board piece counts per type between the
// two colors. Since both sides start a standard game with identical counts
// per type, any per-type difference is equivalent to "the trailing side has
// lost N of this piece type" — no capture-history tracking needed, just the
// current position's pieces.
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

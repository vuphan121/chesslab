import { describe, it, expect } from 'vitest'
import { computeMaterialDiff } from './materialDiff'
import type { Piece, Square } from './types'

const START_FEN_PIECES: Record<Square, Piece> = {
  a1: { type: 'r', color: 'w' }, b1: { type: 'n', color: 'w' }, c1: { type: 'b', color: 'w' },
  d1: { type: 'q', color: 'w' }, e1: { type: 'k', color: 'w' }, f1: { type: 'b', color: 'w' },
  g1: { type: 'n', color: 'w' }, h1: { type: 'r', color: 'w' },
  a2: { type: 'p', color: 'w' }, b2: { type: 'p', color: 'w' }, c2: { type: 'p', color: 'w' },
  d2: { type: 'p', color: 'w' }, e2: { type: 'p', color: 'w' }, f2: { type: 'p', color: 'w' },
  g2: { type: 'p', color: 'w' }, h2: { type: 'p', color: 'w' },
  a8: { type: 'r', color: 'b' }, b8: { type: 'n', color: 'b' }, c8: { type: 'b', color: 'b' },
  d8: { type: 'q', color: 'b' }, e8: { type: 'k', color: 'b' }, f8: { type: 'b', color: 'b' },
  g8: { type: 'n', color: 'b' }, h8: { type: 'r', color: 'b' },
  a7: { type: 'p', color: 'b' }, b7: { type: 'p', color: 'b' }, c7: { type: 'p', color: 'b' },
  d7: { type: 'p', color: 'b' }, e7: { type: 'p', color: 'b' }, f7: { type: 'p', color: 'b' },
  g7: { type: 'p', color: 'b' }, h7: { type: 'p', color: 'b' },
}

function without(pieces: Record<Square, Piece>, ...squares: Square[]): Record<Square, Piece> {
  const copy = { ...pieces }
  for (const sq of squares) delete copy[sq]
  return copy
}

describe('computeMaterialDiff', () => {
  it('is empty for the starting position', () => {
    const diff = computeMaterialDiff(START_FEN_PIECES)
    expect(diff.white).toEqual([])
    expect(diff.black).toEqual([])
    expect(diff.advantage).toBe(0)
  })

  it('shows a bishop-for-a-pawn imbalance: bishop+2 for White, pawn for Black', () => {
    // White captured Black's f8 bishop; Black captured White's a2 pawn.
    const pieces = without(START_FEN_PIECES, 'f8', 'a2')
    const diff = computeMaterialDiff(pieces)
    expect(diff.white).toEqual([{ type: 'b', count: 1 }])
    expect(diff.black).toEqual([{ type: 'p', count: 1 }])
    expect(diff.advantage).toBe(2) // bishop (3) - pawn (1)
  })

  it('shows nothing when both sides traded a pawn each (equal)', () => {
    const pieces = without(START_FEN_PIECES, 'a2', 'a7')
    const diff = computeMaterialDiff(pieces)
    expect(diff.white).toEqual([])
    expect(diff.black).toEqual([])
    expect(diff.advantage).toBe(0)
  })

  it('shows per-type icons on both sides even when total value is balanced', () => {
    // White is down a queen (9) but up two knights and a bishop (3+3+3=9):
    // total value is balanced (0), but the piece types differ, so BOTH sides
    // should still show icons per Lichess convention — just no +N number.
    const pieces = without(START_FEN_PIECES, 'd1', 'b8', 'c8', 'g8')
    const diff = computeMaterialDiff(pieces)
    expect(diff.white.sort((a, b) => a.type.localeCompare(b.type))).toEqual([
      { type: 'b', count: 1 },
      { type: 'n', count: 2 },
    ])
    expect(diff.black).toEqual([{ type: 'q', count: 1 }])
    expect(diff.advantage).toBe(0)
  })

  it('is negative when Black is ahead', () => {
    const pieces = without(START_FEN_PIECES, 'd1') // White's queen captured
    const diff = computeMaterialDiff(pieces)
    expect(diff.black).toEqual([{ type: 'q', count: 1 }])
    expect(diff.white).toEqual([])
    expect(diff.advantage).toBe(-9)
  })
})

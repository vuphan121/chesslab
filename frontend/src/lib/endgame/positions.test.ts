import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { ENDGAME_GROUPS, ENDGAME_POSITIONS, mirrorFen, pickNextPosition, pickStartFen, swapColorsFen, userColorOf } from './positions'

describe('endgame positions', () => {
  it('has unique ids and a known group for each position', () => {
    const ids = ENDGAME_POSITIONS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(ENDGAME_GROUPS.map((g) => g.key))
    for (const p of ENDGAME_POSITIONS) expect(groups.has(p.group)).toBe(true)
  })

  it('every variant is a legal tablebase-sized game that is not already over', () => {
    for (const p of ENDGAME_POSITIONS) {
      expect(p.fens.length, p.id).toBeGreaterThan(0)
      for (const fen of p.fens) {
        const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length
        expect(pieces, fen).toBeLessThanOrEqual(7)
        expect(new Chess(fen).isGameOver(), fen).toBe(false)
      }
    }
  })

  it('all variants of a position put the same side to move', () => {
    for (const p of ENDGAME_POSITIONS) {
      expect(new Set(p.fens.map(userColorOf)).size, p.id).toBe(1)
    }
  })

  it('only win positions with a pawn end on promotion', () => {
    const ending = ENDGAME_POSITIONS.filter((p) => p.endsOnPromotion)
    expect(ending.map((p) => p.id)).toEqual(['key-squares', 'king-and-pawn', 'opposition', 'lucena'])
    for (const p of ending) {
      expect(p.goal, p.id).toBe('win')
      for (const fen of p.fens) expect(fen.split(' ')[0].toLowerCase().includes('p'), fen).toBe(true)
    }
  })

  it('reads the side to play from the FEN', () => {
    expect(userColorOf(ENDGAME_POSITIONS.find((p) => p.id === 'rook-pawn')!.fens[0])).toBe('b')
    expect(userColorOf(ENDGAME_POSITIONS.find((p) => p.id === 'lucena')!.fens[0])).toBe('w')
  })
})

describe('mirrorFen and swapColorsFen', () => {
  const lucena = '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1'
  it('mirrors the files', () => {
    expect(mirrorFen(lucena)).toBe('4k1K1/6P1/8/8/8/8/7r/5R2 w - - 0 1')
  })
  it('swaps the colours, flips the ranks and passes the move', () => {
    expect(swapColorsFen(lucena)).toBe('2r5/R7/8/8/8/8/1p6/1k1K4 b - - 0 1')
  })
  it('every transformed variant is still a legal position with the same material', () => {
    for (const p of ENDGAME_POSITIONS) {
      for (const fen of p.fens) {
        for (const variant of [mirrorFen(fen), swapColorsFen(fen), swapColorsFen(mirrorFen(fen))]) {
          expect(new Chess(variant).isGameOver(), variant).toBe(false)
          expect(variant.split(' ')[0].replace(/[^a-zA-Z]/g, '').length).toBe(fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length)
        }
      }
    }
  })
})

describe('pickStartFen', () => {
  const lucena = ENDGAME_POSITIONS.find((p) => p.id === 'lucena')!
  it('picks different starting positions for different random values', () => {
    let seed = 12345
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) seen.add(pickStartFen(lucena, rng))
    expect(seen.size).toBeGreaterThan(8)
  })
  it('uses a listed position when the transform draws are high', () => {
    expect(pickStartFen(lucena, () => 0.99)).toBe(lucena.fens[lucena.fens.length - 1])
  })
})

describe('pickNextPosition', () => {
  it('avoids the recent positions when it can', () => {
    const recent = ENDGAME_POSITIONS.slice(0, ENDGAME_POSITIONS.length - 1).map((p) => p.id)
    expect(pickNextPosition(ENDGAME_POSITIONS, recent, () => 0).id).toBe(ENDGAME_POSITIONS[ENDGAME_POSITIONS.length - 1].id)
  })
  it('falls back to any position when all were recent', () => {
    const all = ENDGAME_POSITIONS.map((p) => p.id)
    expect(ENDGAME_POSITIONS).toContain(pickNextPosition(ENDGAME_POSITIONS, all, () => 0.5))
  })
})

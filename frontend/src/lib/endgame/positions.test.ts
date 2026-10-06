import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { ENDGAME_GROUPS, ENDGAME_POSITIONS, pickNextPosition, userColorOf } from './positions'

describe('endgame positions', () => {
  it('has unique ids and a known group for each position', () => {
    const ids = ENDGAME_POSITIONS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = new Set(ENDGAME_GROUPS.map((g) => g.key))
    for (const p of ENDGAME_POSITIONS) expect(groups.has(p.group)).toBe(true)
  })

  it('every position is a legal tablebase-sized game that is not already over', () => {
    for (const p of ENDGAME_POSITIONS) {
      const chess = new Chess(p.fen)
      const pieces = p.fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length
      expect(pieces, p.id).toBeLessThanOrEqual(7)
      expect(chess.isGameOver(), p.id).toBe(false)
    }
  })

  it('reads the side to play from the FEN', () => {
    expect(userColorOf(ENDGAME_POSITIONS.find((p) => p.id === 'rook-pawn')!)).toBe('b')
    expect(userColorOf(ENDGAME_POSITIONS.find((p) => p.id === 'lucena')!)).toBe('w')
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

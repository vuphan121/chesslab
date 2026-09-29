import { describe, expect, it } from 'vitest'
import { positionKey } from './positionKey'

describe('positionKey', () => {
  it('keeps placement, side to move and castling', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq',
    )
  })

  it('ignores the en passant square and clocks', () => {
    expect(positionKey('8/8/8/8/8/8/8/K6k w - e3 4 9')).toBe(positionKey('8/8/8/8/8/8/8/K6k w - - 0 1'))
  })
})

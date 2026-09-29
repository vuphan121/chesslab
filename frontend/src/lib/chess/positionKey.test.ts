import { describe, expect, it } from 'vitest'
import { positionKey } from './positionKey'

describe('positionKey', () => {
  it('keeps every evaluation-relevant field', () => {
    expect(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0',
    )
  })

  it('ignores only the fullmove number', () => {
    expect(positionKey('8/8/8/8/8/8/8/K6k w - e3 4 9')).toBe(positionKey('8/8/8/8/8/8/8/K6k w - e3 4 1'))
  })

  it('distinguishes positions with different en-passant rights', () => {
    expect(positionKey('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).not.toBe(
      positionKey('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1'),
    )
  })

  it('distinguishes positions with different halfmove clocks', () => {
    expect(positionKey('8/8/8/8/8/8/8/K6k w - - 99 50')).not.toBe(
      positionKey('8/8/8/8/8/8/8/K6k w - - 0 50'),
    )
  })
})

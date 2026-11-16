import { describe, expect, it } from 'vitest'
import { chooseEngineReply, pieceCount } from './engineReply'

describe('chooseEngineReply', () => {
  it('prefers the line best for the side that is replying', () => {
    const lines = [
      { uci: 'a1a2', score: 300, mate: 0 },
      { uci: 'b1b2', score: -300, mate: 0 },
    ]
    expect(chooseEngineReply(lines, 'w', () => 0)).toBe('a1a2')
    expect(chooseEngineReply(lines, 'b', () => 0)).toBe('b1b2')
  })

  it('treats a longer mate as the better defence', () => {
    const lines = [
      { uci: 'a1a2', score: 0, mate: 2 },
      { uci: 'b1b2', score: 0, mate: 9 },
    ]
    expect(chooseEngineReply(lines, 'b', () => 0)).toBe('b1b2')
  })

  it('returns null with no usable line', () => {
    expect(chooseEngineReply([], 'w')).toBeNull()
  })

  it('counts pieces', () => {
    expect(pieceCount('8/8/6kp/1p6/5P2/1P6/P6K/8 w - - 0 1')).toBe(7)
  })
})

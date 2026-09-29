import { describe, expect, it } from 'vitest'
import { fenAfterMove, positionKey } from './optimisticFen'

describe('fenAfterMove', () => {
  it('plays a normal move', () => {
    const fen = fenAfterMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2', 'e4')
    expect(fen && positionKey(fen)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq')
  })

  it('castles by moving the king two squares', () => {
    const fen = fenAfterMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'g1')
    expect(fen?.split(' ')[0]).toBe('r3k2r/8/8/8/8/8/8/R4RK1')
  })

  it('removes the pawn captured en passant', () => {
    const fen = fenAfterMove('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6')
    expect(fen?.split(' ')[0]).toBe('4k3/8/3P4/8/8/8/8/4K3')
  })

  it('promotes to the requested piece', () => {
    const fen = fenAfterMove('8/P3k3/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8', 'n')
    expect(fen?.split(' ')[0]).toBe('N7/4k3/8/8/8/8/8/4K3')
  })

  it('returns null for an illegal move', () => {
    expect(fenAfterMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2', 'e5')).toBeNull()
  })
})

describe('positionKey', () => {
  it('ignores en passant square and clocks', () => {
    expect(positionKey('8/8/8/8/8/8/8/K6k w - e3 4 9')).toBe(positionKey('8/8/8/8/8/8/8/K6k w - - 0 1'))
  })
})

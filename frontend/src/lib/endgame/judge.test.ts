import { describe, expect, it } from 'vitest'
import { chooseReply, endsGame, keepsGoal, keptMoves, moveLimit, outcomeOf, uciFor, userOutcomeAfterMove } from './judge'
import type { TbResult } from './tablebase'

const tb = (moves: { uci: string; category: string; dtz?: number }[]): TbResult => ({ category: 'win', dtz: 10, moves })

describe('outcomeOf', () => {
  it('maps tablebase categories to win, draw or loss', () => {
    expect(outcomeOf('win')).toBe('win')
    expect(outcomeOf('loss')).toBe('loss')
    expect(outcomeOf('draw')).toBe('draw')
    expect(outcomeOf('cursed-win')).toBe('draw')
    expect(outcomeOf('blessed-loss')).toBe('draw')
    expect(outcomeOf('unknown')).toBeNull()
  })
})

describe('keepsGoal', () => {
  it('a win goal needs a win', () => {
    expect(keepsGoal('win', 'win')).toBe(true)
    expect(keepsGoal('win', 'draw')).toBe(false)
    expect(keepsGoal('win', 'loss')).toBe(false)
  })
  it('a draw goal accepts a draw or a win but not a loss', () => {
    expect(keepsGoal('draw', 'draw')).toBe(true)
    expect(keepsGoal('draw', 'win')).toBe(true)
    expect(keepsGoal('draw', 'loss')).toBe(false)
  })
  it('gives the benefit of the doubt when the result is unknown', () => {
    expect(keepsGoal('win', null)).toBe(true)
  })
})

describe('userOutcomeAfterMove', () => {
  it('reads the move category from the opponent side', () => {
    expect(userOutcomeAfterMove({ uci: 'a1a2', category: 'loss' })).toBe('win')
    expect(userOutcomeAfterMove({ uci: 'a1a2', category: 'win' })).toBe('loss')
    expect(userOutcomeAfterMove({ uci: 'a1a2', category: 'draw' })).toBe('draw')
    expect(userOutcomeAfterMove({ uci: 'a1a2', category: 'blessed-loss' })).toBe('draw')
  })
})

describe('keptMoves', () => {
  it('lists winning moves, fastest first', () => {
    const result = tb([
      { uci: 'a1a2', category: 'loss', dtz: -20 },
      { uci: 'a1a3', category: 'draw', dtz: 0 },
      { uci: 'a1a4', category: 'loss', dtz: -8 },
    ])
    expect(keptMoves('win', result).map((m) => m.uci)).toEqual(['a1a4', 'a1a2'])
  })
  it('keeps drawing moves for a draw goal', () => {
    const result = tb([
      { uci: 'a1a2', category: 'win', dtz: 4 },
      { uci: 'a1a3', category: 'draw', dtz: 0 },
    ])
    expect(keptMoves('draw', result).map((m) => m.uci)).toEqual(['a1a3'])
  })
})

describe('chooseReply', () => {
  it('returns null when there are no moves', () => {
    expect(chooseReply(tb([]))).toBeNull()
  })
  it('prefers the move that is best for the opponent', () => {
    const result = tb([
      { uci: 'e8e7', category: 'win', dtz: 4 },
      { uci: 'e8d8', category: 'draw', dtz: 0 },
      { uci: 'e8f8', category: 'loss', dtz: -2 },
    ])
    expect(chooseReply(result, () => 0)?.uci).toBe('e8f8')
  })
  it('resists longest when every move loses', () => {
    const result = tb([
      { uci: 'e8e7', category: 'win', dtz: 4 },
      { uci: 'e8d8', category: 'win', dtz: 12 },
    ])
    expect(chooseReply(result, () => 0)?.uci).toBe('e8d8')
  })
  it('picks among equally good moves with the rng', () => {
    const result = tb([
      { uci: 'e8e7', category: 'draw' },
      { uci: 'e8d8', category: 'draw' },
    ])
    expect(chooseReply(result, () => 0.99)?.uci).toBe('e8d8')
  })
})

describe('chooseReply and game-ending moves', () => {
  const result = tb([
    { uci: 'a1a2', category: 'draw' },
    { uci: 'a1b1', category: 'draw' },
  ])
  it('avoids a reply that ends the game when another equal move exists', () => {
    expect(chooseReply(result, () => 0, (uci) => uci === 'a1a2')?.uci).toBe('a1b1')
  })
  it('still plays an ending move when every equal move ends the game', () => {
    expect(chooseReply(result, () => 0, () => true)?.uci).toBe('a1a2')
  })
  it('never trades a better outcome for staying open', () => {
    const mixed = tb([
      { uci: 'e8e7', category: 'win' },
      { uci: 'e8d8', category: 'loss' },
    ])
    expect(chooseReply(mixed, () => 0, (uci) => uci === 'e8d8')?.uci).toBe('e8d8')
  })
})

describe('endsGame', () => {
  it('detects stalemate and checkmate', () => {
    expect(endsGame('7k/5Q2/8/8/8/8/8/K7 w - - 0 1', 'f7g6')).toBe(true)
    expect(endsGame('k7/8/1K6/8/8/8/8/7Q w - - 0 1', 'h1h8')).toBe(true)
    expect(endsGame('k7/8/1K6/8/8/8/8/7Q w - - 0 1', 'h1h3')).toBe(false)
  })
})

describe('moveLimit', () => {
  it('uses a fixed limit for a draw goal', () => {
    expect(moveLimit('draw', 0)).toBe(20)
  })
  it('scales with the distance for a win goal with a floor', () => {
    expect(moveLimit('win', 3)).toBe(25)
    expect(moveLimit('win', -59)).toBe(89)
    expect(moveLimit('win', null)).toBe(25)
  })
})

describe('uciFor', () => {
  const fen = '8/P7/8/8/8/8/k6K/8 w - - 0 1'
  it('returns the uci for a legal move', () => {
    expect(uciFor(fen, 'h2', 'h3')).toBe('h2h3')
  })
  it('defaults a promotion to a queen and honours a chosen piece', () => {
    expect(uciFor(fen, 'a7', 'a8')).toBe('a7a8q')
    expect(uciFor(fen, 'a7', 'a8', 'n')).toBe('a7a8n')
  })
  it('returns null for an illegal move', () => {
    expect(uciFor(fen, 'h2', 'h5')).toBeNull()
  })
})

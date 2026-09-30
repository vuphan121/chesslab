import { describe, expect, it } from 'vitest'
import { judgeMove, splitUci } from './judge'

const MATE_IN_ONE = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'

describe('judgeMove', () => {
  it('accepts the expected move', () => {
    expect(judgeMove(MATE_IN_ONE, 'a1a8', 'a1', 'a8')).toEqual({ kind: 'correct', uci: 'a1a8', mate: false })
  })

  it('accepts a different move that delivers mate', () => {
    const fen = '6k1/5ppp/8/8/8/8/1R3PPP/R5K1 w - - 0 1'
    expect(judgeMove(fen, 'b2b8', 'a1', 'a8')).toEqual({ kind: 'correct', uci: 'a1a8', mate: true })
  })

  it('marks a legal but different move as wrong', () => {
    expect(judgeMove(MATE_IN_ONE, 'a1a8', 'a1', 'a2')).toEqual({ kind: 'wrong', uci: 'a1a2' })
  })

  it('ignores illegal moves', () => {
    expect(judgeMove(MATE_IN_ONE, 'a1a8', 'a1', 'b3')).toEqual({ kind: 'illegal' })
  })

  it('checks the promotion piece', () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1'
    expect(judgeMove(fen, 'a7a8n', 'a7', 'a8', 'n')).toMatchObject({ kind: 'correct' })
    expect(judgeMove(fen, 'a7a8n', 'a7', 'a8')).toMatchObject({ kind: 'wrong' })
  })
})

describe('splitUci', () => {
  it('splits plain and promotion moves', () => {
    expect(splitUci('e2e4')).toEqual({ from: 'e2', to: 'e4' })
    expect(splitUci('a7a8q')).toEqual({ from: 'a7', to: 'a8', promotion: 'q' })
  })
})

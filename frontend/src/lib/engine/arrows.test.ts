import { describe, expect, it } from 'vitest'
import { ALTERNATIVE_ARROW_COLOR, BEST_ARROW_COLOR, arrowShapes, winningChances } from './arrows'

const line = (uci: string, score: number, mate = 0) => ({ uci, score, mate })

describe('winningChances', () => {
  it('matches Lichess: 0 for equal, saturating towards +-1, clamped at 1000 cp', () => {
    expect(winningChances(0, 0)).toBeCloseTo(0, 6)
    expect(winningChances(100, 0)).toBeCloseTo(0.1817, 3)
    expect(winningChances(-100, 0)).toBeCloseTo(-0.1817, 3)
    expect(winningChances(5000, 0)).toBeCloseTo(winningChances(1000, 0), 9)
    expect(winningChances(1000, 0)).toBeCloseTo(0.9509, 3)
  })

  it('treats a mate as a big advantage, slightly smaller the further away it is', () => {
    expect(winningChances(0, 1)).toBeGreaterThan(winningChances(0, 8))
    expect(winningChances(0, -1)).toBeLessThan(0)
    expect(winningChances(0, 3)).toBeCloseTo(-winningChances(0, -3), 9)
  })
})

describe('arrowShapes', () => {
  it('draws the best move at full width in the Lichess blue', () => {
    const shapes = arrowShapes([line('e2e4', 30)], 'w', 3)
    expect(shapes).toEqual([{ uci: 'e2e4', scale: 1, color: BEST_ARROW_COLOR }])
  })

  it('sizes the other moves by how good they are, not by their rank', () => {
    const nearlyAsGood = arrowShapes([line('e2e4', 30), line('d2d4', 28), line('g1f3', 5)], 'w', 3)
    expect(nearlyAsGood.map((s) => s.uci)).toEqual(['e2e4', 'd2d4', 'g1f3'])
    const [, second, third] = nearlyAsGood
    expect(second.color).toBe(ALTERNATIVE_ARROW_COLOR)
    expect(second.scale).toBeGreaterThan(third.scale)
    expect(second.scale).toBeLessThan(1)

    const equalToBest = arrowShapes([line('e2e4', 30), line('d2d4', 30), line('g1f3', 30)], 'w', 3)
    expect(equalToBest[1].scale).toBeCloseTo(equalToBest[2].scale, 9)
    expect(equalToBest[1].scale).toBeCloseTo(12 / 15, 9)
  })

  it('drops moves that are much worse than the best (a shift of 0.2 or more)', () => {
    const shapes = arrowShapes([line('e2e4', 300), line('d2d4', 200), line('h2h4', -300)], 'w', 3)
    expect(shapes.map((s) => s.uci)).toEqual(['e2e4', 'd2d4'])
  })

  it('skips duplicate moves and always makes the best-evaluated line the blue one', () => {
    const better = arrowShapes([line('e2e4', 30), line('d2d4', 90)], 'w', 3)
    expect(better[0]).toMatchObject({ uci: 'd2d4', scale: 1, color: BEST_ARROW_COLOR })
    expect(better[1].uci).toBe('e2e4')
    expect(arrowShapes([line('e2e4', 30), line('e2e4', 30), line('d2d4', 28)], 'w', 3).map((s) => s.uci)).toEqual(['e2e4', 'd2d4'])
  })

  it('judges quality from the side to move: scores are White-relative, so Black wants them lower', () => {
    const black = arrowShapes([line('e7e5', -30), line('c7c5', -28), line('a7a5', 200)], 'b', 3)
    expect(black.map((s) => s.uci)).toEqual(['e7e5', 'c7c5'])
    const white = arrowShapes([line('e2e4', -30), line('d2d4', -28)], 'w', 3)
    expect(white[0].uci).toBe('d2d4')
  })

  it('respects the maximum number of arrows and ignores unusable lines', () => {
    const lines = [line('e2e4', 30), line('d2d4', 29), line('g1f3', 28), line('c2c4', 27)]
    expect(arrowShapes(lines, 'w', 1)).toHaveLength(1)
    expect(arrowShapes(lines, 'w', 2)).toHaveLength(2)
    expect(arrowShapes(lines, 'w', 4)).toHaveLength(4)
    expect(arrowShapes(lines, 'w', 0)).toEqual([])
    expect(arrowShapes([{ uci: undefined, score: 0, mate: 0 }, line('e2', 0)], 'w', 3)).toEqual([])
  })

  it('marks the highest-evaluated line as best even if the source lists it later', () => {
    const shapes = arrowShapes([line('c2c4', 20), line('e2e4', 34), line('d2d4', 30)], 'w', 3)
    expect(shapes.map((s) => s.uci)).toEqual(['e2e4', 'd2d4', 'c2c4'])
    expect(shapes[0].color).toBe(BEST_ARROW_COLOR)
    expect(shapes[0].scale).toBe(1)
    const black = arrowShapes([line('a7a6', -10), line('e7e5', -30)], 'b', 3)
    expect(black[0].uci).toBe('e7e5')
  })

  it('handles mate lines', () => {
    const shapes = arrowShapes([line('d8h4', 0, -1), line('g8f6', 0, -1)], 'b', 3)
    expect(shapes.map((s) => s.uci)).toEqual(['d8h4', 'g8f6'])
  })
})

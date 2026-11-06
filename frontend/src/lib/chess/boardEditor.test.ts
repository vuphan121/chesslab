import { describe, expect, it } from 'vitest'
import { START_PLACEMENT, availableCastling, fenToSetup, piecesToPlacement, placementToPieces, setupToFen, validateSetup } from './boardEditor'

describe('board editor setup', () => {
  it('round-trips the starting position', () => {
    expect(piecesToPlacement(placementToPieces(START_PLACEMENT))).toBe(START_PLACEMENT)
    const setup = fenToSetup(`${START_PLACEMENT} w KQkq - 0 1`)!
    expect(setupToFen(setup)).toBe(`${START_PLACEMENT} w KQkq - 0 1`)
    expect(validateSetup(setup)).toEqual([])
  })

  it('drops castling rights whose king or rook moved', () => {
    const setup = fenToSetup('4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1')!
    expect(availableCastling(setup.pieces)).toBe('KQ')
    expect(setupToFen(setup)).toBe('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1')
  })

  it('rejects missing kings, back-rank pawns and a side not to move in check', () => {
    expect(validateSetup(fenToSetup('8/8/8/8/8/8/8/4K3 w - - 0 1')!)).toContain('Black needs exactly one king.')
    expect(validateSetup(fenToSetup('P3k3/8/8/8/8/8/8/4K3 w - - 0 1')!)).toContain('Pawns cannot stand on the first or last rank.')
    expect(validateSetup(fenToSetup('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1')!).length).toBeGreaterThan(0)
  })
})

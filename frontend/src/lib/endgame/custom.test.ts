import { describe, expect, it } from 'vitest'
import {
  boardToFen,
  buildCustomPosition,
  fenToBoard,
  newCustomId,
  parseCustomPositions,
  serializeCustomPositions,
  validateSetup,
  verdictFor,
} from './custom'
import { groupsFor, pickStartFen } from './positions'

const LUCENA = '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1'

describe('boardToFen and fenToBoard', () => {
  it('round-trips a position', () => {
    const { pieces, turn } = fenToBoard(LUCENA)
    expect(boardToFen(pieces, turn)).toBe(LUCENA)
  })
  it('reads the side to move', () => {
    expect(fenToBoard('4k3/8/8/8/8/8/8/4K3 b - - 0 1').turn).toBe('b')
  })
  it('writes an empty rank as 8', () => {
    expect(boardToFen({ e1: { type: 'k', color: 'w' }, e8: { type: 'k', color: 'b' } }, 'w')).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1')
  })
})

describe('validateSetup', () => {
  const setup = (fen: string) => {
    const { pieces, turn } = fenToBoard(fen)
    return { pieces, turn }
  }
  it('accepts a good position', () => {
    const { pieces, turn } = setup(LUCENA)
    expect(validateSetup(pieces, turn, 'promotion')).toEqual([])
  })
  it('needs one king each', () => {
    const { pieces, turn } = setup('8/8/8/8/8/8/8/4K3 w - - 0 1')
    expect(validateSetup(pieces, turn, 'checkmate')[0]).toMatch(/exactly one king/)
  })
  it('limits the piece count to 7', () => {
    const { pieces, turn } = setup('4k3/pppp4/8/8/8/8/PPPP4/4K3 w - - 0 1')
    expect(validateSetup(pieces, turn, 'checkmate')[0]).toMatch(/At most 7/)
  })
  it('rejects pawns on the back ranks', () => {
    const { pieces, turn } = setup('P3k3/8/8/8/8/8/8/4K3 w - - 0 1')
    expect(validateSetup(pieces, turn, 'checkmate')[0]).toMatch(/first or last rank/)
  })
  it('rejects touching kings', () => {
    const { pieces, turn } = setup('8/8/8/3kK3/8/8/8/8 w - - 0 1')
    expect(validateSetup(pieces, turn, 'checkmate')).toEqual(['The kings cannot touch.'])
  })
  it('rejects a position where the side not to move is in check', () => {
    const { pieces, turn } = setup('4k3/8/8/8/8/8/8/4KR2 w - - 0 1')
    expect(validateSetup({ ...pieces, e5: { type: 'r', color: 'w' } }, turn, 'checkmate')[0]).toMatch(/not to move/)
  })
  it('rejects a position that is already over', () => {
    const { pieces, turn } = setup('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
    expect(validateSetup(pieces, turn, 'checkmate')[0]).toMatch(/already over/)
  })
  it('promotion needs a pawn for the side to move', () => {
    const { pieces, turn } = setup('8/8/8/8/8/1k6/6r1/Q3K3 w - - 0 1')
    expect(validateSetup(pieces, turn, 'promotion')).toEqual(['Promotion needs a pawn for the side to move.'])
    expect(validateSetup(pieces, turn, 'checkmate')).toEqual([])
  })
})

describe('verdictFor', () => {
  const tb = (category: string) => ({ category, dtz: 0, moves: [] })
  it('accepts a win objective only when the mover wins', () => {
    expect(verdictFor('checkmate', 'w', tb('win')).ok).toBe(true)
    expect(verdictFor('checkmate', 'w', tb('draw')).ok).toBe(false)
    expect(verdictFor('promotion', 'b', tb('loss')).ok).toBe(false)
    expect(verdictFor('checkmate', 'w', tb('cursed-win')).ok).toBe(false)
  })
  it('accepts a hold objective unless the mover is lost', () => {
    expect(verdictFor('draw', 'b', tb('draw')).ok).toBe(true)
    expect(verdictFor('draw', 'b', tb('blessed-loss')).ok).toBe(true)
    expect(verdictFor('draw', 'b', tb('loss')).ok).toBe(false)
  })
  it('names the side in the message', () => {
    expect(verdictFor('draw', 'b', tb('loss')).text).toBe('White wins. Black cannot hold the draw.')
  })
})

describe('custom positions', () => {
  const made = buildCustomPosition({ id: 'custom-1', name: '  My Lucena  ', group: 'rook', fen: LUCENA, objective: 'promotion', randomize: false })
  it('maps the objective to a goal', () => {
    expect(made.goal).toBe('win')
    expect(made.endsOnPromotion).toBe(true)
    expect(made.name).toBe('My Lucena')
    expect(buildCustomPosition({ id: 'x', name: 'n', group: 'g', fen: LUCENA, objective: 'draw', randomize: true }).goal).toBe('draw')
    expect(buildCustomPosition({ id: 'x', name: 'n', group: 'g', fen: LUCENA, objective: 'checkmate', randomize: true }).endsOnPromotion).toBeUndefined()
  })
  it('does not randomise unless asked', () => {
    expect(pickStartFen(made, () => 0.1)).toBe(LUCENA)
  })
  it('round-trips through storage', () => {
    expect(parseCustomPositions(serializeCustomPositions([made]))).toEqual([made])
  })
  it('drops damaged or illegal entries when loading', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'ok', group: 'g', fen: LUCENA, objective: 'checkmate' },
      { id: 'b', name: 'no king', group: 'g', fen: '8/8/8/8/8/8/8/4K3 w - - 0 1', objective: 'checkmate' },
      { id: 'c', name: 'bad objective', group: 'g', fen: LUCENA, objective: 'fly' },
      'junk',
    ])
    expect(parseCustomPositions(raw).map((p) => p.id)).toEqual(['a'])
    expect(parseCustomPositions('not json')).toEqual([])
    expect(parseCustomPositions(null)).toEqual([])
  })
  it('makes distinct ids', () => {
    expect(newCustomId(1, () => 0.1)).not.toBe(newCustomId(2, () => 0.1))
  })
  it('adds custom categories after the built-in ones', () => {
    const groups = groupsFor([made, buildCustomPosition({ id: 'y', name: 'n', group: 'My own', fen: LUCENA, objective: 'draw', randomize: false })])
    expect(groups.map((g) => g.key)).toEqual(['pawn', 'rook', 'minor', 'queen', 'My own'])
    expect(groups[4].label).toBe('My own')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLinePgn, copyPgnToClipboard } from './exportPgn'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('buildLinePgn', () => {
  it('joins the leading and played moves into one game', () => {
    const pgn = buildLinePgn({
      repertoireName: 'Catalan',
      chapterName: 'Open',
      startFen: START,
      fallbackFen: START,
      leadingSans: ['d4', 'Nf6'],
      runSans: ['c4', 'e6', 'g3'],
      side: 'w',
      date: new Date(2026, 8, 29),
    })
    expect(pgn).toContain('[Event "Catalan: Open"]')
    expect(pgn).toContain('[Date "2026.09.29"]')
    expect(pgn).toContain('1. d4 Nf6 2. c4 e6 3. g3')
    expect(pgn).not.toContain('[FEN')
  })

  it('adds FEN headers for a chapter that starts from a set-up position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'
    const pgn = buildLinePgn({
      repertoireName: 'X',
      chapterName: 'Y',
      startFen: fen,
      fallbackFen: fen,
      leadingSans: [],
      runSans: ['Nf6', 'c4'],
      side: 'b',
    })
    expect(pgn).toContain('[SetUp "1"]')
    expect(pgn).toContain(`[FEN "${fen}"]`)
    expect(pgn).toContain('1. ... Nf6 2. c4')
  })

  it('falls back to the run start when the full line does not replay', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'
    const pgn = buildLinePgn({
      repertoireName: 'X',
      chapterName: 'Y',
      startFen: START,
      fallbackFen: fen,
      leadingSans: ['e5'],
      runSans: ['Nf6'],
      side: 'b',
    })
    expect(pgn).toContain(`[FEN "${fen}"]`)
  })

  it('returns null when nothing replays', () => {
    expect(
      buildLinePgn({ repertoireName: 'X', chapterName: 'Y', startFen: START, fallbackFen: START, leadingSans: [], runSans: ['Qh5'], side: 'w' }),
    ).toBeNull()
  })
})

describe('copyPgnToClipboard', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('copies the generated PGN without creating a download', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyPgnToClipboard('[Event "Test"]\n\n1. e4 *')
    expect(writeText).toHaveBeenCalledWith('[Event "Test"]\n\n1. e4 *')
  })
})

import { describe, expect, it } from 'vitest'
import { parseInfo } from './uci'
import type { UciInfo } from './uci'
import { buildAnalysis } from './buildAnalysis'
import { engineDefaults, engineLimits, sanitizeSettings, settingsSignature } from './settings'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

describe('parseInfo', () => {
  it('parses a normal multipv line', () => {
    const info = parseInfo('info depth 14 seldepth 20 multipv 2 score cp 17 nodes 271243 nps 731113 hashfull 48 time 371 pv d2d3 f8c5 e1g1')
    expect(info).toMatchObject({ depth: 14, multipv: 2, scoreKind: 'cp', scoreValue: 17, bound: null, nodes: 271243, nps: 731113, timeMs: 371 })
    expect(info?.pv).toEqual(['d2d3', 'f8c5', 'e1g1'])
  })

  it('parses mate scores and negative values', () => {
    expect(parseInfo('info depth 9 multipv 1 score mate -3 nodes 1 nps 1 time 1 pv a1a2')).toMatchObject({ scoreKind: 'mate', scoreValue: -3 })
    expect(parseInfo('info depth 9 multipv 1 score cp -45 nodes 1 nps 1 time 1 pv a1a2')).toMatchObject({ scoreKind: 'cp', scoreValue: -45 })
  })

  it('defaults multipv to 1 and keeps bound flags', () => {
    const info = parseInfo('info depth 5 score cp 30 lowerbound nodes 9 nps 9 time 1 pv e2e4')
    expect(info?.multipv).toBe(1)
    expect(info?.bound).toBe('lower')
  })

  it('ignores lines that carry no usable line', () => {
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull()
    expect(parseInfo('info depth 0 score mate 0')).toBeNull()
    expect(parseInfo('info depth 12 currmove e2e4 currmovenumber 1')).toBeNull()
    expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeNull()
  })
})

function info(over: Partial<UciInfo>): UciInfo {
  return { depth: 12, multipv: 1, scoreKind: 'cp', scoreValue: 30, bound: null, nodes: 1, nps: 1, timeMs: 1, pv: ['e2e4', 'e7e5'], ...over }
}

describe('buildAnalysis', () => {
  it('keeps scores White-relative when White is to move', () => {
    const a = buildAnalysis(START, [info({ scoreValue: 30 })])
    expect(a?.score).toBe(30)
    expect(a?.bestMove).toBe('e2e4')
  })

  it('flips the score when Black is to move (the engine reports side-to-move)', () => {
    const a = buildAnalysis(AFTER_E4, [info({ scoreValue: 40, pv: ['e7e5', 'g1f3'] })])
    expect(a?.score).toBe(-40)
    const mate = buildAnalysis(AFTER_E4, [info({ scoreKind: 'mate', scoreValue: 3, pv: ['d8h4'] })])
    expect(mate?.mate).toBe(-3)
    expect(mate?.score).toBe(0)
  })

  it('orders lines by multipv and converts them to SAN and FENs', () => {
    const a = buildAnalysis(START, [
      info({ multipv: 2, pv: ['d2d4', 'd7d5'] }),
      info({ multipv: 1, pv: ['e2e4', 'e7e5', 'g1f3'] }),
    ])
    expect(a?.lines.map((l) => l.uciMoves[0])).toEqual(['e2e4', 'd2d4'])
    expect(a?.lines[0].moves).toEqual(['e4', 'e5', 'Nf3'])
    expect(a?.lines[0].fens).toHaveLength(3)
    expect(a?.lines[0].fens[0].split(' ')[1]).toBe('b')
  })

  it('stops a line at the first illegal move instead of throwing', () => {
    const a = buildAnalysis(START, [info({ pv: ['e2e4', 'e2e4', 'g1f3'] })])
    expect(a?.lines[0].uciMoves).toEqual(['e2e4'])
  })

  it('returns null when there is nothing to show', () => {
    expect(buildAnalysis(START, [])).toBeNull()
  })
})

describe('engine settings', () => {
  it('defaults follow Lichess (8 s per position) with 3 arrows on a laptop, and are lighter on a phone', () => {
    expect(engineDefaults(false)).toMatchObject({ limit: 'time', timeSec: 8, lines: 3, useCloud: true })
    expect(engineDefaults(true)).toMatchObject({ limit: 'time', timeSec: 4, lines: 1, useCloud: true })
    expect(engineDefaults(true).hashMb).toBeLessThan(engineDefaults(false).hashMb)
    expect(engineDefaults(true).timeSec).toBeLessThan(engineDefaults(false).timeSec)
  })

  it('uses the same time steps as Lichess, and no long or infinite searches on a phone', () => {
    expect(engineLimits(true).timeTicks).toEqual([2, 4, 6, 8, 10, 12, 15, 20, 30])
    expect(engineLimits(false).timeTicks).toEqual([2, 4, 6, 8, 10, 12, 15, 20, 30, 60, 120, 300])
    expect(engineLimits(true).allowInfinite).toBe(false)
    expect(engineLimits(false).allowInfinite).toBe(true)
  })

  it('falls back to the device defaults for junk', () => {
    expect(sanitizeSettings(null)).toEqual(engineDefaults(false))
    expect(sanitizeSettings('x', true)).toEqual(engineDefaults(true))
  })

  it('clamps values, snaps time to a step and lines and hash to allowed values', () => {
    const s = sanitizeSettings({ limit: 'time', depth: 999, timeSec: 45, lines: 9, hashMb: 100, useCloud: 'yes' })
    expect(s).toMatchObject({ limit: 'time', depth: 40, timeSec: 30, lines: 5, hashMb: 128, useCloud: true })
    expect(sanitizeSettings({ timeSec: 0 }).timeSec).toBe(2)
  })

  it('keeps a phone within its limits even if a laptop-sized value was stored', () => {
    const s = sanitizeSettings({ limit: 'infinite', timeSec: 300, hashMb: 256 }, true)
    expect(s.limit).toBe('time')
    expect(s.timeSec).toBe(30)
    expect(s.hashMb).toBe(64)
    expect(sanitizeSettings({ limit: 'infinite' }, false).limit).toBe('infinite')
  })

  it('gives different signatures only when a setting that changes the result changes', () => {
    const base = engineDefaults(false)
    const a = settingsSignature(base)
    expect(settingsSignature({ ...base, timeSec: 12 })).not.toBe(a)
    expect(settingsSignature({ ...base, limit: 'depth' })).not.toBe(a)
    expect(settingsSignature({ ...base, depth: 30 })).toBe(a)
    expect(settingsSignature({ ...base, limit: 'depth', timeSec: 30 })).toBe(settingsSignature({ ...base, limit: 'depth', timeSec: 2 }))
  })
})

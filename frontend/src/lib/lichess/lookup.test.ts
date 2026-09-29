import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudAnalysis, clearLookupCache, lookupAnalysis, lookupEval, pieceCount, tablebaseAnalysis } from './lookup'
import { explorerPositionKey, toExplorer } from './explorer'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('cloudAnalysis', () => {
  it('turns cloud lines into an analysis with SAN and FENs', () => {
    const a = cloudAnalysis(START, { depth: 40, pvs: [{ moves: 'e2e4 e7e5 g1f3', cp: 25 }, { moves: 'd2d4', cp: 20 }] })
    expect(a).toMatchObject({ bestMove: 'e2e4', score: 25, mate: 0, depth: 40, engineName: 'Lichess Cloud' })
    expect(a.lines).toHaveLength(2)
    expect(a.lines[0].moves).toEqual(['e4', 'e5', 'Nf3'])
    expect(a.lines[0].fens).toHaveLength(3)
  })

  it('keeps mate scores', () => {
    const a = cloudAnalysis(START, { depth: 30, pvs: [{ moves: 'e2e4', mate: 3 }] })
    expect(a).toMatchObject({ mate: 3, score: 0 })
  })
})

describe('tablebaseAnalysis', () => {
  const white = '8/8/8/8/8/4k3/4p3/4K3 w - - 0 1'
  const black = '8/8/8/8/8/4k3/4p3/4K3 b - - 0 1'

  it('reports a decisive result from the side to move', () => {
    const a = tablebaseAnalysis(white, { category: 'win', dtz: 5, dtm: 7, moves: [{ uci: 'e1d1' }] })
    expect(a).toMatchObject({ tablebaseCategory: 'win', tablebaseDtz: 5, score: 10000, mate: 4, bestMove: 'e1d1' })
    expect(a.engineName).toBe('Syzygy Tablebase (3-man)')
  })

  it('flips everything to White-relative when Black is to move', () => {
    const a = tablebaseAnalysis(black, { category: 'win', dtz: 5, dtm: 7 })
    expect(a).toMatchObject({ tablebaseCategory: 'loss', tablebaseDtz: -5, score: -10000, mate: -4 })
  })

  it('gives no sentinel score or mate for cursed and blessed results', () => {
    const cursed = tablebaseAnalysis(white, { category: 'cursed-win', dtz: 120, dtm: 20 })
    expect(cursed).toMatchObject({ tablebaseCategory: 'cursed-win', score: 0, mate: 0 })
    const blessed = tablebaseAnalysis(black, { category: 'cursed-win' })
    expect(blessed.tablebaseCategory).toBe('blessed-loss')
  })
})

describe('lookup fetching', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    clearLookupCache()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

  it('asks cloud-eval for the requested lines and caches the answer', async () => {
    fetchMock.mockImplementation(() => json({ depth: 50, pvs: [{ moves: 'e2e4', cp: 30 }] }))
    const a = await lookupAnalysis(START, 3)
    expect(a?.depth).toBe(50)
    expect(String(fetchMock.mock.calls[0][0])).toContain('multiPv=3')
    await lookupAnalysis(START, 3)
    await lookupAnalysis(START, 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns null on 404 and remembers it', async () => {
    fetchMock.mockImplementation(() => json({}, 404))
    expect(await lookupAnalysis(START, 3)).toBeNull()
    expect(await lookupAnalysis(START, 3)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not remember network failures', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    expect(await lookupAnalysis(START, 3)).toBeNull()
    fetchMock.mockImplementation(() => json({ depth: 10, pvs: [{ moves: 'e2e4', cp: 1 }] }))
    expect((await lookupAnalysis(START, 3))?.depth).toBe(10)
  })

  it('aborts the underlying request when its final subscriber leaves', async () => {
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, init?: RequestInit) => new Promise((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined
      requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const controller = new AbortController()
    const pending = lookupAnalysis(START, 3, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(true)
  })

  it('keeps a shared request alive while another subscriber still needs it', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    let requestSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, init?: RequestInit) => new Promise<Response>((resolve) => {
      resolveFetch = resolve
      requestSignal = init?.signal ?? undefined
    }))
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = lookupAnalysis(START, 3, firstController.signal)
    const second = lookupAnalysis(START, 3, secondController.signal)
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(false)
    resolveFetch?.(new Response(JSON.stringify({ depth: 25, pvs: [{ moves: 'e2e4', cp: 12 }] }), { status: 200 }))
    expect((await second)?.depth).toBe(25)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the tablebase for seven pieces or fewer and skips finished games', async () => {
    fetchMock.mockImplementation(() => json({ category: 'draw', moves: [] }))
    const a = await lookupAnalysis('8/8/8/8/8/4k3/8/4K2R w - - 0 1', 3)
    expect(String(fetchMock.mock.calls[0][0])).toContain('tablebase.lichess.ovh')
    expect(a?.tablebaseCategory).toBe('draw')
    fetchMock.mockClear()
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
    expect(await lookupAnalysis(mated, 3)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reduces a lookup to an eval', async () => {
    fetchMock.mockImplementation(() => json({ depth: 42, pvs: [{ moves: 'e2e4', cp: -15 }] }))
    expect(await lookupEval(START)).toEqual({ score: -15, mate: 0, depth: 42 })
  })
})

describe('helpers', () => {
  it('counts pieces from the placement field', () => {
    expect(pieceCount(START)).toBe(32)
    expect(pieceCount('8/8/8/8/8/4k3/8/4K2R w - - 0 1')).toBe(3)
  })

  it('maps explorer data to shares and percentages', () => {
    const e = toExplorer({
      white: 60,
      draws: 20,
      black: 20,
      opening: { eco: 'B00', name: "King's Pawn" },
      moves: [{ uci: 'e7e5', san: 'e5', white: 30, draws: 10, black: 10, opening: { eco: 'C20', name: 'Open Game' } }],
    })
    expect(e).toMatchObject({ totalGames: 100, openingName: "King's Pawn", openingEco: 'B00' })
    expect(e.moves[0]).toMatchObject({ san: 'e5', games: 50, sharePct: 50, whitePct: 60, drawPct: 20, blackPct: 20, openingName: 'Open Game' })
  })

  it('keys explorer positions without move clocks', () => {
    expect(explorerPositionKey(START)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
    expect(explorerPositionKey(START.replace('0 1', '37 84'))).toBe(explorerPositionKey(START))
  })
})

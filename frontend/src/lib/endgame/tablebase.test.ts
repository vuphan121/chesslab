import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTablebaseCache, fetchTablebase } from './tablebase'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

describe('fetchTablebase', () => {
  beforeEach(() => clearTablebaseCache())

  it('requests the position once and caches it', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ category: 'win', dtz: 5, moves: [{ uci: 'a1a2', category: 'loss', dtz: -4 }] }))
    const first = await fetchTablebase('8/8/8/8/8/8/8/K6k w - - 0 1', fetcher)
    const second = await fetchTablebase('8/8/8/8/8/8/8/K6k w - - 0 1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(first.moves).toHaveLength(1)
  })

  it('shares one request between simultaneous callers', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ category: 'draw', moves: [] }))
    await Promise.all([fetchTablebase('fen-a', fetcher), fetchTablebase('fen-a', fetcher)])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects on a failed status and does not cache it', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    await expect(fetchTablebase('fen-b', fetcher)).rejects.toThrow('429')
    fetcher.mockResolvedValue(ok({ category: 'draw', moves: [] }))
    await expect(fetchTablebase('fen-b', fetcher)).resolves.toMatchObject({ category: 'draw' })
  })

  it('rejects when the response has no category', async () => {
    await expect(fetchTablebase('fen-c', vi.fn().mockResolvedValue(ok({})))).rejects.toThrow('no result')
  })
})

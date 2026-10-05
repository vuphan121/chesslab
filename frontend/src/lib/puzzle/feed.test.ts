import { describe, expect, it, vi } from 'vitest'
import type { PuzzleJSON } from '@/lib/api/client'
import { COLD_START_MS, FEED_BATCH, FEED_LOW_WATER, PuzzleFeed, type FeedDeps, type FeedMode, type FeedSource, type NextResult } from './feed'
import { PuzzlePool, type PoolState, type PoolStore } from './pool'

function puzzle(id: string, theme = 'fork'): PuzzleJSON {
  return { id, fen: 'f', moves: 'e2e4', rating: 2000, themes: [theme], theme, themeRating: 2000, mixed: true }
}

const batch = (prefix: string, n = FEED_BATCH, theme = 'fork') => Array.from({ length: n }, (_, i) => puzzle(`${prefix}${i}`, theme))

function memoryStore(puzzles: PuzzleJSON[] = []): PoolStore & { state: PoolState } {
  const store = {
    state: { puzzles, served: [] as string[], fetchedAt: 1 } as PoolState,
    async read() {
      return store.state
    },
    async write(state: PoolState) {
      store.state = state
    },
  }
  return store
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface Options {
  poolPuzzles?: PuzzleJSON[] | null
  fetchBatch?: FeedDeps['fetchBatch']
  flushResults?: () => Promise<number>
}

function harness(options: Options = {}) {
  const events: string[] = []
  const sleepers: { ms: number; resolve: () => void }[] = []
  const watchers: { onReady: () => void; stopped: boolean; ping: () => Promise<boolean> }[] = []
  const sources: FeedSource[] = []
  const store = options.poolPuzzles === null ? null : memoryStore(options.poolPuzzles ?? [])
  const pool = store ? new PuzzlePool(store) : null
  const fetchBatch = vi.fn(options.fetchBatch ?? (async () => batch('live')))
  const flushResults = vi.fn(
    options.flushResults ??
      (async () => {
        events.push('flush')
        return 0
      }),
  )
  const refreshThemes = vi.fn(async () => void events.push('themes'))
  const feed = new PuzzleFeed({
    fetchBatch: (theme, opts) => {
      events.push('fetch')
      return fetchBatch(theme, opts)
    },
    pool,
    flushResults,
    refreshThemes,
    checkHealth: async () => true,
    sleep: (ms) => new Promise<void>((resolve) => sleepers.push({ ms, resolve })),
    watch: (onReady, deps) => {
      const w = { onReady, stopped: false, ping: deps.ping }
      watchers.push(w)
      return () => {
        w.stopped = true
      }
    },
    onSourceChange: (s) => sources.push(s),
  })
  return { feed, pool, store, fetchBatch, flushResults, refreshThemes, sleepers, watchers, sources, events }
}

const mixed: FeedMode = { kind: 'mixed' }
const idOf = (r: NextResult) => (r.kind === 'puzzle' ? r.puzzle.id : r.kind)

describe('without a pool (desktop)', () => {
  it('serves the batch in order and prefetches when the queue runs low', async () => {
    let n = 0
    const h = harness({ poolPuzzles: null, fetchBatch: async () => batch(`b${n++}-`) })
    h.feed.start(mixed)
    const ids: string[] = []
    for (let i = 0; i < 8; i++) ids.push(idOf(await h.feed.next()))
    await settle()
    expect(ids.slice(0, 5)).toEqual(['b0-0', 'b0-1', 'b0-2', 'b0-3', 'b0-4'])
    expect(ids[5]).toBe('b1-0')
    expect(h.fetchBatch.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(h.sleepers).toHaveLength(0)
    expect(h.watchers).toHaveLength(0)
    expect(h.flushResults).not.toHaveBeenCalled()
  })

  it('asks for batches of five and excludes what was already served', async () => {
    const h = harness({ poolPuzzles: null })
    h.feed.start(mixed)
    for (let i = 0; i < 4; i++) await h.feed.next()
    await settle()
    expect(h.fetchBatch.mock.calls[0][1].count).toBe(FEED_BATCH)
    expect(h.fetchBatch.mock.calls[0][1].exclude).toEqual([])
    expect(h.fetchBatch.mock.calls.length).toBeGreaterThanOrEqual(2)
    const exclude = h.fetchBatch.mock.calls.at(-1)![1].exclude
    expect(exclude).toEqual(expect.arrayContaining(['live0', 'live1']))
  })

  it('reports an error when the backend is unreachable, with no fallback', async () => {
    const h = harness({ poolPuzzles: null, fetchBatch: async () => Promise.reject(new Error('down')) })
    h.feed.start(mixed)
    expect((await h.feed.next()).kind).toBe('error')
  })

  it('reports none when the backend has no puzzles for the theme', async () => {
    const h = harness({ poolPuzzles: null, fetchBatch: async () => [] })
    h.feed.start({ kind: 'theme', theme: 'zugzwang' })
    expect((await h.feed.next()).kind).toBe('none')
  })

  it('passes the chosen theme to the backend', async () => {
    const h = harness({ poolPuzzles: null })
    h.feed.start({ kind: 'theme', theme: 'pin' })
    await h.feed.next()
    expect(h.fetchBatch.mock.calls[0][0]).toBe('pin')
    h.feed.start(mixed)
    await h.feed.next()
    expect(h.fetchBatch.mock.calls.at(-1)![0]).toBeNull()
  })

  it('does not prefetch while the queue is still comfortable', async () => {
    const h = harness({ poolPuzzles: null, fetchBatch: async () => batch('x', 10) })
    h.feed.start(mixed)
    await h.feed.next()
    await settle()
    expect(h.fetchBatch).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 10 - FEED_LOW_WATER; i++) await h.feed.next()
    await settle()
    expect(h.fetchBatch).toHaveBeenCalledTimes(2)
  })

  it('a failed prefetch is not fatal; the next request retries', async () => {
    let call = 0
    const h = harness({
      poolPuzzles: null,
      fetchBatch: async () => {
        call++
        if (call === 2) throw new Error('blip')
        return batch(`c${call}-`)
      },
    })
    h.feed.start(mixed)
    for (let i = 0; i < 5; i++) expect((await h.feed.next()).kind).toBe('puzzle')
    await settle()
    expect(idOf(await h.feed.next())).toBe('c3-0')
  })
})

describe('with a pool and a healthy backend', () => {
  it('serves live puzzles and never touches the cached ones', async () => {
    const h = harness({ poolPuzzles: batch('pool', 20) })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    expect(h.sleepers).toHaveLength(1)
    expect(h.sleepers[0].ms).toBe(COLD_START_MS)
    const out = await first
    expect(out).toMatchObject({ kind: 'puzzle', source: 'live' })
    expect(idOf(out)).toBe('live0')
    expect(h.feed.source).toBe('live')
    expect(h.watchers).toHaveLength(0)
    expect(h.sources).toEqual([])
    const snap = await h.pool!.snapshot()
    expect(snap.puzzles).toHaveLength(20)
  })

  it('flushes queued results before asking for the live batch', async () => {
    const h = harness({ poolPuzzles: batch('pool', 5) })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    await first
    expect(h.events.slice(0, 2)).toEqual(['flush', 'fetch'])
  })

  it('refreshes the themes when the flush actually synced something', async () => {
    const h = harness({
      poolPuzzles: batch('pool', 5),
      flushResults: async () => 3,
    })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    await first
    await settle()
    expect(h.refreshThemes).toHaveBeenCalledTimes(1)
  })

  it('removes a served live puzzle from the pool if it was cached too', async () => {
    const h = harness({ poolPuzzles: [puzzle('live0'), ...batch('pool', 5)], fetchBatch: async () => batch('live') })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    await first
    await settle()
    const snap = await h.pool!.snapshot()
    expect(snap.puzzles.map((p) => p.id)).not.toContain('live0')
    expect(snap.served).toContain('live0')
  })
})

describe('cold start (backend not answering)', () => {
  it('serves a cached puzzle after three seconds and starts watching the backend', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: batch('pool', 10), fetchBatch: () => live.promise })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    expect(h.sleepers[0].ms).toBe(3000)
    let resolved = false
    void first.then(() => (resolved = true))
    await settle()
    expect(resolved).toBe(false)
    h.sleepers[0].resolve()
    const out = await first
    expect(out).toMatchObject({ kind: 'puzzle', source: 'pool' })
    expect(idOf(out)).toBe('pool0')
    expect(h.feed.source).toBe('pool')
    expect(h.sources).toEqual(['pool'])
    expect(h.watchers).toHaveLength(1)
  })

  it('keeps serving cached puzzles one after another without waiting again', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: batch('pool', 10), fetchBatch: () => live.promise })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    const sleepersBefore = h.sleepers.length
    const ids: string[] = []
    for (let i = 0; i < 4; i++) ids.push(idOf(await h.feed.next()))
    expect(ids).toEqual(['pool1', 'pool2', 'pool3', 'pool4'])
    expect(h.sleepers.length).toBe(sleepersBefore)
    expect(h.watchers).toHaveLength(1)
  })

  it('uses an immediate failure the same way, without waiting three seconds', async () => {
    const h = harness({ poolPuzzles: batch('pool', 3), fetchBatch: async () => Promise.reject(new Error('offline')) })
    h.feed.start(mixed)
    const out = await h.feed.next()
    expect(out).toMatchObject({ kind: 'puzzle', source: 'pool' })
    expect(h.feed.source).toBe('pool')
  })

  it('ignores the late answer of the request that was sent before the fallback', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: batch('pool', 10), fetchBatch: () => live.promise })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    live.resolve(batch('stale', 5))
    await settle()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(idOf(await h.feed.next()))
    expect(ids.every((id) => id.startsWith('pool'))).toBe(true)
  })

  it('switches to live puzzles the moment the backend is back, after flushing results', async () => {
    const live = deferred<PuzzleJSON[]>()
    let call = 0
    let flushed = 0
    let backendBack = false
    const h = harness({
      poolPuzzles: batch('pool', 10),
      fetchBatch: () => (call++ === 0 ? live.promise : Promise.resolve(batch('fresh'))),
      flushResults: async () => {
        h_events.push('flush')
        if (backendBack && flushed++ === 0) return 2
        return 0
      },
    })
    const h_events = h.events
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    await h.feed.next()
    h.events.length = 0
    backendBack = true

    h.watchers[0].onReady()
    await settle()
    await settle()

    expect(h.events).toEqual(['flush', 'themes', 'flush', 'fetch'])
    expect(h.feed.source).toBe('live')
    expect(h.sources).toEqual(['pool', 'live'])
    const next = await h.feed.next()
    expect(next).toMatchObject({ kind: 'puzzle', source: 'live' })
    expect(idOf(next)).toBe('fresh0')
    const snap = await h.pool!.snapshot()
    expect(snap.puzzles.map((p) => p.id)).toContain('pool5')
  })

  it('excludes the cached puzzles already played from the live batch', async () => {
    const live = deferred<PuzzleJSON[]>()
    let call = 0
    const h = harness({
      poolPuzzles: batch('pool', 10),
      fetchBatch: () => (call++ === 0 ? live.promise : Promise.resolve(batch('fresh'))),
    })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    await h.feed.next()
    await h.feed.next()
    h.watchers[0].onReady()
    await settle()
    await settle()
    const exclude = h.fetchBatch.mock.calls.at(-1)![1].exclude
    expect(exclude).toEqual(expect.arrayContaining(['pool0', 'pool1', 'pool2']))
  })

  it('goes back to cached puzzles if the backend drops again right after it answered', async () => {
    let call = 0
    const live = deferred<PuzzleJSON[]>()
    const h = harness({
      poolPuzzles: batch('pool', 10),
      fetchBatch: () => {
        call++
        return call === 1 ? live.promise : Promise.reject(new Error('flaky'))
      },
    })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    h.watchers[0].onReady()
    await settle()
    await settle()
    expect(h.feed.source).toBe('pool')
    expect(h.watchers).toHaveLength(2)
    expect(h.watchers[0].stopped).toBe(false)
    expect(idOf(await h.feed.next())).toBe('pool1')
  })

  it('waits for the backend when the cache is empty instead of failing', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: [], fetchBatch: () => live.promise })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await settle()
    let done = false
    void first.then(() => (done = true))
    await settle()
    expect(done).toBe(false)
    live.resolve(batch('late'))
    const out = await first
    expect(out).toMatchObject({ kind: 'puzzle', source: 'live' })
    expect(idOf(out)).toBe('late0')
    expect(h.watchers).toHaveLength(0)
  })

  it('fails with an error when the backend is down and nothing is cached', async () => {
    const h = harness({ poolPuzzles: [], fetchBatch: async () => Promise.reject(new Error('down')) })
    h.feed.start(mixed)
    expect((await h.feed.next()).kind).toBe('error')
  })

  it('serves cached puzzles for a single theme only from that theme', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({
      poolPuzzles: [puzzle('a', 'pin'), puzzle('b', 'fork'), puzzle('c', 'fork')],
      fetchBatch: () => live.promise,
    })
    h.feed.start({ kind: 'theme', theme: 'fork' })
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    expect(idOf(await first)).toBe('b')
    expect(idOf(await h.feed.next())).toBe('c')
    live.resolve([])
  })

  it('a theme with nothing cached falls back to waiting for the backend', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: batch('pool', 5, 'pin'), fetchBatch: () => live.promise })
    h.feed.start({ kind: 'theme', theme: 'skewer' })
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await settle()
    live.resolve(batch('skew', 5, 'skewer'))
    expect(idOf(await first)).toBe('skew0')
  })

  it('never serves the same puzzle twice across cached and live', async () => {
    const live = deferred<PuzzleJSON[]>()
    let call = 0
    const h = harness({
      poolPuzzles: batch('pool', 6),
      fetchBatch: () => (call++ === 0 ? live.promise : Promise.resolve(batch('fresh', 8))),
    })
    h.feed.start(mixed)
    const seen: string[] = []
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    seen.push(idOf(await first))
    for (let i = 0; i < 3; i++) seen.push(idOf(await h.feed.next()))
    h.watchers[0].onReady()
    await settle()
    await settle()
    for (let i = 0; i < 8; i++) seen.push(idOf(await h.feed.next()))
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('ratings after reconnecting', () => {
  it('refreshes the themes on reconnect even when another part of the app already synced the results', async () => {
    const live = deferred<PuzzleJSON[]>()
    let call = 0
    const h = harness({
      poolPuzzles: batch('pool', 5),
      fetchBatch: () => (call++ === 0 ? live.promise : Promise.resolve(batch('fresh'))),
      flushResults: async () => 0,
    })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    h.watchers[0].onReady()
    await settle()
    await settle()
    expect(h.refreshThemes).toHaveBeenCalledTimes(1)
  })
})

describe('while reconnecting', () => {
  async function coldThenReady(poolSize = 10) {
    const live = deferred<PuzzleJSON[]>()
    const flush = deferred<number>()
    let call = 0
    let flushCalls = 0
    const h = harness({
      poolPuzzles: batch('pool', poolSize),
      fetchBatch: () => (call++ === 0 ? live.promise : Promise.resolve(batch('fresh'))),
      flushResults: () => (flushCalls++ === 0 ? Promise.resolve(0) : flush.promise),
    })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    return { h, flush }
  }

  it('tapping next while results are still syncing waits and then serves a live puzzle', async () => {
    const { h, flush } = await coldThenReady()
    h.watchers[0].onReady()
    await settle()
    const pending = h.feed.next()
    await settle()
    let done = false
    void pending.then(() => (done = true))
    await settle()
    expect(done).toBe(false)
    flush.resolve(2)
    const out = await pending
    expect(out).toMatchObject({ kind: 'puzzle', source: 'live' })
    expect(idOf(out)).toBe('fresh0')
    expect(h.feed.source).toBe('live')
  })

  it('a reconnect that hangs does not trap the player: after three seconds a cached puzzle is served', async () => {
    const { h } = await coldThenReady()
    h.watchers[0].onReady()
    await settle()
    const sleepersBefore = h.sleepers.length
    const pending = h.feed.next()
    await settle()
    h.sleepers.slice(sleepersBefore).forEach((s) => s.resolve())
    const out = await pending
    expect(out).toMatchObject({ kind: 'puzzle' })
    expect(idOf(out)).toMatch(/^pool/)
  })

  it('ignores a second ready signal while already reconnecting', async () => {
    const { h, flush } = await coldThenReady()
    h.watchers[0].onReady()
    h.watchers[0].onReady()
    await settle()
    flush.resolve(0)
    await settle()
    expect(h.flushResults.mock.calls.length).toBeLessThanOrEqual(3)
  })
})

describe('session control', () => {
  it('restarting while waiting makes the old call stale and stops the watcher', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: batch('pool', 5), fetchBatch: () => live.promise })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    expect(h.watchers[0].stopped).toBe(false)
    h.feed.start({ kind: 'theme', theme: 'pin' })
    expect(h.watchers[0].stopped).toBe(true)
    expect(h.feed.source).toBe('live')
    expect(h.sources).toEqual(['pool', 'live'])
  })

  it('a call that was waiting when the session was restarted comes back stale', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: [], fetchBatch: () => live.promise })
    h.feed.start(mixed)
    const pending = h.feed.next()
    await settle()
    h.feed.start(mixed)
    live.resolve(batch('old'))
    expect((await pending).kind).toBe('stale')
  })

  it('stopping clears the queue and the watcher, and next() then does nothing', async () => {
    const live = deferred<PuzzleJSON[]>()
    const h = harness({ poolPuzzles: batch('pool', 5), fetchBatch: () => live.promise })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    h.sleepers[0].resolve()
    await first
    h.feed.stop()
    expect(h.watchers[0].stopped).toBe(true)
    expect((await h.feed.next()).kind).toBe('stale')
  })

  it('a backend report of being unreachable moves to cached puzzles', async () => {
    const h = harness({ poolPuzzles: batch('pool', 5) })
    h.feed.start(mixed)
    const first = h.feed.next()
    await settle()
    await first
    h.feed.markBackendUnreachable()
    expect(h.feed.source).toBe('pool')
    expect(h.watchers).toHaveLength(1)
    h.feed.markBackendUnreachable()
    expect(h.watchers).toHaveLength(1)
    const out = await h.feed.next()
    expect(out).toMatchObject({ kind: 'puzzle', source: 'live' })
  })

  it('markBackendUnreachable is ignored on desktop devices', async () => {
    const h = harness({ poolPuzzles: null })
    h.feed.start(mixed)
    await h.feed.next()
    h.feed.markBackendUnreachable()
    expect(h.feed.source).toBe('live')
    expect(h.watchers).toHaveLength(0)
  })

  it('exposes whether it can use a pool and how many puzzles are queued', async () => {
    const withPool = harness({ poolPuzzles: [] })
    const without = harness({ poolPuzzles: null })
    expect(withPool.feed.offlineCapable).toBe(true)
    expect(without.feed.offlineCapable).toBe(false)
    without.feed.start(mixed)
    expect(without.feed.queued).toBe(0)
    await without.feed.next()
    expect(without.feed.queued).toBe(FEED_BATCH - 1)
  })
})

import { describe, expect, it } from 'vitest'
import type { PuzzleJSON } from '@/lib/api/client'
import {
  POOL_BATCH,
  POOL_LOW_WATER,
  POOL_MAX_AGE_MS,
  POOL_SIZE,
  PuzzlePool,
  SERVED_MEMORY,
  emptyPool,
  excludeIdsFor,
  isStale,
  mergeIntoPool,
  noteServed,
  poolNeedsRefill,
  takeFromPool,
  type PoolState,
  type PoolStore,
} from './pool'

function puzzle(id: string, theme = 'fork'): PuzzleJSON {
  return { id, fen: 'f', moves: 'e2e4', rating: 2000, themes: [theme], theme, themeRating: 2000, mixed: true }
}

const many = (n: number, prefix = 'p', theme = 'fork') => Array.from({ length: n }, (_, i) => puzzle(`${prefix}${i}`, theme))

function memoryStore(initial?: PoolState): PoolStore & { state: PoolState | undefined; writes: number } {
  const store = {
    state: initial,
    writes: 0,
    async read() {
      return store.state
    },
    async write(state: PoolState) {
      store.state = state
      store.writes++
    },
  }
  return store
}

describe('pool state helpers', () => {
  it('needs a refill when low or stale, not when full and fresh', () => {
    const now = 1_000_000
    const full: PoolState = { puzzles: many(POOL_SIZE), served: [], fetchedAt: now }
    expect(poolNeedsRefill(full, now)).toBe(false)
    expect(poolNeedsRefill({ ...full, puzzles: many(POOL_LOW_WATER - 1) }, now)).toBe(true)
    expect(poolNeedsRefill({ ...full, puzzles: many(POOL_LOW_WATER) }, now)).toBe(false)
    expect(poolNeedsRefill(full, now + POOL_MAX_AGE_MS + 1)).toBe(true)
    expect(poolNeedsRefill(emptyPool(), now)).toBe(true)
  })

  it('an empty pool is not stale, only low', () => {
    expect(isStale(emptyPool(), Date.now())).toBe(false)
  })

  it('taking a puzzle removes it and remembers it as served', () => {
    const state: PoolState = { puzzles: [puzzle('a'), puzzle('b')], served: ['old'], fetchedAt: 1 }
    const { puzzle: taken, state: next } = takeFromPool(state, null)
    expect(taken?.id).toBe('a')
    expect(next.puzzles.map((p) => p.id)).toEqual(['b'])
    expect(next.served).toEqual(['old', 'a'])
    expect(state.puzzles).toHaveLength(2)
  })

  it('filters by theme when asked and leaves other themes alone', () => {
    const state: PoolState = { puzzles: [puzzle('a', 'pin'), puzzle('b', 'fork'), puzzle('c', 'fork')], served: [], fetchedAt: 1 }
    const { puzzle: taken, state: next } = takeFromPool(state, 'fork')
    expect(taken?.id).toBe('b')
    expect(next.puzzles.map((p) => p.id)).toEqual(['a', 'c'])
    expect(takeFromPool(state, 'skewer').puzzle).toBeNull()
    expect(takeFromPool(state, 'skewer').state).toBe(state)
  })

  it('caps the served memory and does not duplicate ids', () => {
    let state: PoolState = emptyPool()
    for (let i = 0; i < SERVED_MEMORY + 20; i++) state = noteServed(state, `s${i}`)
    expect(state.served).toHaveLength(SERVED_MEMORY)
    expect(state.served.at(-1)).toBe(`s${SERVED_MEMORY + 19}`)
    const again = noteServed(state, `s${SERVED_MEMORY + 19}`)
    expect(again.served.filter((id) => id === `s${SERVED_MEMORY + 19}`)).toHaveLength(1)
  })

  it('merging skips duplicates and served ids and caps the size', () => {
    const state: PoolState = { puzzles: [puzzle('a')], served: ['seen'], fetchedAt: 1 }
    const merged = mergeIntoPool(state, [puzzle('a'), puzzle('seen'), puzzle('b'), puzzle('b')], 99)
    expect(merged.puzzles.map((p) => p.id)).toEqual(['a', 'b'])
    expect(merged.fetchedAt).toBe(99)
    const capped = mergeIntoPool(emptyPool(), many(POOL_SIZE + 30), 5)
    expect(capped.puzzles).toHaveLength(POOL_SIZE)
  })

  it('replacing drops the old puzzles but still skips served ids', () => {
    const state: PoolState = { puzzles: many(10, 'old'), served: ['x'], fetchedAt: 1 }
    const merged = mergeIntoPool(state, [puzzle('x'), puzzle('n1')], 7, true)
    expect(merged.puzzles.map((p) => p.id)).toEqual(['n1'])
  })

  it('builds an exclude list of at most 100 ids with the newest last', () => {
    const state: PoolState = { puzzles: many(80, 'pool'), served: many(60, 'served').map((p) => p.id), fetchedAt: 1 }
    const exclude = excludeIdsFor(state, many(5, 'new'))
    expect(exclude).toHaveLength(100)
    expect(exclude.at(-1)).toBe('new4')
    expect(exclude).toContain('pool79')
  })
})

describe('PuzzlePool', () => {
  it('starts empty and reports that it needs a refill', async () => {
    const pool = new PuzzlePool(memoryStore())
    expect(await pool.size()).toBe(0)
    expect(await pool.needsRefill()).toBe(true)
    expect(await pool.take(null)).toBeNull()
  })

  it('fills up to the pool size in batches of ten', async () => {
    const store = memoryStore()
    const pool = new PuzzlePool(store, () => 1000)
    let call = 0
    const sizes: number[] = []
    const added = await pool.refill(async (exclude) => {
      sizes.push(exclude.length)
      return many(POOL_BATCH, `b${call++}-`)
    })
    expect(added).toBe(POOL_SIZE)
    expect(await pool.size()).toBe(POOL_SIZE)
    expect(call).toBe(POOL_SIZE / POOL_BATCH)
    expect(sizes[0]).toBe(0)
    expect(sizes[5]).toBe(50)
    expect(store.state?.fetchedAt).toBe(1000)
    expect(await pool.needsRefill()).toBe(false)
  })

  it('does nothing when the pool is already full and fresh', async () => {
    const pool = new PuzzlePool(memoryStore({ puzzles: many(POOL_SIZE), served: [], fetchedAt: 5 }), () => 5)
    let calls = 0
    expect(
      await pool.refill(async () => {
        calls++
        return []
      }),
    ).toBe(0)
    expect(calls).toBe(0)
  })

  it('keeps what it got when the backend fails part way', async () => {
    const pool = new PuzzlePool(memoryStore(), () => 1)
    let call = 0
    const added = await pool.refill(async () => {
      if (call++ === 3) throw new Error('backend went away')
      return many(POOL_BATCH, `b${call}-`)
    })
    expect(added).toBe(30)
    expect(await pool.size()).toBe(30)
  })

  it('stops when the backend has nothing more to give', async () => {
    const pool = new PuzzlePool(memoryStore(), () => 1)
    let call = 0
    await pool.refill(async () => (call++ === 0 ? many(4) : []))
    expect(await pool.size()).toBe(4)
    expect(call).toBe(2)
  })

  it('does not add the same puzzle twice if the backend repeats itself', async () => {
    const pool = new PuzzlePool(memoryStore(), () => 1)
    let call = 0
    await pool.refill(async () => (call++ < 3 ? many(POOL_BATCH, 'same') : []))
    expect(await pool.size()).toBe(POOL_BATCH)
  })

  it('rebuilds a stale pool from new puzzles without emptying it first', async () => {
    const old = many(50, 'old')
    const store = memoryStore({ puzzles: old, served: ['gone'], fetchedAt: 0 })
    const pool = new PuzzlePool(store, () => POOL_MAX_AGE_MS + 10)
    let call = 0
    let sawOldDuringRefill = 0
    await pool.refill(async (exclude) => {
      sawOldDuringRefill = Math.min(sawOldDuringRefill || 999, store.state?.puzzles.length ?? 0)
      if (call === 0) expect(exclude).toContain('old0')
      expect(exclude.length).toBeLessThanOrEqual(100)
      return many(POOL_BATCH, `fresh${call++}-`)
    })
    expect(sawOldDuringRefill).toBe(50)
    const ids = (await pool.snapshot()).puzzles.map((p) => p.id)
    expect(ids).toHaveLength(POOL_SIZE)
    expect(ids.every((id) => id.startsWith('fresh'))).toBe(true)
    expect(store.state?.served).toEqual(['gone'])
  })

  it('keeps the old puzzles when a stale rebuild gets almost nothing', async () => {
    const pool = new PuzzlePool(memoryStore({ puzzles: many(60, 'old'), served: [], fetchedAt: 0 }), () => POOL_MAX_AGE_MS + 10)
    let call = 0
    await pool.refill(async () => (call++ === 0 ? many(5, 'fresh') : []))
    const ids = (await pool.snapshot()).puzzles.map((p) => p.id)
    expect(ids).toHaveLength(65)
    expect(ids).toContain('old0')
    expect(ids).toContain('fresh0')
  })

  it('runs only one refill at a time', async () => {
    const pool = new PuzzlePool(memoryStore(), () => 1)
    let calls = 0
    const gate = { release: () => {} }
    const wait = new Promise<void>((resolve) => (gate.release = resolve))
    const first = pool.refill(async () => {
      calls++
      await wait
      return calls > 1 ? [] : many(POOL_BATCH)
    })
    const second = pool.refill(async () => {
      calls += 100
      return []
    })
    gate.release()
    await Promise.all([first, second])
    expect(calls).toBeLessThan(100)
  })

  it('serializes takes so two callers never get the same puzzle', async () => {
    const pool = new PuzzlePool(memoryStore({ puzzles: many(5), served: [], fetchedAt: 1 }))
    const taken = await Promise.all([pool.take(null), pool.take(null), pool.take(null), pool.take(null), pool.take(null), pool.take(null)])
    const ids = taken.filter(Boolean).map((p) => p!.id)
    expect(new Set(ids).size).toBe(5)
    expect(taken[5]).toBeNull()
  })

  it('noteServed removes the puzzle from the pool and remembers it', async () => {
    const pool = new PuzzlePool(memoryStore({ puzzles: many(3), served: [], fetchedAt: 1 }))
    await pool.noteServed('p1')
    const snap = await pool.snapshot()
    expect(snap.puzzles.map((p) => p.id)).toEqual(['p0', 'p2'])
    expect(snap.served).toEqual(['p1'])
  })

  it('survives a failed write without losing later operations', async () => {
    let fail = true
    const store: PoolStore = {
      async read() {
        return { puzzles: many(2), served: [], fetchedAt: 1 }
      },
      async write() {
        if (fail) throw new Error('disk full')
      },
    }
    const pool = new PuzzlePool(store)
    await expect(pool.take(null)).rejects.toThrow('disk full')
    fail = false
    expect((await pool.take(null))?.id).toBe('p0')
  })
})

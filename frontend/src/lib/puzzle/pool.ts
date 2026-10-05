import type { PuzzleJSON } from '@/lib/api/client'

export const POOL_SIZE = 100
export const POOL_LOW_WATER = 40
export const POOL_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const POOL_BATCH = 10
export const POOL_MAX_FETCHES = 20
export const SERVED_MEMORY = 100
const EXCLUDE_LIMIT = 100

export interface PoolState {
  puzzles: PuzzleJSON[]
  served: string[]
  fetchedAt: number
}

export interface PoolStore {
  read(): Promise<PoolState | undefined>
  write(state: PoolState): Promise<void>
}

export const emptyPool = (): PoolState => ({ puzzles: [], served: [], fetchedAt: 0 })

export function isStale(state: PoolState, now: number): boolean {
  return state.puzzles.length > 0 && now - state.fetchedAt > POOL_MAX_AGE_MS
}

export function poolNeedsRefill(state: PoolState, now: number): boolean {
  return state.puzzles.length < POOL_LOW_WATER || isStale(state, now)
}

export function rememberServed(served: string[], id: string): string[] {
  return [...served.filter((s) => s !== id), id].slice(-SERVED_MEMORY)
}

export function noteServed(state: PoolState, id: string): PoolState {
  const puzzles = state.puzzles.filter((p) => p.id !== id)
  const served = rememberServed(state.served, id)
  if (puzzles.length === state.puzzles.length && served.length === state.served.length && served[served.length - 1] === state.served[state.served.length - 1]) return state
  return { ...state, puzzles, served }
}

export function takeFromPool(state: PoolState, theme: string | null): { puzzle: PuzzleJSON | null; state: PoolState } {
  const puzzle = state.puzzles.find((p) => !theme || p.theme === theme) ?? null
  if (!puzzle) return { puzzle: null, state }
  return { puzzle, state: noteServed(state, puzzle.id) }
}

export function mergeIntoPool(state: PoolState, incoming: PuzzleJSON[], now: number, replaceExisting = false): PoolState {
  const base = replaceExisting ? [] : state.puzzles
  const known = new Set([...base.map((p) => p.id), ...state.served])
  const added: PuzzleJSON[] = []
  for (const p of incoming) {
    if (known.has(p.id)) continue
    known.add(p.id)
    added.push(p)
  }
  return { ...state, puzzles: [...base, ...added].slice(0, POOL_SIZE), fetchedAt: now }
}

export function excludeIdsFor(state: PoolState, pending: PuzzleJSON[]): string[] {
  return [...state.served, ...state.puzzles.map((p) => p.id), ...pending.map((p) => p.id)].slice(-EXCLUDE_LIMIT)
}

export type FetchPoolBatch = (exclude: string[]) => Promise<PuzzleJSON[]>

export class PuzzlePool {
  private chain: Promise<unknown> = Promise.resolve()
  private refilling: Promise<number> | null = null

  constructor(
    private store: PoolStore,
    private now: () => number = Date.now,
  ) {}

  private update<T>(fn: (state: PoolState) => { state: PoolState; value: T }): Promise<T> {
    const run = this.chain.then(async () => {
      const current = (await this.store.read()) ?? emptyPool()
      const { state, value } = fn(current)
      if (state !== current) await this.store.write(state)
      return value
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  size(): Promise<number> {
    return this.update((s) => ({ state: s, value: s.puzzles.length }))
  }

  snapshot(): Promise<PoolState> {
    return this.update((s) => ({ state: s, value: s }))
  }

  needsRefill(): Promise<boolean> {
    return this.update((s) => ({ state: s, value: poolNeedsRefill(s, this.now()) }))
  }

  take(theme: string | null): Promise<PuzzleJSON | null> {
    return this.update((s) => {
      const taken = takeFromPool(s, theme)
      return { state: taken.state, value: taken.puzzle }
    })
  }

  noteServed(id: string): Promise<void> {
    return this.update((s) => ({ state: noteServed(s, id), value: undefined }))
  }

  refill(fetchBatch: FetchPoolBatch): Promise<number> {
    if (this.refilling) return this.refilling
    const run = this.runRefill(fetchBatch).finally(() => {
      this.refilling = null
    })
    this.refilling = run
    return run
  }

  private async runRefill(fetchBatch: FetchPoolBatch): Promise<number> {
    const initial = await this.snapshot()
    const stale = isStale(initial, this.now())
    if (!stale && !poolNeedsRefill(initial, this.now())) return 0
    const collected: PuzzleJSON[] = []
    for (let i = 0; i < POOL_MAX_FETCHES; i++) {
      const current = await this.snapshot()
      const have = stale ? collected.length : current.puzzles.length
      if (have >= POOL_SIZE) break
      let batch: PuzzleJSON[]
      try {
        batch = await fetchBatch(excludeIdsFor(current, stale ? collected : []))
      } catch {
        break
      }
      if (batch.length === 0) break
      if (stale) {
        const seen = new Set(collected.map((p) => p.id))
        collected.push(...batch.filter((p) => !seen.has(p.id)))
      } else {
        await this.update((s) => ({ state: mergeIntoPool(s, batch, this.now()), value: undefined }))
        collected.push(...batch)
      }
    }
    if (stale && collected.length > 0) {
      const replace = collected.length >= POOL_LOW_WATER
      await this.update((s) => ({ state: mergeIntoPool(s, collected, this.now(), replace), value: undefined }))
    }
    return collected.length
  }
}

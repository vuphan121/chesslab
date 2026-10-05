import type { PuzzleJSON } from '@/lib/api/client'
import type { PuzzlePool } from './pool'
import { rememberServed } from './pool'
import { watchBackendReady, type WatchDeps } from './backendWatch'

export const FEED_BATCH = 5
export const FEED_LOW_WATER = 2
export const COLD_START_MS = 3000
const SERVED_MEMORY = 40

export type FeedMode = { kind: 'mixed' } | { kind: 'theme'; theme: string }
export type FeedSource = 'live' | 'pool'

export interface FeedDeps {
  fetchBatch: (theme: string | null, opts: { count: number; exclude: string[] }) => Promise<PuzzleJSON[]>
  pool: PuzzlePool | null
  flushResults: () => Promise<number>
  refreshThemes: () => Promise<void>
  checkHealth: () => Promise<boolean>
  canPing?: () => boolean
  sleep?: (ms: number) => Promise<void>
  watch?: (onReady: () => void, deps: WatchDeps) => () => void
  coldStartMs?: number
  onSourceChange?: (source: FeedSource) => void
}

export type NextResult =
  | { kind: 'puzzle'; puzzle: PuzzleJSON; source: FeedSource }
  | { kind: 'none' }
  | { kind: 'error' }
  | { kind: 'stale' }

const STALE: NextResult = { kind: 'stale' }

export class PuzzleFeed {
  private mode: FeedMode | null = null
  private gen = 0
  private epoch = 0
  private queue: PuzzleJSON[] = []
  private served: string[] = []
  private currentId: string | null = null
  private fetching: Promise<void> | null = null
  private poolMode = false
  private stopWatch: (() => void) | null = null
  private reconnecting: Promise<void> | null = null

  constructor(private deps: FeedDeps) {}

  get source(): FeedSource {
    return this.poolMode ? 'pool' : 'live'
  }

  get queued(): number {
    return this.queue.length
  }

  get offlineCapable(): boolean {
    return this.deps.pool !== null
  }

  start(mode: FeedMode): void {
    this.reset()
    this.mode = mode
  }

  stop(): void {
    this.reset()
    this.mode = null
  }

  private reset(): void {
    this.gen++
    this.epoch++
    this.queue = []
    this.served = []
    this.currentId = null
    this.fetching = null
    this.reconnecting = null
    this.stopWatching()
    this.setPoolMode(false)
  }

  private stopWatching(): void {
    this.stopWatch?.()
    this.stopWatch = null
  }

  private setPoolMode(value: boolean): void {
    if (this.poolMode === value) return
    this.poolMode = value
    this.deps.onSourceChange?.(value ? 'pool' : 'live')
  }

  private get theme(): string | null {
    return this.mode?.kind === 'theme' ? this.mode.theme : null
  }

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? ((n) => new Promise<void>((resolve) => setTimeout(resolve, n))))(ms)
  }

  async next(): Promise<NextResult> {
    if (!this.mode) return STALE
    const gen = this.gen
    if (this.queue.length === 0) {
      const filled = await this.fill(gen)
      if (filled) return filled
    }
    if (gen !== this.gen) return STALE
    const puzzle = this.queue.shift()
    if (!puzzle) return { kind: 'none' }
    this.markServed(puzzle)
    this.prefetch()
    return { kind: 'puzzle', puzzle, source: 'live' }
  }

  markBackendUnreachable(): void {
    if (this.deps.pool && this.mode) this.enterPoolMode()
  }

  private async fill(gen: number): Promise<NextResult | null> {
    if (this.reconnecting) {
      await Promise.race([this.reconnecting.catch(() => undefined), this.sleep(this.deps.coldStartMs ?? COLD_START_MS)])
      if (gen !== this.gen) return STALE
      if (this.queue.length > 0) return null
    }
    const pool = this.deps.pool
    if (pool && this.poolMode) {
      const cached = await pool.take(this.theme)
      if (gen !== this.gen) return STALE
      if (cached) return this.servePool(cached)
    }

    const live = this.requestLive()
    if (!pool) {
      try {
        await live
      } catch {
        return gen !== this.gen ? STALE : { kind: 'error' }
      }
      return gen !== this.gen ? STALE : null
    }

    const winner = await Promise.race([
      live.then(
        () => 'ok' as const,
        () => 'error' as const,
      ),
      this.sleep(this.deps.coldStartMs ?? COLD_START_MS).then(() => 'slow' as const),
    ])
    if (gen !== this.gen) return STALE
    if (winner === 'ok') return null

    const cached = await pool.take(this.theme)
    if (gen !== this.gen) return STALE
    if (cached) {
      this.enterPoolMode()
      return this.servePool(cached)
    }
    if (winner === 'slow') {
      try {
        await live
      } catch {
        return gen !== this.gen ? STALE : { kind: 'error' }
      }
      return gen !== this.gen ? STALE : null
    }
    return { kind: 'error' }
  }

  private servePool(puzzle: PuzzleJSON): NextResult {
    this.markServed(puzzle)
    return { kind: 'puzzle', puzzle, source: 'pool' }
  }

  private markServed(puzzle: PuzzleJSON): void {
    this.served = rememberServed(this.served, puzzle.id).slice(-SERVED_MEMORY)
    this.currentId = puzzle.id
    void this.deps.pool?.noteServed(puzzle.id).catch(() => {})
  }

  private prefetch(): void {
    if (!this.mode || this.fetching || this.poolMode || this.queue.length > FEED_LOW_WATER) return
    this.requestLive().catch(() => {})
  }

  private requestLive(): Promise<void> {
    if (this.fetching) return this.fetching
    const gen = this.gen
    const epoch = this.epoch
    const theme = this.theme
    const self: { promise?: Promise<void> } = {}
    const promise = (async () => {
      try {
        if (this.deps.pool) {
          const flushed = await this.deps.flushResults().catch(() => 0)
          if (flushed > 0) void this.deps.refreshThemes().catch(() => {})
        }
        if (gen !== this.gen || epoch !== this.epoch) return
        const exclude = [
          ...this.served,
          ...this.queue.map((p) => p.id),
          ...(this.currentId ? [this.currentId] : []),
        ]
        const list = await this.deps.fetchBatch(theme, { count: FEED_BATCH, exclude })
        if (gen === this.gen && epoch === this.epoch) this.queue.push(...list)
      } finally {
        if (this.fetching === self.promise) this.fetching = null
      }
    })()
    self.promise = promise
    this.fetching = promise
    return promise
  }

  private enterPoolMode(): void {
    if (this.poolMode || !this.mode) return
    this.epoch++
    this.fetching = null
    this.setPoolMode(true)
    const watch = this.deps.watch ?? watchBackendReady
    this.stopWatch = watch(() => this.onBackendReady(), {
      ping: this.deps.checkHealth,
      canPing: this.deps.canPing,
    })
  }

  private onBackendReady(): void {
    if (this.reconnecting) return
    const gen = this.gen
    this.stopWatch = null
    const run = (async () => {
      await this.deps.flushResults().catch(() => 0)
      if (gen !== this.gen) return
      this.setPoolMode(false)
      void this.deps.refreshThemes().catch(() => {})
      try {
        await this.requestLive()
      } catch {
        if (gen === this.gen) this.enterPoolMode()
      }
    })()
    const tracked = run.finally(() => {
      if (this.reconnecting === tracked) this.reconnecting = null
    })
    this.reconnecting = tracked
  }
}

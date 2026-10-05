export interface PuzzleResultPayload {
  operationId: string
  puzzleId: string
  theme: string
  solved: boolean
  playedAt: string
}

export interface QueuedPuzzleResult extends PuzzleResultPayload {
  kind: 'puzzle-result'
}

export function isQueuedPuzzleResult(payload: unknown): payload is QueuedPuzzleResult {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<QueuedPuzzleResult>
  return value.kind === 'puzzle-result'
    && typeof value.operationId === 'string'
    && typeof value.puzzleId === 'string'
    && typeof value.theme === 'string'
    && typeof value.solved === 'boolean'
    && typeof value.playedAt === 'string'
}

export interface FlushOutcome {
  flushed: number
  dropped: number
  blocked: boolean
}

export interface ResultQueueDeps {
  enqueue: (payload: QueuedPuzzleResult) => Promise<boolean>
  list: () => Promise<{ id: string; queuedAt: number; payload: unknown }[]>
  remove: (id: string) => Promise<void>
  post: (payload: PuzzleResultPayload) => Promise<unknown>
  shouldRetryLater: (err: unknown) => boolean
}

export function createPuzzleResultQueue(deps: ResultQueueDeps) {
  let running: Promise<FlushOutcome> | null = null
  let again = false

  async function drain(): Promise<FlushOutcome> {
    const outcome: FlushOutcome = { flushed: 0, dropped: 0, blocked: false }
    const done = new Set<string>()
    while (true) {
      const items = (await deps.list())
        .filter((item) => !done.has(item.id) && isQueuedPuzzleResult(item.payload))
        .sort((a, b) => a.queuedAt - b.queuedAt || (a.id < b.id ? -1 : 1))
      if (items.length === 0) {
        if (again) {
          again = false
          continue
        }
        return outcome
      }
      for (const item of items) {
        const { kind: _kind, ...payload } = item.payload as QueuedPuzzleResult
        void _kind
        try {
          await deps.post(payload)
          outcome.flushed++
        } catch (err) {
          if (deps.shouldRetryLater(err)) {
            outcome.blocked = true
            return outcome
          }
          outcome.dropped++
        }
        await deps.remove(item.id)
        done.add(item.id)
      }
    }
  }

  function flush(): Promise<FlushOutcome> {
    if (running) {
      again = true
      return running
    }
    again = false
    const current = drain()
      .catch((): FlushOutcome => ({ flushed: 0, dropped: 0, blocked: true }))
      .finally(() => {
        running = null
        if (again) {
          again = false
          void flush()
        }
      })
    running = current
    return current
  }

  return {
    queue(payload: PuzzleResultPayload): Promise<boolean> {
      return deps.enqueue({ kind: 'puzzle-result', ...payload })
    },
    flush,
  }
}

export interface RecordDeps<R> {
  flush: () => Promise<FlushOutcome>
  queue: (payload: PuzzleResultPayload) => Promise<boolean>
  submit: (payload: PuzzleResultPayload, withTimeout: boolean) => Promise<R>
  isRetryable: (err: unknown) => boolean
}

export async function recordWithQueue<R>(
  deps: RecordDeps<R>,
  payload: PuzzleResultPayload,
  opts: { offlineCapable: boolean; queueOnly?: boolean },
): Promise<{ result: R | null; queued: boolean }> {
  if (!opts.offlineCapable) return { result: await deps.submit(payload, false), queued: false }
  if (opts.queueOnly) {
    if (!(await deps.queue(payload))) throw new Error('Could not save that result.')
    return { result: null, queued: true }
  }
  const outcome = await deps.flush()
  if (!outcome.blocked) {
    try {
      return { result: await deps.submit(payload, true), queued: false }
    } catch (err) {
      if (!deps.isRetryable(err)) throw err
    }
  }
  if (!(await deps.queue(payload))) throw new Error('Could not save that result.')
  return { result: null, queued: true }
}

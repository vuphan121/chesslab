import { describe, expect, it, vi } from 'vitest'
import {
  createPuzzleResultQueue,
  isQueuedPuzzleResult,
  recordWithQueue,
  type FlushOutcome,
  type PuzzleResultPayload,
  type QueuedPuzzleResult,
} from './resultQueue'

function result(id: string, solved = true, playedAt = '2026-10-05T10:00:00.000Z'): PuzzleResultPayload {
  return { operationId: `op-${id}`, puzzleId: `puzzle-${id}`, theme: 'fork', solved, playedAt }
}

class Outbox {
  items: { id: string; queuedAt: number; payload: unknown }[] = []
  private n = 0
  enqueue = async (payload: unknown) => {
    this.n++
    this.items.push({ id: `item-${String(this.n).padStart(3, '0')}`, queuedAt: this.n, payload })
    return true
  }
  list = async () => [...this.items]
  remove = async (id: string) => {
    this.items = this.items.filter((i) => i.id !== id)
  }
}

const retryLater = (err: unknown) => err instanceof Error && err.message === 'network'

function setup(post: (p: PuzzleResultPayload) => Promise<unknown>) {
  const outbox = new Outbox()
  const queue = createPuzzleResultQueue({
    enqueue: (p: QueuedPuzzleResult) => outbox.enqueue(p),
    list: outbox.list,
    remove: outbox.remove,
    post,
    shouldRetryLater: retryLater,
  })
  return { outbox, queue }
}

describe('isQueuedPuzzleResult', () => {
  it('accepts a complete queued result and rejects look-alikes', () => {
    expect(isQueuedPuzzleResult({ kind: 'puzzle-result', ...result('a') })).toBe(true)
    expect(isQueuedPuzzleResult({ ...result('a') })).toBe(false)
    expect(isQueuedPuzzleResult({ kind: 'progress', repertoireId: 'x', cards: {} })).toBe(false)
    expect(isQueuedPuzzleResult({ kind: 'puzzle-result', ...result('a'), playedAt: undefined })).toBe(false)
    expect(isQueuedPuzzleResult(null)).toBe(false)
  })
})

describe('createPuzzleResultQueue', () => {
  it('replays queued results oldest first and clears them', async () => {
    const posted: string[] = []
    const { outbox, queue } = setup(async (p) => void posted.push(p.puzzleId))
    await queue.queue(result('1'))
    await queue.queue(result('2'))
    await queue.queue(result('3'))
    const outcome = await queue.flush()
    expect(posted).toEqual(['puzzle-1', 'puzzle-2', 'puzzle-3'])
    expect(outcome).toEqual({ flushed: 3, dropped: 0, blocked: false })
    expect(outbox.items).toHaveLength(0)
  })

  it('sends the played-at time and operation id and not the internal kind', async () => {
    const seen: unknown[] = []
    const { queue } = setup(async (p) => void seen.push(p))
    await queue.queue(result('1', false, '2026-10-05T08:15:00.000Z'))
    await queue.flush()
    expect(seen[0]).toEqual({
      operationId: 'op-1',
      puzzleId: 'puzzle-1',
      theme: 'fork',
      solved: false,
      playedAt: '2026-10-05T08:15:00.000Z',
    })
  })

  it('stops at the first network failure and keeps the rest in order', async () => {
    let up = false
    const posted: string[] = []
    const { outbox, queue } = setup(async (p) => {
      if (!up) throw new Error('network')
      posted.push(p.puzzleId)
    })
    await queue.queue(result('1'))
    await queue.queue(result('2'))
    const first = await queue.flush()
    expect(first).toEqual({ flushed: 0, dropped: 0, blocked: true })
    expect(outbox.items).toHaveLength(2)
    up = true
    const second = await queue.flush()
    expect(second.flushed).toBe(2)
    expect(posted).toEqual(['puzzle-1', 'puzzle-2'])
  })

  it('keeps earlier results that already synced when the connection drops half way', async () => {
    let calls = 0
    const { outbox, queue } = setup(async () => {
      if (++calls === 3) throw new Error('network')
    })
    for (const id of ['1', '2', '3', '4']) await queue.queue(result(id))
    const outcome = await queue.flush()
    expect(outcome.flushed).toBe(2)
    expect(outcome.blocked).toBe(true)
    expect(outbox.items.map((i) => (i.payload as QueuedPuzzleResult).puzzleId)).toEqual(['puzzle-3', 'puzzle-4'])
  })

  it('drops a result the server permanently rejects and carries on', async () => {
    const posted: string[] = []
    const { outbox, queue } = setup(async (p) => {
      if (p.puzzleId === 'puzzle-2') throw new Error('400 unknown puzzle')
      posted.push(p.puzzleId)
    })
    await queue.queue(result('1'))
    await queue.queue(result('2'))
    await queue.queue(result('3'))
    const outcome = await queue.flush()
    expect(outcome).toEqual({ flushed: 2, dropped: 1, blocked: false })
    expect(posted).toEqual(['puzzle-1', 'puzzle-3'])
    expect(outbox.items).toHaveLength(0)
  })

  it('ignores outbox items that belong to other features', async () => {
    const posted: string[] = []
    const { outbox, queue } = setup(async (p) => void posted.push(p.puzzleId))
    await outbox.enqueue({ kind: 'progress', repertoireId: 'catalan-white', cards: {} })
    await outbox.enqueue({ kind: 'today-training-advance', repertoireId: 'x', cardId: 'y', queueDate: 'd', operationId: 'o' })
    await queue.queue(result('1'))
    await queue.flush()
    expect(posted).toEqual(['puzzle-1'])
    expect(outbox.items).toHaveLength(2)
  })

  it('runs one flush at a time and picks up results added while it runs', async () => {
    const posted: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { queue } = setup(async (p) => {
      if (p.puzzleId === 'puzzle-1') await gate
      posted.push(p.puzzleId)
    })
    await queue.queue(result('1'))
    const first = queue.flush()
    await Promise.resolve()
    await queue.queue(result('2'))
    const second = queue.flush()
    release()
    await Promise.all([first, second])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(posted).toEqual(['puzzle-1', 'puzzle-2'])
  })

  it('does not post the same result twice when flush is called concurrently', async () => {
    const post = vi.fn(async () => undefined)
    const { queue } = setup(post)
    await queue.queue(result('1'))
    await Promise.all([queue.flush(), queue.flush(), queue.flush()])
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('reports a failure to read the outbox as blocked instead of throwing', async () => {
    const queue = createPuzzleResultQueue({
      enqueue: async () => true,
      list: async () => {
        throw new Error('idb broke')
      },
      remove: async () => {},
      post: async () => undefined,
      shouldRetryLater: () => false,
    })
    await expect(queue.flush()).resolves.toEqual({ flushed: 0, dropped: 0, blocked: true })
  })
})

describe('recordWithQueue', () => {
  const ok: FlushOutcome = { flushed: 0, dropped: 0, blocked: false }
  const blocked: FlushOutcome = { flushed: 0, dropped: 0, blocked: true }

  function deps(overrides: Partial<Parameters<typeof recordWithQueue<string>>[0]> = {}) {
    const calls: string[] = []
    const d = {
      flush: vi.fn(async () => (calls.push('flush'), ok)),
      queue: vi.fn(async () => (calls.push('queue'), true)),
      submit: vi.fn(async () => (calls.push('submit'), 'server-result')),
      isRetryable: retryLater,
      ...overrides,
    }
    return { d, calls }
  }

  it('desktop devices submit directly and never touch the queue', async () => {
    const { d, calls } = deps()
    const out = await recordWithQueue(d, result('1'), { offlineCapable: false })
    expect(out).toEqual({ result: 'server-result', queued: false })
    expect(calls).toEqual(['submit'])
    expect(d.submit).toHaveBeenCalledWith(expect.anything(), false)
  })

  it('desktop devices surface a failure instead of queueing', async () => {
    const { d } = deps({ submit: vi.fn(async () => Promise.reject(new Error('network'))) })
    await expect(recordWithQueue(d, result('1'), { offlineCapable: false })).rejects.toThrow('network')
    expect(d.queue).not.toHaveBeenCalled()
  })

  it('online: flushes older results first, then submits the new one live', async () => {
    const { d, calls } = deps()
    const out = await recordWithQueue(d, result('1'), { offlineCapable: true })
    expect(out).toEqual({ result: 'server-result', queued: false })
    expect(calls).toEqual(['flush', 'submit'])
    expect(d.submit).toHaveBeenCalledWith(expect.anything(), true)
  })

  it('keeps order: if older results cannot be flushed, the new one is queued behind them', async () => {
    const { d, calls } = deps({ flush: vi.fn(async () => blocked) })
    const out = await recordWithQueue(d, result('1'), { offlineCapable: true })
    expect(out).toEqual({ result: null, queued: true })
    expect(calls).toEqual(['queue'])
    expect(d.submit).not.toHaveBeenCalled()
  })

  it('queues the result when the live submit fails with a network error', async () => {
    const { d } = deps({ submit: vi.fn(async () => Promise.reject(new Error('network'))) })
    const out = await recordWithQueue(d, result('1'), { offlineCapable: true })
    expect(out).toEqual({ result: null, queued: true })
    expect(d.queue).toHaveBeenCalledTimes(1)
  })

  it('does not queue a result the server rejected for good', async () => {
    const { d } = deps({ submit: vi.fn(async () => Promise.reject(new Error('400 bad request'))) })
    await expect(recordWithQueue(d, result('1'), { offlineCapable: true })).rejects.toThrow('400')
    expect(d.queue).not.toHaveBeenCalled()
  })

  it('queue-only mode (serving cached puzzles) never tries the network', async () => {
    const { d, calls } = deps()
    const out = await recordWithQueue(d, result('1'), { offlineCapable: true, queueOnly: true })
    expect(out).toEqual({ result: null, queued: true })
    expect(calls).toEqual(['queue'])
  })

  it('fails loudly if the result cannot be stored at all', async () => {
    const { d } = deps({ queue: vi.fn(async () => false) })
    await expect(recordWithQueue(d, result('1'), { offlineCapable: true, queueOnly: true })).rejects.toThrow('Could not save')
  })
})

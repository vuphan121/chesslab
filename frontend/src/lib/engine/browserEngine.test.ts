import { describe, expect, it, vi } from 'vitest'
import { BrowserEngine } from './browserEngine'
import type { EngineRequest, WorkerLike } from './browserEngine'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

class FakeWorker implements WorkerLike {
  sent: string[] = []
  terminated = false
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message?: string }) => void) | null = null

  postMessage(message: string): void {
    this.sent.push(message)
    if (message === 'uci') queueMicrotask(() => this.say('uciok'))
    if (message === 'isready') queueMicrotask(() => this.say('readyok'))
  }

  terminate(): void {
    this.terminated = true
  }

  say(line: string): void {
    this.onmessage?.({ data: line })
  }

  info(depth: number, pv: string, multipv = 1, cp = 20): void {
    this.say(`info depth ${depth} seldepth ${depth} multipv ${multipv} score cp ${cp} nodes 100 nps 1000 time 10 pv ${pv}`)
  }
}

function setup() {
  const worker = new FakeWorker()
  const engine = new BrowserEngine(() => worker)
  return { worker, engine }
}

function request(over: Partial<EngineRequest> = {}): EngineRequest {
  return { fen: START, lines: 3, hashMb: 32, limit: 'depth', depth: 20, timeSec: 5, onUpdate: () => {}, ...over }
}

const goCount = (w: FakeWorker) => w.sent.filter((m) => m.startsWith('go ')).length

describe('BrowserEngine', () => {
  it('configures the engine, searches to the requested depth and reports progress and the final result', async () => {
    const { worker, engine } = setup()
    const updates: number[] = []
    const job = engine.start(request({ onUpdate: (a) => updates.push(a.depth) }))
    await vi.waitFor(() => expect(worker.sent).toContain('go depth 20'))
    expect(worker.sent).toEqual([
      'uci',
      'isready',
      'setoption name Hash value 32',
      'setoption name MultiPV value 3',
      `position fen ${START}`,
      'go depth 20',
    ])
    worker.info(10, 'e2e4 e7e5')
    await vi.waitFor(() => expect(updates).toContain(10))
    worker.info(20, 'e2e4 e7e5 g1f3')
    worker.say('bestmove e2e4 ponder e7e5')
    const result = await job.done
    expect(result.completed).toBe(true)
    expect(result.analysis?.depth).toBe(20)
    expect(result.analysis?.bestMove).toBe('e2e4')
  })

  it('uses movetime and infinite for the other search limits', async () => {
    const { worker, engine } = setup()
    engine.start(request({ limit: 'time', timeSec: 7 }))
    await vi.waitFor(() => expect(worker.sent).toContain('go movetime 7000'))
    worker.say('bestmove e2e4')
    engine.start(request({ limit: 'infinite' }))
    await vi.waitFor(() => expect(worker.sent).toContain('go infinite'))
  })

  it('does not re-send options that have not changed', async () => {
    const { worker, engine } = setup()
    engine.start(request())
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    worker.say('bestmove e2e4')
    engine.start(request({ fen: AFTER_E4 }))
    await vi.waitFor(() => expect(goCount(worker)).toBe(2))
    expect(worker.sent.filter((m) => m.startsWith('setoption'))).toHaveLength(2)
    worker.say('bestmove e7e5')
    engine.start(request({ fen: AFTER_E4, lines: 5 }))
    await vi.waitFor(() => expect(goCount(worker)).toBe(3))
    expect(worker.sent.filter((m) => m.startsWith('setoption name MultiPV'))).toHaveLength(2)
  })

  it('stops the old search and only starts the new one after the engine answers bestmove', async () => {
    const { worker, engine } = setup()
    const first = engine.start(request())
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    const second = engine.start(request({ fen: AFTER_E4 }))
    expect(worker.sent.at(-1)).toBe('stop')
    expect(goCount(worker)).toBe(1)
    worker.info(8, 'e2e4')
    worker.say('bestmove e2e4')
    await vi.waitFor(() => expect(goCount(worker)).toBe(2))
    expect(worker.sent.at(-2)).toBe(`position fen ${AFTER_E4}`)
    expect((await first.done).completed).toBe(true)
    worker.info(12, 'e7e5')
    worker.say('bestmove e7e5')
    expect((await second.done).analysis?.bestMove).toBe('e7e5')
  })

  it('drops a queued job that is replaced before it ever starts', async () => {
    const { worker, engine } = setup()
    engine.start(request())
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    const skipped = engine.start(request({ fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1' }))
    const last = engine.start(request({ fen: AFTER_E4 }))
    expect((await skipped.done).completed).toBe(false)
    worker.say('bestmove e2e4')
    await vi.waitFor(() => expect(goCount(worker)).toBe(2))
    expect(worker.sent.filter((m) => m.startsWith('position fen ')).map((m) => m.slice(13))).toEqual([START, AFTER_E4])
    worker.say('bestmove e7e5')
    await last.done
  })

  it('cancel resolves at once with what was found and lets the engine finish stopping', async () => {
    const { worker, engine } = setup()
    const updates: number[] = []
    const job = engine.start(request({ limit: 'infinite', onUpdate: (a) => updates.push(a.depth) }))
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    worker.info(14, 'e2e4 e7e5')
    await vi.waitFor(() => expect(updates).toContain(14))
    job.cancel()
    const result = await job.done
    expect(result.completed).toBe(false)
    expect(result.analysis?.depth).toBe(14)
    expect(worker.sent.at(-1)).toBe('stop')
    updates.length = 0
    worker.info(15, 'e2e4 e7e5')
    worker.say('bestmove e2e4')
    await new Promise((r) => setTimeout(r, 120))
    expect(updates).toEqual([])
  })

  it('ignores bound updates and reports White-relative scores for Black to move', async () => {
    const { worker, engine } = setup()
    const job = engine.start(request({ fen: AFTER_E4, lines: 1 }))
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    worker.say('info depth 9 seldepth 9 multipv 1 score cp 300 lowerbound nodes 1 nps 1 time 1 pv e7e5')
    worker.info(9, 'e7e5', 1, 35)
    worker.say('bestmove e7e5')
    const result = await job.done
    expect(result.analysis?.score).toBe(-35)
  })

  it('reports an error once and keeps failing fast when the worker cannot load', async () => {
    const { worker, engine } = setup()
    const job = engine.start(request())
    worker.onerror?.({ message: 'wasm blocked' })
    const result = await job.done
    expect(result.error).toBe('wasm blocked')
    expect(worker.terminated).toBe(true)
    expect((await engine.start(request()).done).error).toBe('wasm blocked')
  })

  it('dispose resolves outstanding jobs and terminates the worker', async () => {
    const { worker, engine } = setup()
    const job = engine.start(request())
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    engine.dispose()
    expect((await job.done).completed).toBe(false)
    expect(worker.terminated).toBe(true)
  })
})

describe('BrowserEngine robustness', () => {
  it('does not show shallow, unreliable results but always reports the final one', async () => {
    const { worker, engine } = setup()
    const depths: number[] = []
    const job = engine.start(request({ onUpdate: (a) => depths.push(a.depth) }))
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    for (const d of [1, 2, 3, 5, 7]) worker.info(d, 'e2e4 e7e5')
    await new Promise((r) => setTimeout(r, 200))
    expect(depths).toEqual([])
    worker.info(8, 'e2e4 e7e5')
    await vi.waitFor(() => expect(depths).toEqual([8]))
    worker.info(9, 'e2e4 e7e5')
    worker.say('bestmove e2e4')
    expect((await job.done).analysis?.depth).toBe(9)
    expect(depths.at(-1)).toBe(9)
  })

  it('recovers from a worker crash in the middle of a session with a fresh worker', async () => {
    const workers: FakeWorker[] = []
    const engine = new BrowserEngine(() => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    })
    const first = engine.start(request())
    await vi.waitFor(() => expect(goCount(workers[0])).toBe(1))
    workers[0].onerror?.({ message: 'wasm trap' })
    expect((await first.done).error).toBe('wasm trap')
    expect(workers[0].terminated).toBe(true)

    const second = engine.start(request({ fen: AFTER_E4 }))
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    await vi.waitFor(() => expect(goCount(workers[1])).toBe(1))
    expect(workers[1].sent).toContain('setoption name Hash value 32')
    workers[1].info(12, 'e7e5')
    workers[1].say('bestmove e7e5')
    const result = await second.done
    expect(result.error).toBeUndefined()
    expect(result.analysis?.bestMove).toBe('e7e5')
  })

  it('gives up for good after repeated crashes or a load failure', async () => {
    const workers: FakeWorker[] = []
    const engine = new BrowserEngine(() => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    })
    for (let i = 0; i < 4; i++) {
      const job = engine.start(request())
      await vi.waitFor(() => expect(workers).toHaveLength(i + 1))
      await vi.waitFor(() => expect(goCount(workers[i])).toBe(1))
      workers[i].onerror?.({ message: 'crash ' + i })
      await job.done
    }
    const after = await engine.start(request()).done
    expect(after.error).toBe('crash 3')
    expect(workers).toHaveLength(4)
  })

  it('a position that cannot be turned into a result does not stall the queue', async () => {
    const { worker, engine } = setup()
    const bad = engine.start(request({ fen: 'not a fen' }))
    await vi.waitFor(() => expect(goCount(worker)).toBe(1))
    worker.info(10, 'e2e4')
    worker.say('bestmove e2e4')
    const badResult = await bad.done
    expect(badResult.analysis).toBeNull()

    const good = engine.start(request())
    await vi.waitFor(() => expect(goCount(worker)).toBe(2))
    worker.info(12, 'e2e4 e7e5')
    worker.say('bestmove e2e4')
    expect((await good.done).analysis?.bestMove).toBe('e2e4')
  })
})

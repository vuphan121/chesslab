import type { Analysis } from '@/lib/api/client'
import { buildAnalysis } from './buildAnalysis'
import type { SearchLimit } from './settings'
import { parseInfo } from './uci'
import type { UciInfo } from './uci'

export const ENGINE_SCRIPT = '/stockfish/stockfish-19-lite-single.js'

const FIRST_EMIT_DELAY_MS = 30
const EMIT_INTERVAL_MS = 150
const MIN_EMIT_DEPTH = 8
const CRASH_WINDOW_MS = 60000
const MAX_CRASHES_IN_WINDOW = 3

export interface EngineRequest {
  fen: string
  lines: number
  hashMb: number
  limit: SearchLimit
  depth: number
  timeSec: number
  onUpdate: (analysis: Analysis) => void
}

export interface EngineResult {
  analysis: Analysis | null
  completed: boolean
  error?: string
}

export interface EngineJob {
  done: Promise<EngineResult>
  cancel: () => void
}

export interface WorkerLike {
  postMessage(message: string): void
  terminate(): void
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

interface Job {
  req: EngineRequest
  infos: Map<number, UciInfo>
  cancelled: boolean
  finished: boolean
  stopSent: boolean
  emitTimer: ReturnType<typeof setTimeout> | null
  emitCount: number
  lastAnalysis: Analysis | null
  resolve: (result: EngineResult) => void
}

export class BrowserEngine {
  private worker: WorkerLike | null = null
  private booting: Promise<void> | null = null
  private bootStep: 'uci' | 'ready' | null = null
  private bootResolve: (() => void) | null = null
  private failed: string | null = null
  private running: Job | null = null
  private queued: Job | null = null
  private pumping = false
  private appliedHash = 0
  private appliedLines = 0
  private crashTimes: number[] = []

  constructor(private createWorker: () => WorkerLike = () => new Worker(ENGINE_SCRIPT) as unknown as WorkerLike) {}

  start(req: EngineRequest): EngineJob {
    let resolve!: (result: EngineResult) => void
    const done = new Promise<EngineResult>((r) => {
      resolve = r
    })
    const job: Job = {
      req,
      infos: new Map(),
      cancelled: false,
      finished: false,
      stopSent: false,
      emitTimer: null,
      emitCount: 0,
      lastAnalysis: null,
      resolve,
    }
    if (this.failed) {
      job.finished = true
      resolve({ analysis: null, completed: false, error: this.failed })
      return { done, cancel: () => {} }
    }
    if (this.queued) this.finishJob(this.queued, false)
    this.queued = job
    if (this.running) this.sendStop(this.running)
    else void this.pump()
    return { done, cancel: () => this.cancelJob(job) }
  }

  dispose(): void {
    if (this.queued) this.finishJob(this.queued, false)
    if (this.running) this.finishJob(this.running, false)
    this.queued = null
    this.running = null
    this.worker?.terminate()
    this.worker = null
    this.booting = null
    this.bootStep = null
    this.bootResolve = null
    this.appliedHash = 0
    this.appliedLines = 0
  }

  private cancelJob(job: Job): void {
    if (job.finished) return
    job.cancelled = true
    if (this.queued === job) this.queued = null
    this.finishJob(job, false)
    if (this.running === job) this.sendStop(job)
  }

  private sendStop(job: Job): void {
    if (job.stopSent) return
    job.stopSent = true
    this.worker?.postMessage('stop')
  }

  private finishJob(job: Job, completed: boolean): void {
    if (job.finished) return
    job.finished = true
    if (job.emitTimer) clearTimeout(job.emitTimer)
    job.emitTimer = null
    job.resolve({ analysis: job.lastAnalysis, completed })
  }

  private boot(): Promise<void> {
    if (this.booting) return this.booting
    this.booting = new Promise<void>((resolve, reject) => {
      try {
        const worker = this.createWorker()
        this.worker = worker
        this.bootResolve = resolve
        this.bootStep = 'uci'
        worker.onmessage = (event) => this.onLine(String(event.data))
        worker.onerror = (event) => {
          const message = event.message || 'The browser engine failed to load.'
          const duringBoot = this.bootStep !== null
          this.crash(message, duringBoot)
          if (duringBoot) reject(new Error(message))
        }
        worker.postMessage('uci')
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    return this.booting
  }

  private async pump(): Promise<void> {
    if (this.running || this.pumping) return
    this.pumping = true
    try {
      await this.boot()
    } catch (err) {
      this.crash(err instanceof Error ? err.message : String(err), true)
      return
    } finally {
      this.pumping = false
    }
    if (this.running || !this.queued || !this.worker) return
    const job = this.queued
    this.queued = null
    this.running = job
    const { req } = job
    if (req.hashMb !== this.appliedHash) {
      this.worker.postMessage(`setoption name Hash value ${req.hashMb}`)
      this.appliedHash = req.hashMb
    }
    if (req.lines !== this.appliedLines) {
      this.worker.postMessage(`setoption name MultiPV value ${req.lines}`)
      this.appliedLines = req.lines
    }
    this.worker.postMessage(`position fen ${req.fen}`)
    this.worker.postMessage(
      req.limit === 'depth' ? `go depth ${req.depth}` : req.limit === 'time' ? `go movetime ${req.timeSec * 1000}` : 'go infinite',
    )
  }

  private onLine(line: string): void {
    if (this.bootStep === 'uci') {
      if (line === 'uciok') {
        this.bootStep = 'ready'
        this.worker?.postMessage('isready')
      }
      return
    }
    if (this.bootStep === 'ready') {
      if (line === 'readyok') {
        this.bootStep = null
        this.bootResolve?.()
        this.bootResolve = null
      }
      return
    }
    const job = this.running
    if (!job) return
    if (line.startsWith('bestmove')) {
      this.running = null
      if (!job.finished) {
        if (job.emitTimer) clearTimeout(job.emitTimer)
        job.emitTimer = null
        const analysis = this.safeBuild(job)
        job.lastAnalysis = analysis
        job.finished = true
        if (analysis) {
          try {
            job.req.onUpdate(analysis)
          } catch {
          }
        }
        job.resolve({ analysis, completed: !job.cancelled })
      }
      void this.pump()
      return
    }
    const info = parseInfo(line)
    if (!info || info.bound || job.finished) return
    job.infos.set(info.multipv, info)
    if (info.depth >= MIN_EMIT_DEPTH && !job.emitTimer) {
      job.emitTimer = setTimeout(
        () => {
          job.emitTimer = null
          if (job.finished) return
          job.emitCount++
          const analysis = this.safeBuild(job)
          if (analysis) {
            job.lastAnalysis = analysis
            try {
              job.req.onUpdate(analysis)
            } catch {
            }
          }
        },
        job.emitCount === 0 ? FIRST_EMIT_DELAY_MS : EMIT_INTERVAL_MS,
      )
    }
  }

  private safeBuild(job: Job): Analysis | null {
    try {
      return buildAnalysis(job.req.fen, [...job.infos.values()])
    } catch {
      return null
    }
  }

  private crash(message: string, duringBoot: boolean): void {
    const now = Date.now()
    this.crashTimes = this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS)
    this.crashTimes.push(now)
    if (duringBoot || this.crashTimes.length > MAX_CRASHES_IN_WINDOW) this.failed = message
    if (this.queued) this.failJob(this.queued, message)
    if (this.running) this.failJob(this.running, message)
    this.queued = null
    this.running = null
    this.worker?.terminate()
    this.worker = null
    this.booting = null
    this.bootStep = null
    this.bootResolve = null
    this.appliedHash = 0
    this.appliedLines = 0
  }

  private failJob(job: Job, message: string): void {
    if (job.finished) return
    job.finished = true
    if (job.emitTimer) clearTimeout(job.emitTimer)
    job.resolve({ analysis: job.lastAnalysis, completed: false, error: message })
  }
}

let shared: BrowserEngine | null = null
let users = 0

export function acquireEngine(): BrowserEngine {
  if (!shared) shared = new BrowserEngine()
  users++
  return shared
}

export function releaseEngine(): void {
  users = Math.max(0, users - 1)
  if (users === 0 && shared) {
    shared.dispose()
    shared = null
  }
}

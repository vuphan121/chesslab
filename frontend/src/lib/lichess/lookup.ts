import { Chess } from 'chess.js'
import type { Analysis, AnalysisLine, FenEval, TablebaseCategory } from '@/lib/api/client'
import { sanAndFens } from '@/lib/engine/buildAnalysis'

export const MAX_TABLEBASE_PIECES = 7
const LOOKUP_TIMEOUT_MS = 3000
const CACHE_LIMIT = 400
const PREFETCH_LINES = 3

interface CloudPv {
  moves: string
  cp?: number | null
  mate?: number | null
}

export interface CloudEval {
  depth: number
  pvs: CloudPv[]
}

interface TablebaseMove {
  uci: string
  san?: string
  category?: string
}

export interface TablebaseResult {
  category: string
  dtz?: number | null
  dtm?: number | null
  moves?: TablebaseMove[]
}

export function pieceCount(fen: string): number {
  let n = 0
  for (const ch of fen.split(' ')[0]) if (/[a-zA-Z]/.test(ch)) n++
  return n
}

export function cloudAnalysis(fen: string, cloud: CloudEval): Analysis {
  const lines: AnalysisLine[] = cloud.pvs.map((pv) => {
    const uci = pv.moves.split(/\s+/).filter(Boolean)
    const { sans, fens, played } = sanAndFens(fen, uci)
    return { score: pv.cp ?? 0, mate: pv.mate ?? 0, depth: cloud.depth, moves: sans, uciMoves: played, fens }
  })
  const top = lines[0]
  return {
    bestMove: top?.uciMoves[0] ?? '',
    score: top?.score ?? 0,
    mate: top?.mate ?? 0,
    depth: cloud.depth,
    engineName: 'Lichess Cloud',
    lines,
  }
}

const FLIPPED: Record<string, TablebaseCategory> = {
  win: 'loss',
  loss: 'win',
  'cursed-win': 'blessed-loss',
  'blessed-loss': 'cursed-win',
  'maybe-win': 'maybe-loss',
  'maybe-loss': 'maybe-win',
  'syzygy-win': 'syzygy-loss',
  'syzygy-loss': 'syzygy-win',
}

export function tablebaseAnalysis(fen: string, tb: TablebaseResult): Analysis {
  const flip = fen.split(' ')[1] === 'b'
  const category = (flip ? (FLIPPED[tb.category] ?? tb.category) : tb.category) as TablebaseCategory
  const out: Analysis = {
    bestMove: '',
    score: 0,
    mate: 0,
    depth: 0,
    engineName: `Syzygy Tablebase (${pieceCount(fen)}-man)`,
    lines: [],
    tablebaseCategory: category,
  }
  if (tb.dtz != null) out.tablebaseDtz = flip ? -tb.dtz : tb.dtz

  const decisive = ['win', 'loss', 'syzygy-win', 'syzygy-loss'].includes(tb.category)
  let score = 0
  if (tb.category === 'win' || tb.category === 'syzygy-win') score = 10000
  else if (tb.category === 'loss' || tb.category === 'syzygy-loss') score = -10000
  let mate = 0
  if (decisive && tb.dtm != null) {
    const moves = Math.floor((Math.abs(tb.dtm) + 1) / 2)
    mate = tb.dtm < 0 ? -moves : moves
  }
  if (flip) {
    score = -score
    mate = -mate
  }
  out.score = score
  out.mate = mate

  const best = tb.moves?.[0]
  if (best) {
    out.bestMove = best.uci
    const { sans, fens, played } = sanAndFens(fen, [best.uci])
    out.lines = [{ score, mate, depth: 0, moves: sans, uciMoves: played, fens }]
  }
  return out
}

function isGameOver(fen: string): boolean {
  try {
    return new Chess(fen).moves().length === 0
  } catch {
    return true
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), LOOKUP_TIMEOUT_MS)
  const onAbort = () => timeout.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { signal: timeout.signal })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`lichess: status ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

interface Entry {
  lines: number
  value: Analysis | null
}

const cache = new Map<string, Entry>()

interface InflightLookup {
  promise: Promise<Analysis | null>
  controller: AbortController
  subscribers: number
  settled: boolean
}

const inflight = new Map<string, InflightLookup>()

function remember(fen: string, lines: number, value: Analysis | null): void {
  cache.delete(fen)
  cache.set(fen, { lines, value })
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

async function fetchLookup(fen: string, lines: number, signal?: AbortSignal): Promise<Analysis | null> {
  if (isGameOver(fen)) return null
  if (pieceCount(fen) <= MAX_TABLEBASE_PIECES) {
    try {
      const tb = await fetchJson<TablebaseResult>(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`, signal)
      if (tb && tb.category) return tablebaseAnalysis(fen, tb)
    } catch (err) {
      if (signal?.aborted) throw err
    }
    return null
  }
  const cloud = await fetchJson<CloudEval>(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${lines}`, signal)
  return cloud && cloud.pvs?.length ? cloudAnalysis(fen, cloud) : null
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function subscribe(entry: InflightLookup, signal?: AbortSignal): Promise<Analysis | null> {
  if (signal?.aborted) return Promise.reject(abortError())
  entry.subscribers++
  return new Promise((resolve, reject) => {
    let finished = false
    const release = () => {
      if (finished) return false
      finished = true
      signal?.removeEventListener('abort', onAbort)
      entry.subscribers--
      if (!entry.settled && entry.subscribers === 0) entry.controller.abort()
      return true
    }
    const onAbort = () => {
      if (release()) reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(
      (value) => {
        if (release()) resolve(value)
      },
      (error) => {
        if (release()) reject(error)
      },
    )
  })
}

export async function lookupAnalysis(fen: string, lines = 3, signal?: AbortSignal): Promise<Analysis | null> {
  const hit = cache.get(fen)
  if (hit && (hit.value === null || hit.lines >= lines || hit.value.tablebaseCategory)) return hit.value
  if (signal?.aborted) throw abortError()
  const key = `${fen}|${lines}`
  let entry = inflight.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { promise: Promise.resolve(null), controller, subscribers: 0, settled: false }
    const current = entry
    current.promise = fetchLookup(fen, lines, controller.signal)
      .then((value) => {
        remember(fen, lines, value)
        return value
      })
      .catch((error) => {
        if (controller.signal.aborted) throw error
        return null
      })
      .finally(() => {
        current.settled = true
        if (inflight.get(key) === current) inflight.delete(key)
      })
    inflight.set(key, current)
  }
  return subscribe(entry, signal)
}

export function prefetchReplies(analysis: Analysis): void {
  const fens: string[] = []
  for (const line of analysis.lines) {
    const fen = line.fens[0]
    if (fen && !fens.includes(fen)) fens.push(fen)
    if (fens.length === 2) break
  }
  for (const fen of fens) {
    if (!cache.has(fen)) void lookupAnalysis(fen, PREFETCH_LINES).catch(() => {})
  }
}

export async function lookupEval(fen: string, signal?: AbortSignal): Promise<FenEval | null> {
  if (isGameOver(fen)) return { score: 0, mate: 0, depth: 0 }
  const a = await lookupAnalysis(fen, 1, signal)
  if (!a) return null
  return {
    score: a.score,
    mate: a.mate,
    depth: a.depth,
    ...(a.tablebaseCategory ? { tablebaseCategory: a.tablebaseCategory } : {}),
    ...(a.tablebaseDtz !== undefined ? { tablebaseDtz: a.tablebaseDtz } : {}),
  }
}

export function clearLookupCache(): void {
  cache.clear()
  for (const entry of inflight.values()) entry.controller.abort()
  inflight.clear()
}

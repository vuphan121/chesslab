import type { Explorer, ExplorerMove } from '@/lib/api/client'
import { getLichessToken } from '@/lib/api/client'

const CACHE_LIMIT = 600
const TIMEOUT_MS = 6000

interface RawOpening {
  eco?: string
  name?: string
}

interface RawMove {
  uci: string
  san: string
  white: number
  draws: number
  black: number
  opening?: RawOpening | null
}

export interface RawExplorer {
  white: number
  draws: number
  black: number
  moves: RawMove[]
  opening?: RawOpening | null
}

export function toExplorer(raw: RawExplorer): Explorer {
  const total = raw.white + raw.draws + raw.black
  const moves: ExplorerMove[] = raw.moves.map((m) => {
    const games = m.white + m.draws + m.black
    const out: ExplorerMove = {
      san: m.san,
      uci: m.uci,
      games,
      sharePct: total > 0 ? (games / total) * 100 : 0,
      whitePct: games > 0 ? (m.white / games) * 100 : 0,
      drawPct: games > 0 ? (m.draws / games) * 100 : 0,
      blackPct: games > 0 ? (m.black / games) * 100 : 0,
    }
    if (m.opening?.name) out.openingName = m.opening.name
    if (m.opening?.eco) out.openingEco = m.opening.eco
    return out
  })
  const out: Explorer = { totalGames: total, moves }
  if (raw.opening?.name) out.openingName = raw.opening.name
  if (raw.opening?.eco) out.openingEco = raw.opening.eco
  return out
}

const cache = new Map<string, Explorer>()

interface InflightExplorer {
  promise: Promise<Explorer>
  controller: AbortController
  subscribers: number
  settled: boolean
}

const inflight = new Map<string, InflightExplorer>()

export function explorerPositionKey(fen: string): string {
  return fen.split(/\s+/).slice(0, 4).join(' ')
}

export function cachedExplorer(fen: string): Explorer | undefined {
  return cache.get(explorerPositionKey(fen))
}

async function load(fen: string, signal: AbortSignal): Promise<Explorer> {
  const token = await getLichessToken()
  if (!token) throw new Error('Lichess token is not configured')
  if (signal.aborted) throw abortError()
  const url =
    `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(fen)}` +
    '&moves=12&topGames=0&recentGames=0&ratings=2000,2200,2500,2900&speeds=blitz,rapid,classical'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
    if (!res.ok) throw new Error(`explorer unavailable: status ${res.status}`)
    return toExplorer((await res.json()) as RawExplorer)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function subscribe(entry: InflightExplorer, signal?: AbortSignal): Promise<Explorer> {
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

export function fetchExplorer(fen: string, signal?: AbortSignal): Promise<Explorer> {
  const key = explorerPositionKey(fen)
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return Promise.resolve(hit)
  }
  if (signal?.aborted) return Promise.reject(abortError())
  let entry = inflight.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { promise: Promise.resolve({ totalGames: 0, moves: [] }), controller, subscribers: 0, settled: false }
    const current = entry
    current.promise = load(fen, controller.signal)
      .then((value) => {
        cache.set(key, value)
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
        return value
      })
      .finally(() => {
        current.settled = true
        if (inflight.get(key) === current) inflight.delete(key)
      })
    inflight.set(key, current)
  }
  return subscribe(entry, signal)
}

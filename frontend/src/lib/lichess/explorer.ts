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
const inflight = new Map<string, Promise<Explorer>>()

export function cachedExplorer(fen: string): Explorer | undefined {
  return cache.get(fen)
}

async function load(fen: string): Promise<Explorer> {
  const token = await getLichessToken()
  if (!token) throw new Error('Lichess token is not configured')
  const url =
    `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(fen)}` +
    '&moves=12&topGames=0&recentGames=0&ratings=2000,2200,2500,2900&speeds=blitz,rapid,classical'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
    if (!res.ok) throw new Error(`explorer unavailable: status ${res.status}`)
    return toExplorer((await res.json()) as RawExplorer)
  } finally {
    clearTimeout(timer)
  }
}

export function fetchExplorer(fen: string): Promise<Explorer> {
  const hit = cache.get(fen)
  if (hit) {
    cache.delete(fen)
    cache.set(fen, hit)
    return Promise.resolve(hit)
  }
  let pending = inflight.get(fen)
  if (!pending) {
    pending = load(fen)
      .then((value) => {
        cache.set(fen, value)
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
        return value
      })
      .finally(() => inflight.delete(fen))
    inflight.set(fen, pending)
  }
  return pending
}

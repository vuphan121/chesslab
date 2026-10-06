const TABLEBASE_URL = 'https://tablebase.lichess.ovh/standard'
const TIMEOUT_MS = 8000

export interface TbMove {
  uci: string
  san?: string
  category: string
  dtz?: number | null
}

export interface TbResult {
  category: string
  dtz?: number | null
  moves: TbMove[]
}

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const cache = new Map<string, TbResult>()
const inflight = new Map<string, Promise<TbResult>>()

export function clearTablebaseCache(): void {
  cache.clear()
  inflight.clear()
}

export function fetchTablebase(fen: string, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<TbResult> {
  const cached = cache.get(fen)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(fen)
  if (pending) return pending
  const request = (async () => {
    const res = await fetcher(`${TABLEBASE_URL}?fen=${encodeURIComponent(fen)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`tablebase: status ${res.status}`)
    const body = (await res.json()) as Partial<TbResult>
    if (!body.category) throw new Error('tablebase: no result')
    const result: TbResult = { category: body.category, dtz: body.dtz ?? null, moves: body.moves ?? [] }
    cache.set(fen, result)
    return result
  })().finally(() => inflight.delete(fen))
  inflight.set(fen, request)
  return request
}

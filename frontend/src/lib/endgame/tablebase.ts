const TABLEBASE_URL = 'https://tablebase.lichess.ovh/standard'
const TIMEOUT_MS = 8000
const RETRY_DELAY_MS = 1200
const BUSY_TEXT = 'The tablebase is busy. Try again in a moment.'
const OFFLINE_TEXT = "Couldn't reach the tablebase. Check your connection."

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

export class TablebaseError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export function tablebaseMessage(err: unknown): string {
  return err instanceof TablebaseError && err.status === 429 ? BUSY_TEXT : OFFLINE_TEXT
}

const retryable = (status: number): boolean => status === 429 || status >= 500

export function clearTablebaseCache(): void {
  cache.clear()
  inflight.clear()
}

export function fetchTablebase(
  fen: string,
  fetcher: Fetcher = fetch as unknown as Fetcher,
  retryDelayMs: number = RETRY_DELAY_MS,
): Promise<TbResult> {
  const cached = cache.get(fen)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(fen)
  if (pending) return pending
  const request = (async () => {
    const get = () => fetcher(`${TABLEBASE_URL}?fen=${encodeURIComponent(fen)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    let res = await get()
    if (!res.ok && retryable(res.status)) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      res = await get()
    }
    if (!res.ok) throw new TablebaseError(`tablebase: status ${res.status}`, res.status)
    const body = (await res.json()) as Partial<TbResult>
    if (!body.category) throw new TablebaseError('tablebase: no result')
    const result: TbResult = { category: body.category, dtz: body.dtz ?? null, moves: body.moves ?? [] }
    cache.set(fen, result)
    return result
  })().finally(() => inflight.delete(fen))
  inflight.set(fen, request)
  return request
}

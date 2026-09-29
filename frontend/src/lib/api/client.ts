import type { Color, MoveNode, PieceType } from '@/lib/chess/types'
import type { Repertoire, RepertoireSummary } from '@/lib/trainer/types'
import type { Book, BookSummary } from '@/lib/books/types'
import { getToken, setToken, clearToken } from '@/lib/auth/token'
import { ApiError, isRetryable } from '@/lib/offline/errors'
import { cacheFirst, dropCachedRepertoiresExcept, enqueue, listOutbox, networkFirst, readCache, refreshCache, removeOutboxItem, writeCache } from '@/lib/offline/cache'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

function authHeader(): Record<string, string> {
  const token = getToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  if (typeof Intl !== 'undefined') {
    headers['X-Chesslab-Time-Zone'] = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }
  return headers
}




async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const sentToken = getToken()
  const res = await fetch(input, init)
  const refreshed = res.headers.get('X-Refreshed-Token')
  if (refreshed && sentToken && getToken() === sentToken) setToken(refreshed)
  return res
}

export function pingBackend(): void {
  fetch(`${API}/healthz`).catch(() => {})
}

export interface PieceJSON {
  type: PieceType
  color: Color
}

export interface MoveJSON {
  from: string
  to: string
  flag?: string
  promotion?: string
}

export interface GameState {
  id: string
  fen: string
  turn: 'w' | 'b'
  fullMove: number
  pieces: Record<string, PieceJSON>
  legalMoves: MoveJSON[]
  lastMove: MoveJSON | null
  isCheck: boolean
  isCheckmate: boolean
  isStalemate: boolean
  isDraw: boolean
  isGameOver: boolean
  gameOverReason: string
  moveTree: MoveNode
  currentNodeId: string
}

export interface AnalysisLine {
  score: number
  mate: number
  depth: number
  moves: string[]
  uciMoves: string[]
  fens: string[]
}

export type TablebaseCategory =
  | 'win'
  | 'loss'
  | 'draw'
  | 'cursed-win'
  | 'blessed-loss'
  | 'maybe-win'
  | 'maybe-loss'
  | 'syzygy-win'
  | 'syzygy-loss'
  | 'unknown'

export interface Analysis {
  bestMove: string
  score: number
  mate: number
  depth: number
  engineName: string
  lines: AnalysisLine[]
  tablebaseCategory?: TablebaseCategory
  tablebaseDtz?: number
}

export interface ExplorerMove {
  san: string
  uci: string
  games: number
  sharePct: number
  whitePct: number
  drawPct: number
  blackPct: number
  openingName?: string
  openingEco?: string
}

export interface Explorer {
  totalGames: number
  openingName?: string
  openingEco?: string
  moves: ExplorerMove[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`${API}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...authHeader() },
  })
  if (res.status === 401) {



    clearToken()
  }
  if (!res.ok) {
    const text = await res.text()
    throw new ApiError(text || res.statusText, res.status)
  }
  return res.json() as Promise<T>
}




export interface FenEval {
  score: number
  mate: number
  depth: number
  tablebaseCategory?: TablebaseCategory
  tablebaseDtz?: number
}



export interface PositionEvalMove {
  rank: number
  san: string
  uci: string
  score: number
  mate: number
}

export interface PositionEval {
  score: number
  mate: number
  depth: number
  bestMoves?: PositionEvalMove[]
}

export const getPositionEvals = (fens: string[]): Promise<Record<string, PositionEval>> => {
  if (fens.length === 0) return Promise.resolve({})
  return request('/api/position-evals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fens }),
  })
}

let lichessTokenPromise: Promise<string | null> | null = null

export function getLichessToken(): Promise<string | null> {
  if (!lichessTokenPromise) {
    lichessTokenPromise = request<{ token: string }>('/api/lichess-token')
      .then((r) => r.token || null)
      .catch(() => {
        lichessTokenPromise = null
        return null
      })
  }
  return lichessTokenPromise
}

export interface CachedReadOptions<T> {
  fresh?: boolean
  onUpdate?: (value: T) => void
}

export const listRepertoires = (opts: CachedReadOptions<RepertoireSummary[]> = {}): Promise<RepertoireSummary[]> => {
  const load = () => request<RepertoireSummary[]>('/api/repertoires')
  return opts.fresh ? networkFirst('repertoires', load) : cacheFirst('repertoires', load, { onUpdate: opts.onUpdate })
}

export const getRepertoire = (id: string, opts: CachedReadOptions<Repertoire> = {}): Promise<Repertoire> => {
  const load = () => request<Repertoire>(`/api/repertoires/${id}`)
  return opts.fresh ? networkFirst(`repertoire:${id}`, load) : cacheFirst(`repertoire:${id}`, load, { onUpdate: opts.onUpdate })
}

export async function refreshAllCachedData(): Promise<void> {
  const list = await refreshCache('repertoires', () => request<RepertoireSummary[]>('/api/repertoires'))
  for (const rep of list) {
    await refreshCache(`repertoire:${rep.id}`, () => request<Repertoire>(`/api/repertoires/${rep.id}`))
  }
  await dropCachedRepertoiresExcept(new Set(list.map((r) => r.id)))
  await refreshCache('user-settings', () => request<UserSettings>('/api/user-settings')).catch(() => {})
  const pending = new Set((await listOutbox<QueuedProgress>()).map((item) => item.payload.repertoireId))
  for (const rep of list) {
    if (pending.has(rep.id)) continue
    await refreshCache(progressCacheKey(rep.id), () => request<GetProgressResponse>(`/api/progress/${rep.id}`)).catch(() => {})
  }
}

export interface ImportRepertoireRequest {
  sourceUrl: string
  name: string
  side: 'w' | 'b'
  description: string
}

export const importRepertoire = (input: ImportRepertoireRequest): Promise<RepertoireSummary> =>
  request('/api/repertoires/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

export const refreshRepertoire = (id: string): Promise<RepertoireSummary> =>
  request(`/api/repertoires/${encodeURIComponent(id)}/refresh`, { method: 'POST' })



export const listBooks = (): Promise<BookSummary[]> => request('/api/books')

export const getBook = (id: string): Promise<Book> => request(`/api/books/${id}`)



export const getBookChapterPDF = async (id: string, chapterId: string): Promise<Blob> => {
  const res = await apiFetch(`${API}/api/books/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/source.pdf`, { headers: authHeader() })
  if (res.status === 401) clearToken()
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return res.blob()
}

export interface GetBookProgressResponse {
  done: string[]
}

export const getBookProgress = (bookId: string): Promise<GetBookProgressResponse> =>
  request(`/api/book-progress/${bookId}`)

export const markItemDone = (bookId: string, itemId: string): Promise<{ ok: boolean }> =>
  request(`/api/book-progress/${bookId}/${itemId}`, { method: 'POST' })

export interface SavedLineMove {
  san: string
  uci: string
  fen: string
  score: number
  mate: number
  hasEval: boolean
}

export interface SavedLine {
  id: number
  startFen: string
  moves: SavedLineMove[]
  createdAt: string
}

export const getBookSavedLine = (bookId: string, itemId: string): Promise<{ line: SavedLine | null }> =>
  request(`/api/book-saved-lines/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}`)

export const saveBookLine = (
  bookId: string,
  itemId: string,
  startFen: string,
  moves: SavedLineMove[],
): Promise<{ line: SavedLine }> =>
  request(`/api/book-saved-lines/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startFen, moves }),
  })

export const deleteBookSavedLine = async (bookId: string, itemId: string): Promise<void> => {
  const res = await apiFetch(`${API}/api/book-saved-lines/${encodeURIComponent(bookId)}/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (res.status === 401) clearToken()
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
}

export const recordBookStudyActivity = (
  bookId: string,
  chapterId: string,
  itemId: string,
): Promise<{ ok: boolean }> =>
  request(`/api/book-activity/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}/${encodeURIComponent(itemId)}`, {
    method: 'POST',
  })



export interface LoginResponse {
  token: string
}

export const login = (username: string, password: string): Promise<LoginResponse> =>
  request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })




export interface ServerCardState {
  box: number
  lapses: number
  seen: number
  correct: number
  lastSeenISO: string | null
}

export interface GetProgressResponse {
  cards: Record<string, ServerCardState>
}

const progressCacheKey = (repertoireId: string) => `progress:${repertoireId}`

export const getProgress = async (repertoireId: string): Promise<GetProgressResponse> => {
  await Promise.race([flushProgressOutbox(), new Promise((resolve) => setTimeout(resolve, 1000))])
  const pending = (await listOutbox<QueuedProgress>()).some((item) => item.payload.repertoireId === repertoireId)
  if (pending) {
    const local = await readCache<GetProgressResponse>(progressCacheKey(repertoireId))
    if (local) return local.value
  }
  return networkFirst(progressCacheKey(repertoireId), () => request<GetProgressResponse>(`/api/progress/${repertoireId}`), 800)
}

export interface LineAttempt {
  chapterId: string
  chapterName: string
  cardId: string
  hadMistake: boolean
  playedAt?: string
}

export interface CardProgressDelta {
  lapses: number
  seen: number
  correct: number
}

interface QueuedProgress {
  repertoireId: string
  cards: Record<string, ServerCardState>
  lineAttempt?: LineAttempt
  deltas?: Record<string, CardProgressDelta>
  operationId?: string
}

const postProgress = (p: QueuedProgress): Promise<{ ok: boolean }> =>
  request(`/api/progress/${p.repertoireId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards: p.cards, lineAttempt: p.lineAttempt, deltas: p.deltas, operationId: p.operationId }),
    signal: AbortSignal.timeout(15000),
  })

let flushing: Promise<void> | null = null

export function flushProgressOutbox(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    for (const item of await listOutbox<QueuedProgress>()) {
      try {
        await postProgress(item.payload)
      } catch (err) {
        if (isRetryable(err) || (err instanceof ApiError && (err.status === 401 || err.status === 408 || err.status === 429))) return
        console.warn('dropping unsyncable queued progress', err)
      }
      await removeOutboxItem(item.id)
    }
  })()
    .catch(() => {})
    .finally(() => {
      flushing = null
    })
  return flushing
}

export const saveProgress = async (
  repertoireId: string,
  cards: Record<string, ServerCardState>,
  lineAttempt?: LineAttempt,
  deltas?: Record<string, CardProgressDelta>,
  operationId?: string,
): Promise<{ ok: boolean; queued?: boolean }> => {
  const payload: QueuedProgress = { repertoireId, cards, lineAttempt, deltas, operationId }
  void writeCache<GetProgressResponse>(progressCacheKey(repertoireId), { cards })
  try {
    const result = await postProgress(payload)
    void flushProgressOutbox()
    return result
  } catch (err) {
    if (!isRetryable(err) || !operationId || !(await enqueue(payload))) throw err
    return { ok: true, queued: true }
  }
}

export interface ChapterCount {
  repertoireId: string
  chapterId: string
  chapterName: string
  count: number
}

export interface DayCount {
  date: string
  total: number
}

export interface AnalyticsResponse {
  todayTotal: number
  todayByChapter: ChapterCount[]
  last7Days: DayCount[]
}

export const getAnalytics = (): Promise<AnalyticsResponse> => request('/api/analytics')

export interface TodayTrainingSettings {
  repertoireIds: string[]
}

export interface TodayTrainingEntry {
  repertoireId: string
  cardId: string
}

export interface TodayTrainingResponse {
  settings: TodayTrainingSettings | null
  entries: TodayTrainingEntry[]
}

export const getTodayTraining = (): Promise<TodayTrainingResponse> => request('/api/today-training')

export const saveTodayTraining = (settings: TodayTrainingSettings): Promise<TodayTrainingResponse> =>
  request('/api/today-training', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })

export interface SavedPuzzle {
  id: number
  url: string
  createdAt: string
}

export const listSavedPuzzles = (): Promise<{ puzzles: SavedPuzzle[] }> =>
  request('/api/saved-puzzles')

export const savePuzzle = (url: string): Promise<SavedPuzzle> =>
  request('/api/saved-puzzles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })

export const deleteSavedPuzzle = async (id: number): Promise<void> => {
  const res = await apiFetch(`${API}/api/saved-puzzles/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (res.status === 401) clearToken()
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
}

export const advanceTodayTraining = (
  repertoireId: string,
  cardId: string,
): Promise<TodayTrainingResponse> =>
  request('/api/today-training/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repertoireId, cardId }),
  })

export type PieceTheme = 'classic' | 'glass'

export interface UserSettings {
  pieceTheme: PieceTheme
}

export const getUserSettings = (opts: CachedReadOptions<UserSettings> = {}): Promise<UserSettings> =>
  cacheFirst('user-settings', () => request<UserSettings>('/api/user-settings'), { onUpdate: opts.onUpdate })

export const saveUserSettings = async (settings: UserSettings): Promise<UserSettings> => {
  const saved = await request<UserSettings>('/api/user-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  await writeCache('user-settings', saved)
  return saved
}

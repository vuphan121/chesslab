import type { Color, MoveNode, PieceType } from '@/lib/chess/types'
import type { Repertoire, RepertoireSummary } from '@/lib/trainer/types'
import type { Book, BookSummary } from '@/lib/books/types'
import { getToken, setToken, clearToken } from '@/lib/auth/token'
import { ApiError, isRetryable } from '@/lib/offline/errors'
import { cacheFirst, deleteCache, dropCachedRepertoiresExcept, enqueue, listOutbox, networkFirst, readCache, refreshCache, removeOutboxItem, writeCache } from '@/lib/offline/cache'
import { isMobileOfflineDevice } from '@/lib/offline/device'
import {
  rotateTodayTraining,
  summarizeTodayTraining,
  type TodayTrainingResponse,
  type TodayTrainingSettings,
  type TodayTrainingSnapshot,
} from '@/lib/trainer/todayTraining'

export type { TodayTrainingEntry, TodayTrainingResponse, TodayTrainingSettings } from '@/lib/trainer/todayTraining'

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
  checkmate?: 'white' | 'black'
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
  const pending = new Set((await listOutbox<unknown>())
    .filter((item): item is typeof item & { payload: QueuedProgress } => isQueuedProgress(item.payload))
    .map((item) => item.payload.repertoireId))
  for (const rep of list) {
    if (pending.has(rep.id)) continue
    await refreshCache(progressCacheKey(rep.id), () => request<GetProgressResponse>(`/api/progress/${rep.id}`)).catch(() => {})
  }
  if (isMobileOfflineDevice()) {
    await flushTodayTrainingOutbox()
    await prefetchTodayTrainingSnapshot().catch(() => {})
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
  const pending = (await listOutbox<unknown>()).some(
    (item) => isQueuedProgress(item.payload) && item.payload.repertoireId === repertoireId,
  )
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
  kind?: 'progress'
  repertoireId: string
  cards: Record<string, ServerCardState>
  lineAttempt?: LineAttempt
  deltas?: Record<string, CardProgressDelta>
  operationId?: string
}

function isQueuedProgress(payload: unknown): payload is QueuedProgress {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<QueuedProgress>
  return (value.kind === undefined || value.kind === 'progress')
    && typeof value.repertoireId === 'string'
    && typeof value.cards === 'object'
    && value.cards !== null
}

const postProgress = (p: QueuedProgress): Promise<{ ok: boolean }> =>
  request(`/api/progress/${p.repertoireId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards: p.cards, lineAttempt: p.lineAttempt, deltas: p.deltas, operationId: p.operationId }),
    signal: AbortSignal.timeout(15000),
  })

let flushing: Promise<void> | null = null
let flushProgressAgain = false

export function flushProgressOutbox(): Promise<void> {
  if (flushing) {
    flushProgressAgain = true
    return flushing
  }
  flushProgressAgain = false
  flushing = (async () => {
    const processed = new Set<string>()
    while (true) {
      const items = (await listOutbox<unknown>()).filter((item) => !processed.has(item.id) && isQueuedProgress(item.payload))
      if (items.length === 0) {
        if (flushProgressAgain) {
          flushProgressAgain = false
          continue
        }
        return
      }
      for (const item of items) {
        try {
          await postProgress(item.payload as QueuedProgress)
        } catch (err) {
          if (isRetryable(err) || (err instanceof ApiError && (err.status === 401 || err.status === 408 || err.status === 429))) return
          console.warn('dropping unsyncable queued progress', err)
        }
        await removeOutboxItem(item.id)
        processed.add(item.id)
      }
    }
  })()
    .catch(() => {})
    .finally(() => {
      flushing = null
      if (flushProgressAgain) void flushProgressOutbox()
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
  const payload: QueuedProgress = { kind: 'progress', repertoireId, cards, lineAttempt, deltas, operationId }
  void writeCache<GetProgressResponse>(progressCacheKey(repertoireId), { cards })
  try {
    const result = await postProgress(payload)
    void flushProgressOutbox()
    return result
  } catch (err) {
    if (!isRetryable(err) || !operationId || !(await enqueue(payload))) throw err
    if (flushing) flushProgressAgain = true
    return { ok: true, queued: true }
  }
}

export interface StatsDay {
  date: string
  drills: number
  puzzles: number
}

export interface StatsWeek {
  weekStart: string
  drillAccuracy: number | null
  puzzleAccuracy: number | null
  drills: number
  puzzles: number
}

export interface StatsTheme {
  theme: string
  nb: number
  wins: number
}

export interface StatisticsResponse {
  days: number
  endDate: string
  daily: StatsDay[]
  totals: { drills: number; drillMistakes: number; puzzles: number; puzzleWins: number }
  streak: number
  bestStreak: number
  rating: { current: number | null; delta: number | null; points: { date: string; rating: number }[] }
  themeDays: number
  themes: StatsTheme[]
  weekly: StatsWeek[]
  boxes: number[]
  coverage: { learned: number; shaky: number; untouched: number }
  puzzleSync: { configured: boolean; lichessUsername?: string; syncedAt?: string }
}

export const getStatistics = (days: number): Promise<StatisticsResponse> => request(`/api/statistics?days=${days}`)

export const syncPuzzles = (): Promise<{ added: number; durationMs: number }> =>
  request('/api/statistics/sync-puzzles', { method: 'POST' })

let todayTrainingRequest: Promise<TodayTrainingResponse> | null = null

const TODAY_TRAINING_CACHE_KEY = 'today-training-snapshot'

interface QueuedTodayTrainingAdvance {
  kind: 'today-training-advance'
  repertoireId: string
  cardId: string
  queueDate: string
  operationId: string
}

function isQueuedTodayTrainingAdvance(payload: unknown): payload is QueuedTodayTrainingAdvance {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Partial<QueuedTodayTrainingAdvance>
  return value.kind === 'today-training-advance'
    && typeof value.repertoireId === 'string'
    && typeof value.cardId === 'string'
    && typeof value.queueDate === 'string'
    && typeof value.operationId === 'string'
}

const fetchTodayTrainingSnapshot = (): Promise<TodayTrainingSnapshot> =>
  request('/api/today-training/snapshot')

async function hasPendingTodayTrainingAdvance(): Promise<boolean> {
  return (await listOutbox<unknown>()).some((item) => isQueuedTodayTrainingAdvance(item.payload))
}

export const prefetchTodayTrainingSnapshot = async (): Promise<TodayTrainingSnapshot> => {
  if (await hasPendingTodayTrainingAdvance()) {
    const cached = await readCache<TodayTrainingSnapshot>(TODAY_TRAINING_CACHE_KEY)
    if (cached) return cached.value
    throw new Error('Today training has pending offline changes and no local snapshot.')
  }
  return refreshCache(TODAY_TRAINING_CACHE_KEY, fetchTodayTrainingSnapshot)
}

export const getTodayTraining = async (): Promise<TodayTrainingResponse> => {
  if (!todayTrainingRequest) {
    todayTrainingRequest = (async () => {
      if (!isMobileOfflineDevice()) return request<TodayTrainingResponse>('/api/today-training')
      await Promise.race([flushTodayTrainingOutbox(), new Promise((resolve) => setTimeout(resolve, 1000))])
      if (await hasPendingTodayTrainingAdvance()) {
        const cached = await readCache<TodayTrainingSnapshot>(TODAY_TRAINING_CACHE_KEY)
        if (cached) return summarizeTodayTraining(cached.value)
      }
      const snapshot = await networkFirst(TODAY_TRAINING_CACHE_KEY, fetchTodayTrainingSnapshot, 800)
      return summarizeTodayTraining(snapshot)
    })()
      .finally(() => { todayTrainingRequest = null })
  }
  return todayTrainingRequest
}

export const saveTodayTraining = async (settings: TodayTrainingSettings): Promise<TodayTrainingResponse> => {
  const saved = await request<TodayTrainingResponse>('/api/today-training', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  await deleteCache(TODAY_TRAINING_CACHE_KEY)
  if (isMobileOfflineDevice()) await prefetchTodayTrainingSnapshot().catch(() => {})
  return saved
}

export interface PuzzleTheme {
  key: string
  category: string
  rating: number
  attempts: number
  wins: number
  available: number
  played: boolean
}

export interface PuzzleThemesResponse {
  startRating: number
  themes: PuzzleTheme[]
}

export interface PuzzleJSON {
  id: string
  fen: string
  moves: string
  rating: number
  themes: string[]
  theme: string
  themeRating: number
  mixed: boolean
  retry?: boolean
}

export interface PuzzleResult {
  theme: string
  ratingBefore: number
  ratingAfter: number
  delta: number
  attempts: number
  wins: number
  puzzleRating: number
}

export const getPuzzleThemes = (): Promise<PuzzleThemesResponse> => request('/api/puzzles/themes')

export const nextPuzzles = (
  theme: string | null,
  opts: { count: number; exclude: string[]; avoidTheme?: string },
): Promise<PuzzleJSON[]> =>
  request<{ puzzles: PuzzleJSON[] }>('/api/puzzles/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: theme ?? '', avoidTheme: opts.avoidTheme ?? '', count: opts.count, exclude: opts.exclude }),
  }).then((r) => r.puzzles)

export const submitPuzzleResult = (payload: {
  operationId: string
  puzzleId: string
  theme: string
  solved: boolean
}): Promise<PuzzleResult> =>
  request('/api/puzzles/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

export const addPuzzleToRetryQueue = (puzzleId: string, theme: string): Promise<void> =>
  request('/api/puzzles/retry-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ puzzleId, theme }),
  })

export const removePuzzleFromRetryQueue = (puzzleId: string): Promise<void> =>
  request(`/api/puzzles/retry-queue/${encodeURIComponent(puzzleId)}`, { method: 'DELETE' })

export const advanceTodayTraining = (
  repertoireId: string,
  cardId: string,
): Promise<TodayTrainingResponse> => advanceTodayTrainingOfflineFirst(repertoireId, cardId)

const postTodayTrainingAdvance = (payload: QueuedTodayTrainingAdvance): Promise<TodayTrainingResponse> =>
  request('/api/today-training/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  })

async function advanceTodayTrainingOfflineFirst(
  repertoireId: string,
  cardId: string,
): Promise<TodayTrainingResponse> {
  const cached = await readCache<TodayTrainingSnapshot>(TODAY_TRAINING_CACHE_KEY)
  const rotated = cached ? rotateTodayTraining(cached.value, repertoireId, cardId) : null
  const payload: QueuedTodayTrainingAdvance = {
    kind: 'today-training-advance',
    repertoireId,
    cardId,
    queueDate: cached?.value.queueDate ?? '',
    operationId: crypto.randomUUID(),
  }
  if (rotated && await enqueue(payload)) {
    if (await writeCache(TODAY_TRAINING_CACHE_KEY, rotated)) {
      void flushTodayTrainingOutbox()
      return summarizeTodayTraining(rotated)
    }
  }
  const response = await postTodayTrainingAdvance(payload)
  void flushTodayTrainingOutbox()
  if (rotated) await deleteCache(TODAY_TRAINING_CACHE_KEY)
  return response
}

let flushingTodayTraining: Promise<void> | null = null
let flushTodayTrainingAgain = false

export function flushTodayTrainingOutbox(): Promise<void> {
  if (flushingTodayTraining) {
    flushTodayTrainingAgain = true
    return flushingTodayTraining
  }
  flushTodayTrainingAgain = false
  flushingTodayTraining = (async () => {
    const processed = new Set<string>()
    while (true) {
      const items = (await listOutbox<unknown>()).filter((item) => !processed.has(item.id) && isQueuedTodayTrainingAdvance(item.payload))
      if (items.length === 0) {
        if (flushTodayTrainingAgain) {
          flushTodayTrainingAgain = false
          continue
        }
        return
      }
      for (const item of items) {
        try {
          await postTodayTrainingAdvance(item.payload as QueuedTodayTrainingAdvance)
        } catch (err) {
          if (isRetryable(err) || (err instanceof ApiError && (err.status === 401 || err.status === 408 || err.status === 429))) return
          console.warn('dropping unsyncable queued today training advance', err)
        }
        await removeOutboxItem(item.id)
        processed.add(item.id)
      }
    }
  })()
    .catch(() => {})
    .finally(() => {
      flushingTodayTraining = null
      if (flushTodayTrainingAgain) void flushTodayTrainingOutbox()
    })
  return flushingTodayTraining
}

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

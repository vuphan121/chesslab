import type { MoveNode } from '@/lib/chess/types'
import type { Repertoire, RepertoireSummary } from '@/lib/trainer/types'
import type { Book, BookSummary } from '@/lib/books/types'
import { getToken, clearToken } from '@/lib/auth/token'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

function authHeader(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}




export function pingBackend(): void {
  fetch(`${API}/healthz`).catch(() => {})
}

export interface PieceJSON {
  type: string
  color: string
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

export interface Analysis {
  bestMove: string
  score: number
  mate: number
  depth: number
  engineName: string
  lines: AnalysisLine[]
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
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...authHeader() },
  })
  if (res.status === 401) {



    clearToken()
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}




export const createGame = (fen?: string): Promise<GameState> =>
  request('/api/games', {
    method: 'POST',
    ...(fen
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fen }) }
      : {}),
  })



export const setPosition = (id: string, fen: string): Promise<GameState> =>
  request(`/api/games/${id}/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen }),
  })

export const getGame = (id: string): Promise<GameState> =>
  request(`/api/games/${id}`)

export const makeMove = (
  id: string,
  from: string,
  to: string,
  promotion?: string,
): Promise<GameState> =>
  request(`/api/games/${id}/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, promotion: promotion ?? '' }),
  })

export const analyzeGame = (id: string): Promise<Analysis> =>
  request(`/api/games/${id}/analysis`)

export interface FenEval {
  score: number
  mate: number
  depth: number
}



export const evalFen = (fen: string): Promise<FenEval> =>
  request(`/api/eval?fen=${encodeURIComponent(fen)}`)

export const getExplorer = (id: string): Promise<Explorer> =>
  request(`/api/games/${id}/explorer`)

export const gotoNode = (id: string, nodeId: string): Promise<GameState> =>
  request(`/api/games/${id}/goto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  })

export interface LoadPGNResponse extends GameState {
  appliedPlies: number
  totalTokens: number
  error?: string
}




export const loadPGN = async (id: string, pgn: string): Promise<LoadPGNResponse> => {
  const res = await fetch(`${API}/api/games/${id}/pgn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ pgn }),
  })
  if (res.status === 401) clearToken()
  if (!res.ok && res.status !== 422) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<LoadPGNResponse>
}



export interface ExplainMoveRequest {
  fen: string
  prevFen: string
  lastMoveSan: string
  viewerColor?: 'w' | 'b'
  analysis: Analysis | null
  explorer: Explorer | null
}

export interface ExplainMoveResponse {
  explanation: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface CoachChatResponse {
  reply: string
}




export class CoachUnavailableError extends Error {}




const COACH_TIMEOUT_MS = 120_000

async function coachRequest<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COACH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Coach timed out — the local model took too long to respond.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) clearToken()
  if (!res.ok) {
    const text = (await res.text()).trim()
    if (res.status === 503) throw new CoachUnavailableError(text || 'coach not configured')
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

export const explainMove = (
  id: string,
  req: ExplainMoveRequest,
): Promise<ExplainMoveResponse> => coachRequest(`/api/games/${id}/coach/explain`, req)

export const coachChat = (
  id: string,
  message: string,
  history: ChatTurn[],
): Promise<CoachChatResponse> =>
  coachRequest(`/api/games/${id}/coach/chat`, { message, history })



export const listRepertoires = (): Promise<RepertoireSummary[]> => request('/api/repertoires')

export const getRepertoire = (id: string): Promise<Repertoire> =>
  request(`/api/repertoires/${id}`)

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
  const res = await fetch(`${API}/api/books/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/source.pdf`, { headers: authHeader() })
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

export const getProgress = (repertoireId: string): Promise<GetProgressResponse> =>
  request(`/api/progress/${repertoireId}`)

export interface LineAttempt {
  chapterId: string
  chapterName: string
  cardId: string
  hadMistake: boolean
}

export const saveProgress = (
  repertoireId: string,
  cards: Record<string, ServerCardState>,
  lineAttempt?: LineAttempt,
): Promise<{ ok: boolean }> =>
  request(`/api/progress/${repertoireId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards, lineAttempt }),
  })

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
  linesPerDay: number
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

export const advanceTodayTraining = (
  repertoireId: string,
  cardId: string,
  incorrect: boolean,
): Promise<TodayTrainingResponse> =>
  request('/api/today-training/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repertoireId, cardId, incorrect }),
  })

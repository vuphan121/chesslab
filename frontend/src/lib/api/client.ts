import type { MoveNode } from '@/lib/chess/types'
import type { Repertoire, RepertoireSummary } from '@/lib/trainer/types'
import type { Book, BookSummary } from '@/lib/books/types'
import { getToken, clearToken } from '@/lib/auth/token'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

function authHeader(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Fire-and-forget hit to the unauthenticated /healthz route, called on app
// load (AuthGate) so a Render free-tier cold start begins immediately
// instead of waiting for the first real API call (e.g. login).
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
    // Token missing/expired/rejected — clear it so AuthGate (subscribed via
    // onAuthChange) drops back to the login screen. A wrong-password 401
    // from login() itself just clears an already-absent token — harmless.
    clearToken()
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

// createGame with no arguments keeps the original behavior (initial
// position). Passing a FEN roots the game at an arbitrary position — used
// by the opening trainer and the analysis-board handoff.
export const createGame = (fen?: string): Promise<GameState> =>
  request('/api/games', {
    method: 'POST',
    ...(fen
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fen }) }
      : {}),
  })

// setPosition re-points an existing game at an arbitrary FEN, discarding its
// tree — the trainer reuses one game object across a whole drill session.
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
  score: number // centipawns, White-relative
  mate: number
  depth: number
}

// evalFen returns a White-relative eval for an arbitrary position — used to
// annotate each move in the move list.
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

// loadPGN replays a pasted PGN move list from the start position. Unlike the
// other requests, a 422 (partial parse — hit an illegal/unrecognized token)
// still carries a usable body, so it's read and returned rather than thrown.
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

// --- AI coach ---

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

// CoachUnavailableError marks a 503 from the coach endpoints — i.e. the coach
// isn't configured (no local model reachable). Callers use it to show a
// distinct "coach offline" message rather than a generic failure.
export class CoachUnavailableError extends Error {}

// Local-model inference is slow (tens of seconds) and the agent chat can chain
// several calls, so we allow a generous ceiling — but still bound it so a hung
// request surfaces an error instead of freezing the coach panel forever.
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

// --- Opening trainer ---

export const listRepertoires = (): Promise<RepertoireSummary[]> => request('/api/repertoires')

export const getRepertoire = (id: string): Promise<Repertoire> =>
  request(`/api/repertoires/${id}`)

// --- Study from Book ---

export const listBooks = (): Promise<BookSummary[]> => request('/api/books')

export const getBook = (id: string): Promise<Book> => request(`/api/books/${id}`)

// The browser's built-in PDF viewer cannot attach our Bearer token itself, so
// fetch the user-owned file here and hand it an in-memory blob URL instead.
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

// --- Auth ---

export interface LoginResponse {
  token: string
}

export const login = (username: string, password: string): Promise<LoginResponse> =>
  request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

// --- Trainer progress sync (server-side, replaces localStorage — see
// frontend CLAUDE.md's "Server-side trainer sync" note for why) ---

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

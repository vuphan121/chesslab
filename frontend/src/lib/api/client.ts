const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

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
}

export interface AnalysisLine {
  score: number
  mate: number
  depth: number
  moves: string[]
}

export interface Analysis {
  bestMove: string
  score: number
  mate: number
  depth: number
  engineName: string
  lines: AnalysisLine[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

export const createGame = (): Promise<GameState> =>
  request('/api/games', { method: 'POST' })

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

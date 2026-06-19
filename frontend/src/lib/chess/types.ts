export type Color = 'w' | 'b'
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p'

export interface Piece {
  type: PieceType
  color: Color
}

export type Square = string // e.g. "e4", "a1"

export interface BoardState {
  pieces: Record<Square, Piece>
  turn: Color
  selectedSquare: Square | null
  legalMoves: Square[]
  lastMove: { from: Square; to: Square } | null
  isCheck: boolean
  isGameOver: boolean
  gameOverReason: string | null
}

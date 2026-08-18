export type Color = 'w' | 'b'
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p'

export interface Piece {
  type: PieceType
  color: Color
}

export type Square = string




export interface MoveNode {
  id: string
  san: string
  fen: string
  ply: number
  children: MoveNode[]
}

export interface BoardState {
  fen: string
  pieces: Record<Square, Piece>
  turn: Color
  fullMove: number
  selectedSquare: Square | null
  legalMoves: Square[]
  lastMove: { from: Square; to: Square } | null
  isCheck: boolean
  isGameOver: boolean
  gameOverReason: string | null
  moveTree: MoveNode
  currentNodeId: string
}

export type Color = 'w' | 'b'
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p'

export interface Piece {
  type: PieceType
  color: Color
}

export type Square = string // e.g. "e4", "a1"

// One node of the game's move tree. The root has an empty san and represents
// the starting position; children[0] is the main line, children[1:] are
// sidelines (variations).
export interface MoveNode {
  id: string
  san: string
  fen: string
  ply: number // half-move depth: root = 0, first move = 1
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
  moveTree: MoveNode // root node (starting position)
  currentNodeId: string
}

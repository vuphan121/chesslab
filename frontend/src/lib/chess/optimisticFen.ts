import { Chess } from 'chess.js'

export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 3).join(' ')
}

export function fenAfterMove(fen: string, from: string, to: string, promotion?: string): string | null {
  try {
    const chess = new Chess(fen)
    chess.move({ from, to, promotion })
    return chess.fen()
  } catch {
    return null
  }
}

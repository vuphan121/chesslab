import { Chess, validateFen } from 'chess.js'
import type { Color, PieceType } from './types'

export type EditorPieces = Record<string, { color: Color; type: PieceType }>

export interface EditorSetup {
  pieces: EditorPieces
  turn: Color
  castling: string
}

export const EDITOR_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
export const EDITOR_RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']
export const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'

export function placementToPieces(placement: string): EditorPieces {
  const pieces: EditorPieces = {}
  placement.split('/').forEach((row, rowIndex) => {
    let file = 0
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch)
        continue
      }
      const lower = ch.toLowerCase()
      if ('kqrbnp'.includes(lower) && file < 8) {
        pieces[`${EDITOR_FILES[file]}${EDITOR_RANKS[rowIndex]}`] = { color: ch === lower ? 'b' : 'w', type: lower as PieceType }
      }
      file++
    }
  })
  return pieces
}

export function piecesToPlacement(pieces: EditorPieces): string {
  return EDITOR_RANKS.map((rank) => {
    let row = ''
    let empty = 0
    for (const file of EDITOR_FILES) {
      const piece = pieces[`${file}${rank}`]
      if (!piece) {
        empty++
        continue
      }
      if (empty) row += empty
      empty = 0
      row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type
    }
    return row + (empty || '')
  }).join('/')
}

export function availableCastling(pieces: EditorPieces): string {
  const at = (square: string, color: Color, type: PieceType) => pieces[square]?.color === color && pieces[square]?.type === type
  let rights = ''
  if (at('e1', 'w', 'k')) rights += (at('h1', 'w', 'r') ? 'K' : '') + (at('a1', 'w', 'r') ? 'Q' : '')
  if (at('e8', 'b', 'k')) rights += (at('h8', 'b', 'r') ? 'k' : '') + (at('a8', 'b', 'r') ? 'q' : '')
  return rights
}

export function fenToSetup(fen: string): EditorSetup | null {
  const fields = fen.trim().split(/\s+/)
  if (fields.length < 1 || fields[0].split('/').length !== 8) return null
  const turn: Color = fields[1] === 'b' ? 'b' : 'w'
  const pieces = placementToPieces(fields[0])
  const castling = (fields[2] ?? '-').replace(/[^KQkq]/g, '')
  return { pieces, turn, castling: [...availableCastling(pieces)].filter((c) => castling.includes(c)).join('') }
}

export function setupToFen(setup: EditorSetup): string {
  const allowed = availableCastling(setup.pieces)
  const rights = [...'KQkq'].filter((c) => setup.castling.includes(c) && allowed.includes(c)).join('') || '-'
  return `${piecesToPlacement(setup.pieces)} ${setup.turn} ${rights} - 0 1`
}

export function validateSetup(setup: EditorSetup): string[] {
  const errors: string[] = []
  const all = Object.entries(setup.pieces)
  const kings = (color: Color) => all.filter(([, p]) => p.type === 'k' && p.color === color).length
  if (kings('w') !== 1) errors.push('White needs exactly one king.')
  if (kings('b') !== 1) errors.push('Black needs exactly one king.')
  if (all.some(([square, p]) => p.type === 'p' && (square.endsWith('1') || square.endsWith('8')))) {
    errors.push('Pawns cannot stand on the first or last rank.')
  }
  if (errors.length) return errors
  const fen = setupToFen(setup)
  const checked = validateFen(fen)
  if (!checked.ok) return [checked.error ?? 'This position is not valid.']
  try {
    const waiting = new Chess(fen.replace(` ${setup.turn} `, ` ${setup.turn === 'w' ? 'b' : 'w'} `).replace(/ [KQkq-]+ /, ' - '))
    if (waiting.inCheck()) errors.push(`${setup.turn === 'w' ? 'Black' : 'White'} is in check but it is not their move.`)
  } catch {
    errors.push('This position is not valid.')
  }
  return errors
}

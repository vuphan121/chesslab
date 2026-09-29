import { Chess } from 'chess.js'
import type { GameState, MoveJSON, PieceJSON } from '@/lib/api/client'
import type { MoveNode } from './types'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

interface TreeNode {
  id: string
  san: string
  fen: string
  ply: number
  from?: string
  to?: string
  promotion?: string
  parent: TreeNode | null
  children: TreeNode[]
}

export interface LoadPgnResult {
  appliedPlies: number
  totalTokens: number
  error?: string
}

function rootPly(fen: string): number {
  const fields = fen.split(' ')
  const full = Number(fields[5]) || 1
  return Math.max(0, (full - 1) * 2 + (fields[1] === 'b' ? 1 : 0))
}

export function tokenizePgnMoves(pgn: string): string[] {
  let s = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, ' ')
  let depth = 0
  let out = ''
  for (const ch of s) {
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  s = out
    .split('\n')
    .map((line) => {
      const i = line.indexOf(';')
      return i >= 0 ? line.slice(0, i) : line
    })
    .join(' ')
  depth = 0
  out = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  const results = new Set(['1-0', '0-1', '1/2-1/2', '*'])
  const moves: string[] = []
  for (const raw of out.split(/\s+/)) {
    if (!raw || results.has(raw) || raw.startsWith('$')) continue
    const tok = raw.replace(/^\d+\.+/, '')
    if (tok) moves.push(tok)
  }
  return moves
}

function normalizeSan(tok: string): string {
  const lower = tok.toLowerCase()
  if (lower === '0-0' || lower === 'o-o') return 'O-O'
  if (lower === '0-0-0' || lower === 'o-o-o') return 'O-O-O'
  return tok
}

export class LocalGame {
  private root: TreeNode
  private current: TreeNode
  private counter = 0
  readonly id = 'local'

  constructor(fen: string = START_FEN) {
    new Chess(fen)
    this.root = { id: '0', san: '', fen, ply: rootPly(fen), parent: null, children: [] }
    this.current = this.root
  }

  private nextId(): string {
    this.counter++
    return String(this.counter)
  }

  private find(id: string, node: TreeNode = this.root): TreeNode | null {
    if (node.id === id) return node
    for (const child of node.children) {
      const found = this.find(id, child)
      if (found) return found
    }
    return null
  }

  resetTo(fen: string = START_FEN): void {
    new Chess(fen)
    this.root = { id: '0', san: '', fen, ply: rootPly(fen), parent: null, children: [] }
    this.current = this.root
    this.counter = 0
  }

  get currentFen(): string {
    return this.current.fen
  }

  gotoNode(id: string): boolean {
    const node = this.find(id)
    if (!node) return false
    this.current = node
    return true
  }

  deleteNode(id: string): boolean {
    if (id === this.root.id) return false
    const target = this.find(id)
    if (!target || !target.parent) return false
    const parent = target.parent
    parent.children = parent.children.filter((c) => c !== target)
    for (let n: TreeNode | null = this.current; n; n = n.parent) {
      if (n === target) {
        this.current = parent
        break
      }
    }
    return true
  }

  applyMove(from: string, to: string, promotion?: string): boolean {
    const chess = new Chess(this.current.fen)
    const legal = chess.moves({ verbose: true }).find((m) => {
      if (m.from !== from || m.to !== to) return false
      if (m.promotion) return m.promotion === (promotion && 'qrbn'.includes(promotion) ? promotion : 'q')
      return true
    })
    if (!legal) return false
    const existing = this.current.children.find(
      (c) => c.from === legal.from && c.to === legal.to && (c.promotion ?? '') === (legal.promotion ?? ''),
    )
    if (existing) {
      this.current = existing
      return true
    }
    chess.move({ from: legal.from, to: legal.to, promotion: legal.promotion })
    const node: TreeNode = {
      id: this.nextId(),
      san: legal.san,
      fen: chess.fen(),
      ply: this.current.ply + 1,
      from: legal.from,
      to: legal.to,
      ...(legal.promotion ? { promotion: legal.promotion } : {}),
      parent: this.current,
      children: [],
    }
    this.current.children.push(node)
    this.current = node
    return true
  }

  loadPgn(pgn: string): LoadPgnResult {
    const tokens = tokenizePgnMoves(pgn)
    if (tokens.length === 0) throw new Error('no moves found in pgn')
    this.resetTo(START_FEN)
    let applied = 0
    let error: string | undefined
    for (const tok of tokens) {
      const chess = new Chess(this.current.fen)
      let move
      try {
        move = chess.move(normalizeSan(tok), { strict: false })
      } catch {
        error = `move ${applied + 1} (${JSON.stringify(tok)}) is illegal or unrecognized in this position`
        break
      }
      if (!this.applyMove(move.from, move.to, move.promotion)) {
        error = `move ${applied + 1} (${JSON.stringify(tok)}) failed`
        break
      }
      applied++
    }
    return { appliedPlies: applied, totalTokens: tokens.length, ...(error ? { error } : {}) }
  }

  snapshot(): GameState {
    const chess = new Chess(this.current.fen)
    const fields = this.current.fen.split(' ')
    const pieces: Record<string, PieceJSON> = {}
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell) pieces[cell.square] = { type: cell.type, color: cell.color }
      }
    }
    const verbose = chess.moves({ verbose: true })
    const legalMoves: MoveJSON[] = verbose.map((m) => ({
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
    }))
    const isCheck = chess.inCheck()
    const hasMoves = verbose.length > 0
    const isCheckmate = isCheck && !hasMoves
    const isStalemate = !isCheck && !hasMoves
    const is50 = Number(fields[4]) >= 100
    const insufficient = chess.isInsufficientMaterial()
    const isDraw = isStalemate || is50 || insufficient
    const gameOverReason = isCheckmate
      ? 'checkmate'
      : isStalemate
        ? 'stalemate'
        : is50
          ? '50-move rule'
          : insufficient
            ? 'insufficient material'
            : ''
    const cur = this.current
    return {
      id: this.id,
      fen: cur.fen,
      turn: fields[1] === 'b' ? 'b' : 'w',
      fullMove: Number(fields[5]) || 1,
      pieces,
      legalMoves,
      lastMove: cur.parent && cur.from && cur.to ? { from: cur.from, to: cur.to, ...(cur.promotion ? { promotion: cur.promotion } : {}) } : null,
      isCheck,
      isCheckmate,
      isStalemate,
      isDraw,
      isGameOver: isCheckmate || isDraw,
      gameOverReason,
      moveTree: toMoveNode(this.root),
      currentNodeId: cur.id,
    }
  }
}

function toMoveNode(node: TreeNode): MoveNode {
  return {
    id: node.id,
    san: node.san,
    fen: node.fen,
    ply: node.ply,
    ...(node.from ? { from: node.from, to: node.to } : {}),
    ...(node.promotion ? { promotion: node.promotion } : {}),
    children: node.children.map(toMoveNode),
  }
}

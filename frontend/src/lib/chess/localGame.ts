import { Chess } from 'chess.js'
import type { GameState, MoveJSON, PieceJSON } from '@/lib/api/client'
import type { MoveNode } from './types'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

interface TreeNode {
  id: string
  san: string
  fen: string
  repetitionKey: string
  ply: number
  from?: string
  to?: string
  promotion?: string
  parent: TreeNode | null
  children: TreeNode[]
  view: MoveNode
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

function repetitionKey(fen: string): string {
  const fields = fen.split(' ')
  if (fields.length < 4) return fen
  if (fields[3] !== '-') {
    const chess = new Chess(fen)
    if (!chess.moves({ verbose: true }).some((move) => move.isEnPassant())) fields[3] = '-'
  }
  return fields.slice(0, 4).join(' ')
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
  private nodes = new Map<string, TreeNode>()
  private counter = 0
  readonly id = 'local'

  constructor(fen: string = START_FEN) {
    new Chess(fen)
    this.root = this.createNode({ id: '0', san: '', fen, ply: rootPly(fen), parent: null })
    this.current = this.root
    this.nodes.set(this.root.id, this.root)
  }

  private nextId(): string {
    this.counter++
    return String(this.counter)
  }

  private createNode(input: {
    id: string
    san: string
    fen: string
    ply: number
    parent: TreeNode | null
    from?: string
    to?: string
    promotion?: string
  }): TreeNode {
    const view: MoveNode = {
      id: input.id,
      san: input.san,
      fen: input.fen,
      ply: input.ply,
      ...(input.from ? { from: input.from, to: input.to } : {}),
      ...(input.promotion ? { promotion: input.promotion } : {}),
      children: [],
    }
    return { ...input, repetitionKey: repetitionKey(input.fen), children: [], view }
  }

  private rebuildViewPath(node: TreeNode | null): void {
    for (let current = node; current; current = current.parent) {
      current.view = { ...current.view, children: current.children.map((child) => child.view) }
    }
  }

  private removeFromIndex(node: TreeNode): void {
    this.nodes.delete(node.id)
    for (const child of node.children) this.removeFromIndex(child)
  }

  private isThreefoldRepetition(): boolean {
    let repetitions = 0
    for (let node: TreeNode | null = this.current; node; node = node.parent) {
      if (node.repetitionKey === this.current.repetitionKey) repetitions++
    }
    return repetitions >= 3
  }

  resetTo(fen: string = START_FEN): void {
    new Chess(fen)
    this.root = this.createNode({ id: '0', san: '', fen, ply: rootPly(fen), parent: null })
    this.current = this.root
    this.nodes = new Map([[this.root.id, this.root]])
    this.counter = 0
  }

  get currentSan(): string {
    return this.current.san ?? ''
  }

  get currentFen(): string {
    return this.current.fen
  }

  gotoNode(id: string): boolean {
    const node = this.nodes.get(id)
    if (!node) return false
    this.current = node
    return true
  }

  deleteNode(id: string): boolean {
    if (id === this.root.id) return false
    const target = this.nodes.get(id)
    if (!target || !target.parent) return false
    const parent = target.parent
    parent.children = parent.children.filter((c) => c !== target)
    this.removeFromIndex(target)
    this.rebuildViewPath(parent)
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
    if (chess.isGameOver() || this.isThreefoldRepetition()) return false
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
    const nextFen = chess.fen()
    const node = this.createNode({
      id: this.nextId(),
      san: legal.san,
      fen: nextFen,
      ply: this.current.ply + 1,
      from: legal.from,
      to: legal.to,
      ...(legal.promotion ? { promotion: legal.promotion } : {}),
      parent: this.current,
    })
    this.current.children.push(node)
    this.nodes.set(node.id, node)
    this.rebuildViewPath(this.current)
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
    const isCheck = chess.inCheck()
    const hasMoves = verbose.length > 0
    const isCheckmate = isCheck && !hasMoves
    const isStalemate = !isCheck && !hasMoves
    const is50 = Number(fields[4]) >= 100
    const insufficient = chess.isInsufficientMaterial()
    const isThreefold = this.isThreefoldRepetition()
    const isDraw = isStalemate || is50 || isThreefold || insufficient
    const isGameOver = isCheckmate || isDraw
    const legalMoves: MoveJSON[] = isGameOver
      ? []
      : verbose.map((m) => ({
          from: m.from,
          to: m.to,
          ...(m.promotion ? { promotion: m.promotion } : {}),
        }))
    const gameOverReason = isCheckmate
      ? 'checkmate'
      : isStalemate
        ? 'stalemate'
        : is50
          ? '50-move rule'
          : isThreefold
            ? 'threefold repetition'
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
      isGameOver,
      gameOverReason,
      moveTree: this.root.view,
      currentNodeId: cur.id,
    }
  }
}

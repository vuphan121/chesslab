import { describe, expect, it } from 'vitest'
import { LocalGame, START_FEN, tokenizePgnMoves } from './localGame'

describe('LocalGame', () => {
  it('starts with the standard position', () => {
    const gs = new LocalGame().snapshot()
    expect(gs.fen).toBe(START_FEN)
    expect(Object.keys(gs.pieces)).toHaveLength(32)
    expect(gs.legalMoves).toHaveLength(20)
    expect(gs.turn).toBe('w')
    expect(gs.lastMove).toBeNull()
    expect(gs.moveTree.id).toBe('0')
    expect(gs.currentNodeId).toBe('0')
    expect(gs.isGameOver).toBe(false)
  })

  it('plays a move and records san, ply and last move', () => {
    const g = new LocalGame()
    expect(g.applyMove('e2', 'e4')).toBe(true)
    const gs = g.snapshot()
    expect(gs.moveTree.children).toHaveLength(1)
    const node = gs.moveTree.children[0]
    expect(node).toMatchObject({ san: 'e4', ply: 1, from: 'e2', to: 'e4' })
    expect(gs.lastMove).toEqual({ from: 'e2', to: 'e4' })
    expect(gs.turn).toBe('b')
    expect(gs.currentNodeId).toBe(node.id)
  })

  it('rejects illegal moves', () => {
    const g = new LocalGame()
    expect(g.applyMove('e2', 'e5')).toBe(false)
    expect(g.snapshot().moveTree.children).toHaveLength(0)
  })

  it('reuses an existing continuation and makes a sideline for a new move', () => {
    const g = new LocalGame()
    g.applyMove('e2', 'e4')
    g.gotoNode('0')
    g.applyMove('e2', 'e4')
    expect(g.snapshot().moveTree.children).toHaveLength(1)
    g.gotoNode('0')
    g.applyMove('d2', 'd4')
    const tree = g.snapshot().moveTree
    expect(tree.children.map((c) => c.san)).toEqual(['e4', 'd4'])
  })

  it('navigates and deletes a node together with its subtree', () => {
    const g = new LocalGame()
    g.applyMove('e2', 'e4')
    g.applyMove('e7', 'e5')
    const first = g.snapshot().moveTree.children[0]
    expect(g.gotoNode(first.id)).toBe(true)
    expect(g.gotoNode('nope')).toBe(false)
    g.gotoNode(first.children[0].id)
    expect(g.deleteNode(first.id)).toBe(true)
    const gs = g.snapshot()
    expect(gs.moveTree.children).toHaveLength(0)
    expect(gs.currentNodeId).toBe('0')
    expect(g.deleteNode('0')).toBe(false)
  })

  it('numbers plies from a Black-to-move root', () => {
    const g = new LocalGame('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1')
    g.applyMove('g8', 'f6')
    const tree = g.snapshot().moveTree
    expect(tree.ply).toBe(1)
    expect(tree.children[0].ply).toBe(2)
  })

  it('promotes to a queen by default and to the requested piece', () => {
    const fen = '8/P3k3/8/8/8/8/8/4K3 w - - 0 1'
    const a = new LocalGame(fen)
    a.applyMove('a7', 'a8')
    expect(a.snapshot().moveTree.children[0]).toMatchObject({ san: 'a8=Q', promotion: 'q' })
    const b = new LocalGame(fen)
    b.applyMove('a7', 'a8', 'n')
    expect(b.snapshot().moveTree.children[0].promotion).toBe('n')
  })

  it('castles by moving the king two squares', () => {
    const g = new LocalGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    expect(g.applyMove('e1', 'g1')).toBe(true)
    expect(g.snapshot().moveTree.children[0].san).toBe('O-O')
  })

  it('reports checkmate and stalemate', () => {
    const mate = new LocalGame()
    for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) mate.applyMove(f, t)
    const gs = mate.snapshot()
    expect(gs).toMatchObject({ isCheck: true, isCheckmate: true, isGameOver: true, gameOverReason: 'checkmate' })
    expect(gs.legalMoves).toHaveLength(0)
    const stale = new LocalGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').snapshot()
    expect(stale).toMatchObject({ isStalemate: true, isDraw: true, gameOverReason: 'stalemate' })
  })

  it('flags the 50-move rule and insufficient material', () => {
    expect(new LocalGame('8/8/8/8/8/5k2/8/4K2R w - - 100 80').snapshot().gameOverReason).toBe('50-move rule')
    expect(new LocalGame('8/8/8/8/8/5k2/8/4K3 w - - 0 80').snapshot().gameOverReason).toBe('insufficient material')
  })
})

describe('loadPgn', () => {
  it('replays a move list from the start position', () => {
    const g = new LocalGame()
    g.applyMove('a2', 'a3')
    const res = g.loadPgn('1. e4 e5 2. Nf3 Nc6')
    expect(res).toEqual({ appliedPlies: 4, totalTokens: 4 })
    const gs = g.snapshot()
    expect(gs.moveTree.children).toHaveLength(1)
    expect(gs.moveTree.children[0].san).toBe('e4')
    expect(gs.currentNodeId).not.toBe('0')
  })

  it('keeps the valid prefix and reports the first bad move', () => {
    const g = new LocalGame()
    const res = g.loadPgn('1. e4 e5 2. Qh5 Ke2')
    expect(res.appliedPlies).toBe(3)
    expect(res.totalTokens).toBe(4)
    expect(res.error).toContain('move 4')
  })

  it('throws when there are no moves', () => {
    expect(() => new LocalGame().loadPgn('{just a comment}')).toThrow('no moves found in pgn')
  })
})

describe('tokenizePgnMoves', () => {
  it('drops headers, comments, variations, NAGs, results and move numbers', () => {
    const pgn = `[Event "x"]\n[Site "y"]\n\n1. e4 {best} e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 ; rest of line\n3.Bb5 1-0`
    expect(tokenizePgnMoves(pgn)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
  })

  it('accepts zero-castling', () => {
    const g = new LocalGame()
    expect(g.loadPgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0').appliedPlies).toBe(7)
  })
})

'use client'

import { playMoveSound } from '@/lib/sound'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { GameState, Explorer } from '@/lib/api/client'
import type { BoardState, Square } from '@/lib/chess/types'
import { flatten, mainlineEnd, childrenOf } from '@/lib/chess/moveTree'
import { LocalGame } from '@/lib/chess/localGame'
import { cachedExplorer, fetchExplorer } from '@/lib/lichess/explorer'

function toBoardState(gs: GameState, selectedSquare: Square | null): BoardState {
  const pieces: BoardState['pieces'] = {}
  for (const [sq, p] of Object.entries(gs.pieces)) {
    pieces[sq] = { type: p.type, color: p.color }
  }

  const legalMoves = selectedSquare
    ? gs.legalMoves.filter((m) => m.from === selectedSquare).map((m) => m.to)
    : []

  return {
    fen: gs.fen,
    pieces,
    turn: gs.turn,
    fullMove: gs.fullMove,
    selectedSquare,
    legalMoves,
    lastMove: gs.lastMove ? { from: gs.lastMove.from, to: gs.lastMove.to } : null,
    isCheck: gs.isCheck,
    isGameOver: gs.isGameOver,
    gameOverReason: gs.isCheckmate
      ? 'checkmate'
      : gs.isStalemate
        ? 'stalemate'
        : gs.isDraw
          ? gs.gameOverReason
          : null,
    moveTree: gs.moveTree,
    currentNodeId: gs.currentNodeId,
  }
}

export function useChessGame() {
  const [game] = useState(() => new LocalGame())
  const [gs, setGs] = useState<GameState>(() => game.snapshot())
  const [selected, setSelected] = useState<Square | null>(null)
  const [explorer, setExplorer] = useState<Explorer | null>(null)
  const [explorerLoading, setExplorerLoading] = useState(true)
  const [openingByFen, setOpeningByFen] = useState<Record<string, { name: string; eco?: string }>>({})
  const [flipped, setFlipped] = useState(false)
  const explorerReqId = useRef(0)
  const explorerAbort = useRef<AbortController | null>(null)

  const runExplorer = useCallback(async (fen: string): Promise<void> => {
    const reqId = ++explorerReqId.current
    explorerAbort.current?.abort()
    explorerAbort.current = null
    const apply = (e: Explorer) => {
      setExplorer(e)
      if (e.openingName) {
        const opening = { name: e.openingName, eco: e.openingEco }
        setOpeningByFen((prev) => ({ ...prev, [fen]: opening }))
      }
    }
    const hit = cachedExplorer(fen)
    if (hit) {
      apply(hit)
      setExplorerLoading(false)
      return
    }
    setExplorer(null)
    setExplorerLoading(true)
    const controller = new AbortController()
    explorerAbort.current = controller
    try {
      const e = await fetchExplorer(fen, controller.signal)
      if (reqId === explorerReqId.current) apply(e)
    } catch {
    } finally {
      if (explorerAbort.current === controller) explorerAbort.current = null
      if (reqId === explorerReqId.current) setExplorerLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => runExplorer(game.currentFen))
    return () => explorerAbort.current?.abort()
  }, [game, runExplorer])

  const commit = useCallback(
    (sound = true) => {
      const next = game.snapshot()
      setGs(next)
      setSelected(null)
      if (sound) playMoveSound(game.currentSan.includes('x'))
      runExplorer(next.fen)
    },
    [game, runExplorer],
  )

  const toggleFlipped = useCallback(() => {
    setFlipped((f) => !f)
  }, [])

  const boardState: BoardState = toBoardState(gs, selected)

  const lastOpening = useMemo(() => {
    const flat = flatten(gs.moveTree)
    for (let entry = flat.get(gs.currentNodeId); entry; entry = entry.parentId ? flat.get(entry.parentId) : undefined) {
      const opening = openingByFen[entry.node.fen]
      if (opening) return opening
    }
    return null
  }, [gs, openingByFen])

  const move = useCallback(
    (from: Square, to: Square, promotion?: string) => {
      if (game.applyMove(from, to, promotion)) commit()
      else setSelected(null)
    },
    [game, commit],
  )

  const selectSquare = useCallback(
    (square: Square) => {
      if (selected === square) {
        setSelected(null)
        return
      }
      if (selected && gs.legalMoves.some((m) => m.from === selected && m.to === square)) {
        move(selected, square)
        return
      }
      const piece = gs.pieces[square]
      setSelected(piece && piece.color === gs.turn ? square : null)
    },
    [gs, selected, move],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] => gs.legalMoves.filter((m) => m.from === square).map((m) => m.to),
    [gs],
  )

  const gotoNodeId = useCallback(
    (nodeId: string) => {
      if (nodeId === gs.currentNodeId) return
      if (game.gotoNode(nodeId)) commit()
    },
    [game, gs.currentNodeId, commit],
  )

  const navPrev = useCallback(() => {
    const parentId = flatten(gs.moveTree).get(gs.currentNodeId)?.parentId
    if (parentId != null) gotoNodeId(parentId)
  }, [gs, gotoNodeId])

  const navNext = useCallback(() => {
    const cur = flatten(gs.moveTree).get(gs.currentNodeId)?.node
    const child = cur ? childrenOf(cur)[0] : undefined
    if (child) gotoNodeId(child.id)
  }, [gs, gotoNodeId])

  const navStart = useCallback(() => {
    gotoNodeId(gs.moveTree.id)
  }, [gs, gotoNodeId])

  const navEnd = useCallback(() => {
    const cur = flatten(gs.moveTree).get(gs.currentNodeId)?.node
    if (cur) gotoNodeId(mainlineEnd(cur).id)
  }, [gs, gotoNodeId])

  const reset = useCallback(() => {
    game.resetTo()
    setExplorer(null)
    commit(false)
  }, [game, commit])

  const loadPgn = useCallback(
    async (pgn: string) => {
      const result = game.loadPgn(pgn)
      commit()
      if (result.error) {
        throw new Error(`Loaded ${result.appliedPlies}/${result.totalTokens} moves — ${result.error}`)
      }
    },
    [game, commit],
  )

  return {
    boardState,
    selectSquare,
    move,
    legalMovesFor,
    gotoNode: gotoNodeId,
    navStart,
    navPrev,
    navNext,
    navEnd,
    reset,
    loadPgn,
    explorer,
    explorerLoading,
    lastOpening,
    flipped,
    toggleFlipped,
  }
}

'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  createGame,
  getGame,
  makeMove,
  getExplorer,
  gotoNode as apiGotoNode,
  loadPGN,
} from '@/lib/api/client'
import type { GameState, Explorer } from '@/lib/api/client'
import type { BoardState, Square } from '@/lib/chess/types'
import { flatten, mainlineEnd, childrenOf } from '@/lib/chess/moveTree'
import { fenAfterMove } from '@/lib/chess/optimisticFen'




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





export function useChessGame(initialGameId?: string) {
  const [gs, setGs] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [busy, setBusy] = useState(false)
  const [explorer, setExplorer] = useState<Explorer | null>(null)
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [openingByFen, setOpeningByFen] = useState<Record<string, { name: string; eco?: string }>>({})
  const [flipped, setFlipped] = useState(false)
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null)
  const moveSound = useRef<HTMLAudioElement | null>(null)
  const gameActionReqId = useRef(0)
  const explorerReqId = useRef(0)

  const runExplorer = useCallback(async (gameId: string, fen?: string): Promise<Explorer | null> => {
    const reqId = ++explorerReqId.current
    setExplorerLoading(true)
    try {
      const e = await getExplorer(gameId, fen)
      if (reqId === explorerReqId.current) {
        setExplorer(e)
        if (e?.openingName && fen) {
          const opening = { name: e.openingName, eco: e.openingEco }
          setOpeningByFen((prev) => ({ ...prev, [fen]: opening }))
        }
      }
      return e
    } catch {

      return null
    } finally {
      if (reqId === explorerReqId.current) setExplorerLoading(false)
    }
  }, [])








  const refreshInsights = useCallback(
    async (gameId: string, fen?: string) => {
      await runExplorer(gameId, fen)
    },
    [runExplorer],
  )

  useEffect(() => {
    let cancelled = false
    const reqId = ++gameActionReqId.current
    moveSound.current = new Audio('/sounds/move.mp3')
    const load = initialGameId ? getGame(initialGameId) : createGame()
    load.then((g) => {
      if (cancelled || reqId !== gameActionReqId.current) return
      setGs(g)
      refreshInsights(g.id, g.fen)
    }).catch(console.error)
    return () => {
      cancelled = true
    }
  }, [initialGameId, refreshInsights])







  const toggleFlipped = useCallback(() => {
    setFlipped((f) => !f)
  }, [])

  const boardState: BoardState | null = gs ? toBoardState(gs, selected) : null

  const lastOpening = useMemo(() => {
    if (!gs) return null
    const flat = flatten(gs.moveTree)
    for (let entry = flat.get(gs.currentNodeId); entry; entry = entry.parentId ? flat.get(entry.parentId) : undefined) {
      const opening = openingByFen[entry.node.fen]
      if (opening) return opening
    }
    return null
  }, [gs, openingByFen])

  const selectSquare = useCallback(
    async (square: Square) => {
      if (!gs || busy) return

      if (selected === square) {
        setSelected(null)
        return
      }

      if (selected) {
        const isLegal = gs.legalMoves.some((m) => m.from === selected && m.to === square)
        if (isLegal) {
          setBusy(true)
          const reqId = ++gameActionReqId.current
          try {
            const piece = gs.pieces[selected]
            const isPromo =
              piece?.type === 'p' &&
              ((piece.color === 'w' && square[1] === '8') ||
                (piece.color === 'b' && square[1] === '1'))
            const promo = isPromo ? 'q' : undefined
            const predicted = fenAfterMove(gs.fen, selected, square, promo)
            if (predicted) {
              setOptimisticFen(predicted)
              moveSound.current?.play().catch(() => {})
            }
            const next = await makeMove(gs.id, selected, square, promo)
            if (reqId !== gameActionReqId.current) return
            setGs(next)
            setSelected(null)
            if (!predicted) moveSound.current?.play().catch(() => {})
            refreshInsights(next.id, next.fen)
          } catch {
            if (reqId === gameActionReqId.current) setSelected(null)
          } finally {
            if (reqId === gameActionReqId.current) {
              setBusy(false)
              setOptimisticFen(null)
            }
          }
          return
        }
      }

      const piece = gs.pieces[square]
      if (piece && piece.color === gs.turn) {
        setSelected(square)
      } else {
        setSelected(null)
      }
    },
    [gs, selected, busy, refreshInsights],
  )

  const move = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      if (!gs || busy) return
      setBusy(true)
      const reqId = ++gameActionReqId.current
      try {
        const piece = gs.pieces[from]
        const isPromo =
          piece?.type === 'p' &&
          ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'))
        const promo = promotion ?? (isPromo ? 'q' : undefined)
        const predicted = fenAfterMove(gs.fen, from, to, promo)
        if (predicted) {
          setOptimisticFen(predicted)
          moveSound.current?.play().catch(() => {})
        }
        const next = await makeMove(gs.id, from, to, promo)
        if (reqId !== gameActionReqId.current) return
        setGs(next)
        setSelected(null)
        if (!predicted) moveSound.current?.play().catch(() => {})
        refreshInsights(next.id, next.fen)
      } catch {
        if (reqId === gameActionReqId.current) setSelected(null)
      } finally {
        if (reqId === gameActionReqId.current) {
          setBusy(false)
          setOptimisticFen(null)
        }
      }
    },
    [gs, busy, refreshInsights],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] => {
      if (!gs) return []
      return gs.legalMoves.filter((m) => m.from === square).map((m) => m.to)
    },
    [gs],
  )



  const gotoNodeId = useCallback(
    async (nodeId: string) => {
      if (!gs || busy || nodeId === gs.currentNodeId) return
      setBusy(true)
      const reqId = ++gameActionReqId.current
      try {
        const next = await apiGotoNode(gs.id, nodeId)
        if (reqId !== gameActionReqId.current) return
        setGs(next)
        setSelected(null)
        moveSound.current?.play().catch(() => {})
        refreshInsights(next.id, next.fen)
      } catch {

      } finally {
        if (reqId === gameActionReqId.current) setBusy(false)
      }
    },
    [gs, busy, refreshInsights],
  )

  const navPrev = useCallback(() => {
    if (!gs) return
    const parentId = flatten(gs.moveTree).get(gs.currentNodeId)?.parentId
    if (parentId != null) gotoNodeId(parentId)
  }, [gs, gotoNodeId])

  const navNext = useCallback(() => {
    if (!gs) return
    const cur = flatten(gs.moveTree).get(gs.currentNodeId)?.node
    const child = cur ? childrenOf(cur)[0] : undefined
    if (child) gotoNodeId(child.id)
  }, [gs, gotoNodeId])

  const navStart = useCallback(() => {
    if (!gs) return
    gotoNodeId(gs.moveTree.id)
  }, [gs, gotoNodeId])

  const navEnd = useCallback(() => {
    if (!gs) return
    const cur = flatten(gs.moveTree).get(gs.currentNodeId)?.node
    if (cur) gotoNodeId(mainlineEnd(cur).id)
  }, [gs, gotoNodeId])

  const reset = useCallback(async () => {
    const reqId = ++gameActionReqId.current
    setBusy(true)
    try {
      const next = await createGame()
      if (reqId !== gameActionReqId.current) return
      setGs(next)
      setSelected(null)
      setExplorer(null)
      refreshInsights(next.id, next.fen)
    } finally {
      if (reqId === gameActionReqId.current) setBusy(false)
    }
  }, [refreshInsights])




  const loadPgn = useCallback(
    async (pgn: string) => {
      if (!gs || busy) return
      setBusy(true)
      const reqId = ++gameActionReqId.current
      try {
        const next = await loadPGN(gs.id, pgn)
        if (reqId !== gameActionReqId.current) return
          setGs(next)
        setSelected(null)
          moveSound.current?.play().catch(() => {})
        refreshInsights(next.id, next.fen)
        if (next.error) {
          throw new Error(
            `Loaded ${next.appliedPlies}/${next.totalTokens} moves — ${next.error}`,
          )
        }
      } finally {
        if (reqId === gameActionReqId.current) setBusy(false)
      }
    },
    [gs, busy, refreshInsights],
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
    busy,
    optimisticFen,
    gameId: gs?.id ?? null,
    explorer,
    explorerLoading,
    lastOpening,
    flipped,
    toggleFlipped,
  }
}

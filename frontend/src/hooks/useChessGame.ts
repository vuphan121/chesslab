'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  createGame,
  getGame,
  makeMove,
  analyzeGame,
  getExplorer,
  gotoNode as apiGotoNode,
  loadPGN,
} from '@/lib/api/client'
import type { GameState, Analysis, Explorer } from '@/lib/api/client'
import type { BoardState, Square } from '@/lib/chess/types'
import { flatten, mainlineEnd, childrenOf } from '@/lib/chess/moveTree'




function toBoardState(gs: GameState, selectedSquare: Square | null): BoardState {
  const pieces: BoardState['pieces'] = {}
  for (const [sq, p] of Object.entries(gs.pieces)) {
    pieces[sq] = { type: p.type as any, color: p.color as any }
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
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [explorer, setExplorer] = useState<Explorer | null>(null)
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const moveSound = useRef<HTMLAudioElement | null>(null)
  // Per-FEN analysis cache + request guard: revisiting a position (stepping
  // back/forward) is instant, and a slow deep pass can't overwrite the readout
  // for a position the user has already navigated away from.
  const analysisCacheRef = useRef<Map<string, Analysis>>(new Map())
  const analysisReqId = useRef(0)

  const runAnalysis = useCallback(async (gameId: string, fen?: string): Promise<Analysis | null> => {
    if (fen) {
      const cached = analysisCacheRef.current.get(fen)
      if (cached) {
        setAnalysis(cached)
        setAnalyzing(false)
        return cached
      }
    }
    const reqId = ++analysisReqId.current
    setAnalyzing(true)
    try {
      // Quick pass first (depth-10 / short cloud timeout) so the bar updates
      // almost immediately, then refine with a full-depth pass unless the quick
      // result was already a deep cloud hit.
      const quick = await analyzeGame(gameId, 'quick')
      if (reqId === analysisReqId.current) setAnalysis(quick)
      if (fen) analysisCacheRef.current.set(fen, quick)
      if (quick.engineName === 'Lichess Cloud') return quick
      const deep = await analyzeGame(gameId)
      if (reqId === analysisReqId.current) setAnalysis(deep)
      if (fen) analysisCacheRef.current.set(fen, deep)
      return deep
    } catch {
      return null
    } finally {
      if (reqId === analysisReqId.current) setAnalyzing(false)
    }
  }, [])

  const runExplorer = useCallback(async (gameId: string): Promise<Explorer | null> => {
    setExplorerLoading(true)
    try {
      const e = await getExplorer(gameId)
      setExplorer(e)
      return e
    } catch {

      return null
    } finally {
      setExplorerLoading(false)
    }
  }, [])








  const refreshInsights = useCallback(
    async (gameId: string, fen?: string) => {
      await Promise.all([runAnalysis(gameId, fen), runExplorer(gameId)])
    },
    [runAnalysis, runExplorer],
  )

  useEffect(() => {
    moveSound.current = new Audio('/sounds/move.mp3')
    const load = initialGameId ? getGame(initialGameId) : createGame()
    load.then((g) => {
      setGs(g)
      refreshInsights(g.id, g.fen)
    }).catch(console.error)



  }, [refreshInsights])







  const toggleFlipped = useCallback(() => {
    setFlipped((f) => !f)
  }, [])

  const boardState: BoardState | null = gs ? toBoardState(gs, selected) : null

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
          try {
            const piece = gs.pieces[selected]
            const isPromo =
              piece?.type === 'p' &&
              ((piece.color === 'w' && square[1] === '8') ||
                (piece.color === 'b' && square[1] === '1'))
            const next = await makeMove(gs.id, selected, square, isPromo ? 'q' : undefined)
            setGs(next)
            setSelected(null)
            moveSound.current?.play().catch(() => {})
            refreshInsights(next.id, next.fen)
          } catch {
            setSelected(null)
          } finally {
            setBusy(false)
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
      try {
        const piece = gs.pieces[from]
        const isPromo =
          piece?.type === 'p' &&
          ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'))
        const next = await makeMove(gs.id, from, to, promotion ?? (isPromo ? 'q' : undefined))
        setGs(next)
        setSelected(null)
        moveSound.current?.play().catch(() => {})
        refreshInsights(next.id, next.fen)
      } catch {
        setSelected(null)
      } finally {
        setBusy(false)
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
      try {
        const next = await apiGotoNode(gs.id, nodeId)
        setGs(next)
        setSelected(null)
        moveSound.current?.play().catch(() => {})
        refreshInsights(next.id, next.fen)
      } catch {

      } finally {
        setBusy(false)
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
    setBusy(true)
    try {
      const next = await createGame()
      analysisCacheRef.current.clear()
      setGs(next)
      setSelected(null)
      setAnalysis(null)
      setExplorer(null)
      refreshInsights(next.id, next.fen)
    } finally {
      setBusy(false)
    }
  }, [refreshInsights])




  const loadPgn = useCallback(
    async (pgn: string) => {
      if (!gs || busy) return
      setBusy(true)
      try {
        const next = await loadPGN(gs.id, pgn)
        analysisCacheRef.current.clear()
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
        setBusy(false)
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
    analysis,
    analyzing,
    explorer,
    explorerLoading,
    flipped,
    toggleFlipped,
  }
}

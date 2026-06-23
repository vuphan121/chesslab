'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createGame, makeMove, analyzeGame } from '@/lib/api/client'
import type { GameState, Analysis } from '@/lib/api/client'
import type { BoardState, Square } from '@/lib/chess/types'

function toBoardState(gs: GameState, selectedSquare: Square | null): BoardState {
  const pieces: BoardState['pieces'] = {}
  for (const [sq, p] of Object.entries(gs.pieces)) {
    pieces[sq] = { type: p.type as any, color: p.color as any }
  }

  const legalMoves = selectedSquare
    ? gs.legalMoves.filter((m) => m.from === selectedSquare).map((m) => m.to)
    : []

  return {
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
  }
}

export function useChessGame() {
  const [gs, setGs] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const moveSound = useRef<HTMLAudioElement | null>(null)

  const runAnalysis = useCallback(async (gameId: string) => {
    setAnalyzing(true)
    try {
      const a = await analyzeGame(gameId)
      setAnalysis(a)
    } catch {
      // engine not configured or game over — leave previous analysis visible
    } finally {
      setAnalyzing(false)
    }
  }, [])

  useEffect(() => {
    moveSound.current = new Audio('/sounds/move.mp3')
    createGame().then((g) => {
      setGs(g)
      runAnalysis(g.id)
    }).catch(console.error)
  }, [runAnalysis])

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
            runAnalysis(next.id)
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
    [gs, selected, busy, runAnalysis],
  )

  const move = useCallback(
    async (from: Square, to: Square) => {
      if (!gs || busy) return
      setBusy(true)
      try {
        const piece = gs.pieces[from]
        const isPromo =
          piece?.type === 'p' &&
          ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'))
        const next = await makeMove(gs.id, from, to, isPromo ? 'q' : undefined)
        setGs(next)
        setSelected(null)
        moveSound.current?.play().catch(() => {})
        runAnalysis(next.id)
      } catch {
        setSelected(null)
      } finally {
        setBusy(false)
      }
    },
    [gs, busy, runAnalysis],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] => {
      if (!gs) return []
      return gs.legalMoves.filter((m) => m.from === square).map((m) => m.to)
    },
    [gs],
  )

  const reset = useCallback(async () => {
    setBusy(true)
    try {
      const next = await createGame()
      setGs(next)
      setSelected(null)
      setAnalysis(null)
      runAnalysis(next.id)
    } finally {
      setBusy(false)
    }
  }, [runAnalysis])

  return { boardState, selectSquare, move, legalMovesFor, reset, busy, analysis, analyzing }
}

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
  explainMove,
  coachChat,
  CoachUnavailableError,
} from '@/lib/api/client'
import type { GameState, Analysis, Explorer, ChatTurn } from '@/lib/api/client'
import type { BoardState, Square } from '@/lib/chess/types'
import { flatten, mainlineEnd, childrenOf } from '@/lib/chess/moveTree'




function nodeMeta(gs: GameState, nodeId: string): { san: string; prevFen: string } {
  const map = flatten(gs.moveTree)
  const entry = map.get(nodeId)
  const san = entry?.node.san ?? ''
  const parentId = entry?.parentId
  const prevFen = parentId != null ? (map.get(parentId)?.node.fen ?? '') : ''
  return { san, prevFen }
}


function coachErrorMessage(err: unknown): string {
  if (err instanceof CoachUnavailableError) {
    return 'Coach is offline — start a local model (Ollama) to enable it.'
  }
  return 'Coach is unavailable right now. Please try again.'
}

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
  const [coachExplanation, setCoachExplanation] = useState<string | null>(null)
  const [coachExplaining, setCoachExplaining] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)


  const [flipped, setFlipped] = useState(false)
  const moveSound = useRef<HTMLAudioElement | null>(null)


  const explainReqId = useRef(0)

  const runAnalysis = useCallback(async (gameId: string): Promise<Analysis | null> => {
    setAnalyzing(true)
    try {
      const a = await analyzeGame(gameId)
      setAnalysis(a)
      return a
    } catch {

      return null
    } finally {
      setAnalyzing(false)
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
    async (gameId: string) => {
      explainReqId.current++
      setCoachExplanation(null)
      setCoachError(null)
      setCoachExplaining(false)
      await Promise.all([runAnalysis(gameId), runExplorer(gameId)])
    },
    [runAnalysis, runExplorer],
  )

  useEffect(() => {
    moveSound.current = new Audio('/sounds/move.mp3')
    const load = initialGameId ? getGame(initialGameId) : createGame()
    load.then((g) => {
      setGs(g)
      refreshInsights(g.id)
    }).catch(console.error)



  }, [refreshInsights])







  const askCoach = useCallback(async () => {
    if (!gs) return
    const { san, prevFen } = nodeMeta(gs, gs.currentNodeId)
    if (!san) return

    const reqId = ++explainReqId.current
    setCoachError(null)
    setCoachExplaining(true)
    setCoachExplanation(null)
    try {
      const res = await explainMove(gs.id, {
        fen: gs.fen,
        prevFen,
        lastMoveSan: san,
        viewerColor: flipped ? 'b' : 'w',
        analysis,
        explorer,
      })
      if (reqId === explainReqId.current) setCoachExplanation(res.explanation)
    } catch (err) {
      if (reqId === explainReqId.current) {
        setCoachExplanation(null)
        setCoachError(coachErrorMessage(err))
      }
    } finally {
      if (reqId === explainReqId.current) setCoachExplaining(false)
    }
  }, [gs, analysis, explorer, flipped])




  const toggleFlipped = useCallback(() => {
    setFlipped((f) => !f)
    explainReqId.current++
    setCoachExplanation(null)
    setCoachError(null)
    setCoachExplaining(false)
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
            refreshInsights(next.id)
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
        refreshInsights(next.id)
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
        refreshInsights(next.id)
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
      setGs(next)
      setSelected(null)
      setAnalysis(null)
      setExplorer(null)
      refreshInsights(next.id)
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
        setGs(next)
        setSelected(null)
        moveSound.current?.play().catch(() => {})
        refreshInsights(next.id)
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




  const sendCoachChat = useCallback(
    async (message: string, history: ChatTurn[]): Promise<string> => {
      if (!gs) throw new Error('Game not ready yet.')
      try {
        const res = await coachChat(gs.id, message, history)
        return res.reply
      } catch (err) {
        throw new Error(coachErrorMessage(err))
      }
    },
    [gs],
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
    coachExplanation,
    coachExplaining,
    coachError,
    askCoach,
    flipped,
    toggleFlipped,
    sendCoachChat,
  }
}

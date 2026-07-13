'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  createGame,
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

// nodeMeta returns the SAN of the move that reached the given node and the FEN
// of the position just before it (both empty at the root — no move played).
// prevFen lets the coach classify the move (gambit-aware) without a store race.
function nodeMeta(gs: GameState, nodeId: string): { san: string; prevFen: string } {
  const map = flatten(gs.moveTree)
  const entry = map.get(nodeId)
  const san = entry?.node.san ?? ''
  const parentId = entry?.parentId
  const prevFen = parentId != null ? (map.get(parentId)?.node.fen ?? '') : ''
  return { san, prevFen }
}

// coachErrorMessage turns a thrown coach error into a short, user-facing line.
function coachErrorMessage(err: unknown): string {
  if (err instanceof CoachUnavailableError) {
    return 'Coach is offline — start a local model (Ollama) to enable it.'
  }
  return 'Coach is unavailable right now. Please try again.'
}

// EXPLAIN_DEBOUNCE_MS delays the per-move explanation so rapid move-tree
// navigation (holding an arrow key) only explains the position you land on,
// instead of firing a slow local-model call for every position passed through.
const EXPLAIN_DEBOUNCE_MS = 350

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

export function useChessGame() {
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
  // Board orientation. Lives here (not just in page.tsx) because flipping is
  // also which side the coach is currently addressing — see the effect below
  // that re-explains the current move for the new viewer on every flip.
  const [flipped, setFlipped] = useState(false)
  const moveSound = useRef<HTMLAudioElement | null>(null)
  // Monotonic id so a slow per-move explanation from an earlier position can't
  // overwrite the explanation for the position the user has since moved to.
  const explainReqId = useRef(0)
  const explainTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always-fresh snapshot of state the flip-triggered recompute effect needs,
  // read without making the effect re-fire on every ordinary move/analysis
  // update (it should only fire when `flipped` itself changes).
  const latestRef = useRef<{ gs: GameState | null; analysis: Analysis | null; explorer: Explorer | null }>({
    gs: null,
    analysis: null,
    explorer: null,
  })
  // Mirrors `flipped` for refreshInsights to read without depending on it —
  // refreshInsights must stay referentially stable across flips because the
  // mount effect below depends on it; if its identity changed on every flip,
  // that effect would re-fire and create a brand-new game on every flip.
  const flippedRef = useRef(false)
  useEffect(() => {
    flippedRef.current = flipped
  }, [flipped])

  const runAnalysis = useCallback(async (gameId: string): Promise<Analysis | null> => {
    setAnalyzing(true)
    try {
      const a = await analyzeGame(gameId)
      setAnalysis(a)
      return a
    } catch {
      // engine not configured or game over — leave previous analysis visible
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
      // explorer not configured (e.g. missing LICHESS_TOKEN) — leave previous data visible
      return null
    } finally {
      setExplorerLoading(false)
    }
  }, [])

  // Per-move explanation (coach Path 1). Fires after a move/navigation once the
  // fresh analysis+explorer for the new position are in hand, so the coach has
  // full grounding. Debounced + request-id-guarded against rapid navigation.
  // viewerColor is which side the human is currently studying from (derived
  // from `flipped`) — it re-frames whose perspective the explanation is
  // written from, independent of who actually made the move.
  const runCoachExplain = useCallback(
    (
      gameId: string,
      fen: string,
      san: string,
      prevFen: string,
      a: Analysis | null,
      e: Explorer | null,
      viewerColor: 'w' | 'b',
    ) => {
      if (explainTimer.current) clearTimeout(explainTimer.current)

      // At the root there's no move to explain — clear the panel back to idle.
      if (!san) {
        explainReqId.current++
        setCoachExplaining(false)
        setCoachError(null)
        setCoachExplanation(null)
        return
      }

      const reqId = ++explainReqId.current
      setCoachError(null)
      setCoachExplaining(true)
      explainTimer.current = setTimeout(() => {
        explainMove(gameId, { fen, prevFen, lastMoveSan: san, viewerColor, analysis: a, explorer: e })
          .then((res) => {
            if (reqId === explainReqId.current) setCoachExplanation(res.explanation)
          })
          .catch((err) => {
            if (reqId === explainReqId.current) {
              setCoachExplanation(null)
              setCoachError(coachErrorMessage(err))
            }
          })
          .finally(() => {
            if (reqId === explainReqId.current) setCoachExplaining(false)
          })
      }, EXPLAIN_DEBOUNCE_MS)
    },
    [],
  )

  const refreshInsights = useCallback(
    async (gameId: string, gsForMeta: GameState) => {
      const { san, prevFen } = nodeMeta(gsForMeta, gsForMeta.currentNodeId)
      const [a, e] = await Promise.all([runAnalysis(gameId), runExplorer(gameId)])
      runCoachExplain(gameId, gsForMeta.fen, san, prevFen, a, e, flippedRef.current ? 'b' : 'w')
    },
    [runAnalysis, runExplorer, runCoachExplain],
  )

  useEffect(() => {
    moveSound.current = new Audio('/sounds/move.mp3')
    createGame().then((g) => {
      setGs(g)
      refreshInsights(g.id, g)
    }).catch(console.error)
  }, [refreshInsights])

  // Keep a ref mirror of state the flip-recompute effect below needs, so that
  // effect can depend on `flipped` alone (not gs/analysis/explorer, which
  // change on every move — that would defeat "only recompute on flip").
  useEffect(() => {
    latestRef.current = { gs, analysis, explorer }
  })

  // Flipping the board changes which side the coach addresses as "you/we" —
  // re-explain the current move for the new viewer without refetching
  // analysis/explorer (those don't depend on viewer side, only the prose does).
  useEffect(() => {
    const { gs: g, analysis: a, explorer: e } = latestRef.current
    if (!g) return
    const { san, prevFen } = nodeMeta(g, g.currentNodeId)
    runCoachExplain(g.id, g.fen, san, prevFen, a, e, flipped ? 'b' : 'w')
  }, [flipped, runCoachExplain])

  const toggleFlipped = useCallback(() => setFlipped((f) => !f), [])

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
            refreshInsights(next.id, next)
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
        refreshInsights(next.id, next)
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

  // Navigate to any node in the move tree. Plays the move sound so stepping
  // backward/forward is audible, and keeps every move (no truncation).
  const gotoNodeId = useCallback(
    async (nodeId: string) => {
      if (!gs || busy || nodeId === gs.currentNodeId) return
      setBusy(true)
      try {
        const next = await apiGotoNode(gs.id, nodeId)
        setGs(next)
        setSelected(null)
        moveSound.current?.play().catch(() => {})
        refreshInsights(next.id, next)
      } catch {
        // ignore
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
      refreshInsights(next.id, next)
    } finally {
      setBusy(false)
    }
  }, [refreshInsights])

  // Replaces the whole game with a pasted PGN's move list, replayed from the
  // start position. Throws with a message if the paste didn't fully parse
  // (partial parse still lands on whatever prefix of moves was legal).
  const loadPgn = useCallback(
    async (pgn: string) => {
      if (!gs || busy) return
      setBusy(true)
      try {
        const next = await loadPGN(gs.id, pgn)
        setGs(next)
        setSelected(null)
        moveSound.current?.play().catch(() => {})
        refreshInsights(next.id, next)
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

  // Freeform coach chat (Path 2). The backend reads the live board position
  // from the game store, so we only pass the message + prior turns. Throws a
  // friendly Error the composer can surface; keeps the caller's history intact.
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
    flipped,
    toggleFlipped,
    sendCoachChat,
  }
}

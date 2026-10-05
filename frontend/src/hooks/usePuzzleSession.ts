'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addPuzzleToRetryQueue,
  checkBackendHealth,
  flushPuzzleResultOutbox,
  getPuzzleThemes,
  nextPuzzles,
  pingBackend,
  recordPuzzleResult,
  removePuzzleFromRetryQueue,
  type GameState,
  type PuzzleJSON,
  type PuzzleResult,
  type PuzzleTheme,
} from '@/lib/api/client'
import type { BoardState, Color, PieceType, Square } from '@/lib/chess/types'
import { LocalGame } from '@/lib/chess/localGame'
import { activeLine, flatten } from '@/lib/chess/moveTree'
import type { Feedback } from '@/hooks/useTrainerSession'
import { playMoveSound } from '@/lib/sound'
import { judgeMove, splitUci } from '@/lib/puzzle/judge'
import { PuzzleFeed, type FeedSource } from '@/lib/puzzle/feed'
import { getPuzzlePool } from '@/lib/puzzle/poolManager'

const OPPONENT_MOVE_DELAY_MS = 450
const OPPONENT_REPLY_DELAY_MS = 350
const KEEP_ALIVE_MS = 5 * 60 * 1000

export type PuzzleStatus = 'idle' | 'loading' | 'opponent' | 'playing' | 'solved' | 'failed'
const isFinished = (status: PuzzleStatus): boolean => status === 'solved' || status === 'failed'

export type PuzzleMode = { kind: 'mixed' } | { kind: 'theme'; theme: string }

function toBoardState(gs: GameState, selectedSquare: Square | null): BoardState {
  const pieces: BoardState['pieces'] = {}
  for (const [sq, p] of Object.entries(gs.pieces)) pieces[sq] = { type: p.type as PieceType, color: p.color as Color }
  return {
    fen: gs.fen,
    pieces,
    turn: gs.turn,
    fullMove: gs.fullMove,
    selectedSquare,
    legalMoves: selectedSquare ? gs.legalMoves.filter((m) => m.from === selectedSquare).map((m) => m.to) : [],
    lastMove: gs.lastMove ? { from: gs.lastMove.from, to: gs.lastMove.to } : null,
    isCheck: gs.isCheck,
    isGameOver: gs.isGameOver,
    gameOverReason: gs.isCheckmate ? 'checkmate' : gs.isStalemate ? 'stalemate' : gs.isDraw ? gs.gameOverReason : null,
    moveTree: gs.moveTree,
    currentNodeId: gs.currentNodeId,
  }
}

function newOperationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function usePuzzleSession() {
  const [game] = useState(() => new LocalGame())
  const [source, setSource] = useState<FeedSource>('live')

  const [themes, setThemes] = useState<PuzzleTheme[] | null>(null)
  const [themesError, setThemesError] = useState<string | null>(null)
  const [mode, setMode] = useState<PuzzleMode | null>(null)
  const [puzzle, setPuzzle] = useState<PuzzleJSON | null>(null)
  const [status, setStatus] = useState<PuzzleStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PuzzleResult | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [session, setSession] = useState({ solved: 0, failed: 0 })
  const [hintUci, setHintUci] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [tipId, setTipId] = useState<string | null>(null)
  const [inRetryQueue, setInRetryQueue] = useState(false)

  const [feed] = useState(
    () =>
      new PuzzleFeed({
        fetchBatch: (theme, opts) => nextPuzzles(theme, opts),
        pool: getPuzzlePool(),
        flushResults: flushPuzzleResultOutbox,
        refreshThemes: async () => {
          const r = await getPuzzleThemes({ fresh: true })
          setThemes(r.themes)
        },
        checkHealth: checkBackendHealth,
        canPing: () => typeof document !== 'undefined' && document.visibilityState === 'visible' && navigator.onLine,
        onSourceChange: setSource,
      }),
  )

  const puzzleRef = useRef<PuzzleJSON | null>(null)
  const movesRef = useRef<string[]>([])
  const indexRef = useRef(0)
  const submittedRef = useRef(false)
  const missedRef = useRef(false)
  const operationRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)
  const statusRef = useRef<PuzzleStatus>('idle')
  const currentIdRef = useRef<string | null>(null)
  const tipRef = useRef<string | null>(null)
  const modeRef = useRef<PuzzleMode | null>(null)
  const inRetryQueueRef = useRef(false)
  const retryChainRef = useRef<Promise<void>>(Promise.resolve())

  const setStatusBoth = useCallback((s: PuzzleStatus) => {
    statusRef.current = s
    setStatus(s)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => clearTimer, [clearTimer])
  useEffect(() => () => feed.stop(), [feed])

  useEffect(() => {
    if (!mode) return
    const interval = setInterval(pingBackend, KEEP_ALIVE_MS)
    return () => clearInterval(interval)
  }, [mode])

  const loadThemes = useCallback(() => {
    setThemesError(null)
    getPuzzleThemes()
      .then((r) => setThemes(r.themes))
      .catch((err: unknown) => setThemesError(err instanceof Error ? err.message : 'Could not load themes.'))
  }, [])

  useEffect(() => {
    let cancelled = false
    getPuzzleThemes()
      .then((r) => {
        if (!cancelled) setThemes(r.themes)
      })
      .catch((err: unknown) => {
        if (!cancelled) setThemesError(err instanceof Error ? err.message : 'Could not load themes.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const commit = useCallback(() => {
    const snapshot = game.snapshot()
    currentIdRef.current = snapshot.currentNodeId
    setGameState(snapshot)
  }, [game])

  const markTip = useCallback(() => {
    tipRef.current = currentIdRef.current
    setTipId(currentIdRef.current)
  }, [])

  const playUci = useCallback(
    (uci: string) => {
      const { from, to, promotion } = splitUci(uci)
      game.applyMove(from, to, promotion)
      playMoveSound(game.currentSan.includes('x'))
      commit()
      markTip()
    },
    [game, commit, markTip],
  )

  const submit = useCallback((solved: boolean) => {
    const p = puzzleRef.current
    if (!p || submittedRef.current) return
    submittedRef.current = true
    setSession((s) => ({ solved: s.solved + (solved ? 1 : 0), failed: s.failed + (solved ? 0 : 1) }))
    recordPuzzleResult(
      { operationId: operationRef.current, puzzleId: p.id, theme: p.theme, solved, playedAt: new Date().toISOString() },
      { offlineCapable: feed.offlineCapable, queueOnly: feed.source === 'pool' },
    )
      .then(({ result: r, queued }) => {
        if (queued || !r) {
          feed.markBackendUnreachable()
          return
        }
        setResult(r)
        setThemes((current) =>
          current
            ? current.map((t) => (t.key === r.theme ? { ...t, rating: r.ratingAfter, attempts: r.attempts, wins: r.wins, played: true } : t))
            : current,
        )
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not save that result.'))
  }, [feed])

  const scheduleOpponent = useCallback(
    (delay: number, onDone: () => void) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        const uci = movesRef.current[indexRef.current]
        if (uci) {
          playUci(uci)
          indexRef.current += 1
        }
        onDone()
      }, delay)
    },
    [clearTimer, playUci],
  )

  const startPuzzle = useCallback(
    (p: PuzzleJSON) => {
      clearTimer()
      puzzleRef.current = p
      movesRef.current = p.moves.split(' ').filter(Boolean)
      indexRef.current = 0
      submittedRef.current = false
      missedRef.current = false
      operationRef.current = newOperationId()
      inRetryQueueRef.current = !!p.retry
      setInRetryQueue(!!p.retry)
      game.resetTo(p.fen)
      const opponentToMove = p.fen.split(' ')[1] === 'b' ? 'b' : 'w'
      setFlipped(opponentToMove === 'w')
      setPuzzle(p)
      setResult(null)
      setError(null)
      setSelected(null)
      setHintUci(null)
      setFeedback(null)
      commit()
      markTip()
      setStatusBoth('opponent')
      scheduleOpponent(OPPONENT_MOVE_DELAY_MS, () => setStatusBoth('playing'))
    },
    [clearTimer, commit, game, markTip, scheduleOpponent, setStatusBoth],
  )

  const advance = useCallback(async () => {
    const generation = generationRef.current
    setError(null)
    if (feed.queued === 0) setStatusBoth('loading')
    const outcome = await feed.next()
    if (generation !== generationRef.current || outcome.kind === 'stale') return
    if (outcome.kind === 'error') {
      setError('Could not load a puzzle. Check your connection and try again.')
      setStatusBoth('idle')
      return
    }
    if (outcome.kind === 'none') {
      setError('No more puzzles for that theme yet.')
      setStatusBoth('idle')
      return
    }
    startPuzzle(outcome.puzzle)
  }, [feed, setStatusBoth, startPuzzle])

  const start = useCallback(
    (nextMode: PuzzleMode) => {
      generationRef.current++
      puzzleRef.current = null
      modeRef.current = nextMode
      feed.start(nextMode)
      setMode(nextMode)
      setSession({ solved: 0, failed: 0 })
      setPuzzle(null)
      setGameState(null)
      void advance()
    },
    [advance, feed],
  )

  const next = useCallback(() => {
    if (!modeRef.current || !(isFinished(statusRef.current) || statusRef.current === 'idle')) return
    void advance()
  }, [advance])

  const retry = useCallback(() => {
    if (puzzleRef.current) {
      const p = puzzleRef.current
      const wasSubmitted = submittedRef.current
      const previousResult = result
      const queued = inRetryQueueRef.current
      startPuzzle(p)
      inRetryQueueRef.current = queued
      setInRetryQueue(queued)
      submittedRef.current = wasSubmitted
      if (wasSubmitted) setResult(previousResult)
    }
  }, [result, startPuzzle])

  const toggleRetryQueue = useCallback(() => {
    const p = puzzleRef.current
    if (!p || !isFinished(statusRef.current)) return
    if (feed.source === 'pool') {
      setError('Could not update the retry queue.')
      return
    }
    const adding = !inRetryQueueRef.current
    inRetryQueueRef.current = adding
    setInRetryQueue(adding)
    retryChainRef.current = retryChainRef.current
      .then(() => (adding ? addPuzzleToRetryQueue(p.id, p.theme) : removePuzzleFromRetryQueue(p.id)))
      .then(() => undefined)
      .catch(() => {
        if (puzzleRef.current?.id !== p.id) return
        inRetryQueueRef.current = !adding
        setInRetryQueue(!adding)
        setError('Could not update the retry queue.')
      })
  }, [feed])

  const backToPicker = useCallback(() => {
    generationRef.current++
    feed.stop()
    clearTimer()
    modeRef.current = null
    setMode(null)
    setPuzzle(null)
    setGameState(null)
    setResult(null)
    setStatusBoth('idle')
    loadThemes()
  }, [clearTimer, feed, loadThemes, setStatusBoth])

  const attemptMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      if (statusRef.current === 'solved' || statusRef.current === 'failed') {
        if (game.applyMove(from, to, promotion)) {
          playMoveSound(game.currentSan.includes('x'))
          setSelected(null)
          setHintUci(null)
          commit()
        }
        return
      }
      if (statusRef.current !== 'playing') return
      if (tipRef.current && currentIdRef.current !== tipRef.current) {
        game.gotoNode(tipRef.current)
        commit()
        return
      }
      const expected = movesRef.current[indexRef.current]
      if (!expected) return
      const verdict = judgeMove(game.currentFen, expected, from, to, promotion)
      setSelected(null)
      if (verdict.kind === 'illegal') return
      if (verdict.kind === 'wrong') {
        setFeedback({ kind: 'incorrect' })
        setHintUci(expected)
        missedRef.current = true
        submit(false)
        return
      }
      playUci(verdict.uci)
      setFeedback({ kind: 'correct' })
      setHintUci(null)
      indexRef.current += 1
      if (verdict.mate || indexRef.current >= movesRef.current.length) {
        if (missedRef.current) setFeedback(null)
        setStatusBoth(missedRef.current ? 'failed' : 'solved')
        submit(true)
        return
      }
      setStatusBoth('opponent')
      scheduleOpponent(OPPONENT_REPLY_DELAY_MS, () => setStatusBoth('playing'))
    },
    [game, commit, playUci, scheduleOpponent, setStatusBoth, submit],
  )

  const giveUp = useCallback(() => {
    if (statusRef.current !== 'playing') return
    setStatusBoth('failed')
    setSelected(null)
    setHintUci(movesRef.current[indexRef.current] ?? null)
    submit(false)
  }, [setStatusBoth, submit])

  const selectSquare = useCallback(
    (square: Square) => {
      if (!gameState || (statusRef.current !== 'playing' && !isFinished(statusRef.current))) return
      if (statusRef.current === 'playing' && tipRef.current && currentIdRef.current !== tipRef.current) {
        game.gotoNode(tipRef.current)
        setSelected(null)
        commit()
        return
      }
      if (selected === square) {
        setSelected(null)
        return
      }
      if (selected && gameState.legalMoves.some((m) => m.from === selected && m.to === square)) {
        attemptMove(selected, square)
        return
      }
      const piece = gameState.pieces[square]
      setSelected(piece && piece.color === gameState.turn ? square : null)
    },
    [gameState, selected, attemptMove, game, commit],
  )

  const move = useCallback(
    (from: string, to: string, promotion?: string) => attemptMove(from, to, promotion),
    [attemptMove],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] =>
      (statusRef.current !== 'playing' && !isFinished(statusRef.current)) || !gameState || (statusRef.current === 'playing' && gameState.currentNodeId !== tipId) ? [] : gameState.legalMoves.filter((m) => m.from === square).map((m) => m.to),
    [gameState, tipId],
  )

  const navigable = useCallback((): boolean => statusRef.current === 'playing' || isFinished(statusRef.current), [])

  const gotoNode = useCallback(
    (id: string) => {
      if (!navigable() || !game.gotoNode(id)) return
      playMoveSound(game.currentSan.includes('x'))
      setSelected(null)
      setHintUci(null)
      commit()
    },
    [commit, game, navigable],
  )

  const navigate = useCallback(
    (direction: 'prev' | 'next') => {
      if (!navigable() || !gameState) return
      const entry = flatten(gameState.moveTree).get(gameState.currentNodeId)
      if (!entry) return
      const target = direction === 'prev' ? entry.parentId : entry.node.children?.[0]?.id
      if (target) gotoNode(target)
    },
    [gameState, gotoNode, navigable],
  )
  const navPrev = useCallback(() => navigate('prev'), [navigate])
  const navNext = useCallback(() => navigate('next'), [navigate])

  const moveNodes = gameState ? activeLine(gameState.moveTree, gameState.currentNodeId) : []
  const currentNodeId = gameState?.currentNodeId ?? null
  const rootId = gameState?.moveTree.id ?? null
  const canPrev = !!gameState && (status === 'playing' || status === 'solved' || status === 'failed') && currentNodeId !== rootId
  const canNext =
    !!gameState &&
    (status === 'playing' || status === 'solved' || status === 'failed') &&
    !!currentNodeId &&
    (flatten(gameState.moveTree).get(currentNodeId)?.node.children?.length ?? 0) > 0

  const boardState = gameState ? toBoardState(gameState, selected) : null
  const themeRating =
    (puzzle && themes?.find((t) => t.key === puzzle.theme)?.rating) ?? puzzle?.themeRating ?? null
  const userColor: Color | null = puzzle ? (puzzle.fen.split(' ')[1] === 'w' ? 'b' : 'w') : null

  return {
    themes, themesError, mode, source, puzzle, status, error, result, boardState, flipped, session, hintUci, userColor, themeRating,
    inRetryQueue, toggleRetryQueue, start, next, retry, giveUp, navPrev, navNext, gotoNode, moveNodes, currentNodeId, canPrev, canNext, feedback, backToPicker, selectSquare, move, legalMovesFor, loadThemes,
  }
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getWoodpeckerPuzzle,
  getWoodpeckerState,
  recordWoodpeckerAttempt,
  type GameState,
  type WoodpeckerAttempt,
  type WoodpeckerOutcome,
  type WoodpeckerPuzzle,
  type WoodpeckerState,
} from '@/lib/api/client'
import type { Color, Square } from '@/lib/chess/types'
import { LocalGame } from '@/lib/chess/localGame'
import { activeLine, flatten } from '@/lib/chess/moveTree'
import type { Feedback } from '@/hooks/useTrainerSession'
import { playMoveSound } from '@/lib/sound'
import { judgeMove, splitUci } from '@/lib/puzzle/judge'
import { toBoardState, type PuzzleStatus } from '@/hooks/usePuzzleSession'

const OPPONENT_REPLY_DELAY_MS = 350

const isFinished = (status: PuzzleStatus): boolean => status === 'solved' || status === 'failed'

function newOperationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useWoodpeckerSession() {
  const [game] = useState(() => new LocalGame())
  const [progress, setProgress] = useState<WoodpeckerState | null>(null)
  const [puzzle, setPuzzle] = useState<WoodpeckerPuzzle | null>(null)
  const [status, setStatus] = useState<PuzzleStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [hintUci, setHintUci] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [tipId, setTipId] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)

  const puzzleRef = useRef<WoodpeckerPuzzle | null>(null)
  const cycleRef = useRef(1)
  const movesRef = useRef<string[]>([])
  const indexRef = useRef(0)
  const submittedRef = useRef(false)
  const missedRef = useRef(false)
  const branchedRef = useRef(false)
  const operationRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = useRef<PuzzleStatus>('loading')
  const currentIdRef = useRef<string | null>(null)
  const tipRef = useRef<string | null>(null)
  const pendingRef = useRef<WoodpeckerAttempt | null>(null)
  const elapsedRef = useRef(0)
  const runningSinceRef = useRef<number | null>(null)
  const pausedRef = useRef(false)
  const clockStartedRef = useRef(false)
  const generationRef = useRef(0)

  const setStatusBoth = useCallback((s: PuzzleStatus) => {
    statusRef.current = s
    setStatus(s)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])
  useEffect(() => clearTimer, [clearTimer])

  const stopClock = useCallback(() => {
    if (runningSinceRef.current !== null) {
      elapsedRef.current += Date.now() - runningSinceRef.current
      runningSinceRef.current = null
    }
  }, [])

  const resumeClock = useCallback(() => {
    if (!clockStartedRef.current || pausedRef.current || submittedRef.current) return
    if (typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !document.hasFocus())) return
    if (runningSinceRef.current === null) runningSinceRef.current = Date.now()
  }, [])

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) resumeClock()
      else stopClock()
    }
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
    }
  }, [resumeClock, stopClock])

  const togglePause = useCallback(() => {
    if (!clockStartedRef.current || submittedRef.current) return
    const nextPaused = !pausedRef.current
    pausedRef.current = nextPaused
    setPaused(nextPaused)
    if (nextPaused) stopClock()
    else resumeClock()
  }, [resumeClock, stopClock])

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

  const flushPending = useCallback(async (): Promise<boolean> => {
    const attempt = pendingRef.current
    if (!attempt) return true
    try {
      await recordWoodpeckerAttempt(attempt)
      if (pendingRef.current === attempt) pendingRef.current = null
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that result.')
      return false
    }
  }, [])

  const finish = useCallback(
    (outcome: WoodpeckerOutcome) => {
      const p = puzzleRef.current
      if (!p || submittedRef.current) return
      stopClock()
      submittedRef.current = true
      pendingRef.current = {
        operationId: operationRef.current,
        cycle: cycleRef.current,
        puzzleNumber: p.number,
        solved: outcome === 'solved',
        outcome,
        durationMs: Math.round(elapsedRef.current),
      }
      void flushPending()
    },
    [flushPending, stopClock],
  )

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
    (p: WoodpeckerPuzzle, record: boolean) => {
      clearTimer()
      puzzleRef.current = p
      movesRef.current = p.moves.split(' ').filter(Boolean)
      indexRef.current = 0
      submittedRef.current = !record
      missedRef.current = false
      branchedRef.current = false
      operationRef.current = newOperationId()
      elapsedRef.current = 0
      runningSinceRef.current = null
      clockStartedRef.current = false
      pausedRef.current = false
      setPaused(false)
      game.resetTo(p.fen)
      setFlipped(p.fen.split(' ')[1] === 'b')
      setPuzzle(p)
      setError(null)
      setSelected(null)
      setHintUci(null)
      setFeedback(null)
      commit()
      markTip()
      setStatusBoth('playing')
      if (record) {
        clockStartedRef.current = true
        resumeClock()
      }
    },
    [clearTimer, commit, game, markTip, resumeClock, setStatusBoth],
  )

  const advance = useCallback(async () => {
    const generation = ++generationRef.current
    setError(null)
    if (!(await flushPending())) {
      setStatusBoth(puzzleRef.current ? 'solved' : 'idle')
      return
    }
    setStatusBoth('loading')
    try {
      const state = await getWoodpeckerState()
      const p = await getWoodpeckerPuzzle(state.next)
      if (generation !== generationRef.current) return
      cycleRef.current = state.cycle
      setProgress(state)
      startPuzzle(p, true)
    } catch (err) {
      if (generation !== generationRef.current) return
      setError(err instanceof Error ? err.message : 'Could not load the next puzzle.')
      setStatusBoth('idle')
    }
  }, [flushPending, setStatusBoth, startPuzzle])

  useEffect(() => {
    queueMicrotask(() => void advance())
  }, [advance])

  const next = useCallback(() => {
    if (!(isFinished(statusRef.current) || statusRef.current === 'idle')) return
    void advance()
  }, [advance])

  const retry = useCallback(() => {
    if (puzzleRef.current) startPuzzle(puzzleRef.current, false)
  }, [startPuzzle])

  const attemptMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      if (isFinished(statusRef.current)) {
        if (game.applyMove(from, to, promotion)) {
          playMoveSound(game.currentSan.includes('x'))
          setSelected(null)
          setHintUci(null)
          commit()
        }
        return
      }
      if (statusRef.current !== 'playing' || pausedRef.current) return
      if (tipRef.current && currentIdRef.current !== tipRef.current) {
        game.gotoNode(tipRef.current)
        commit()
        return
      }
      const expected = movesRef.current[indexRef.current]
      if (!expected) return
      let verdict = judgeMove(game.currentFen, expected, from, to, promotion)
      setSelected(null)
      if (verdict.kind === 'illegal') return
      if (verdict.kind === 'wrong' && !branchedRef.current) {
        const played = verdict.uci
        const alt = puzzleRef.current?.alternatives?.find(
          (a) => a.at === indexRef.current && a.moves.split(' ')[0] === played,
        )
        if (alt) {
          movesRef.current = [...movesRef.current.slice(0, alt.at), ...alt.moves.split(' ').filter(Boolean)]
          branchedRef.current = true
          verdict = { kind: 'correct', uci: played, mate: false }
        }
      }
      if (verdict.kind === 'wrong') {
        setFeedback({ kind: 'incorrect' })
        setHintUci(expected)
        missedRef.current = true
        return
      }
      playUci(verdict.uci)
      setFeedback({ kind: 'correct' })
      setHintUci(null)
      indexRef.current += 1
      const complete = () => {
        if (missedRef.current) {
          setFeedback(null)
          setStatusBoth('failed')
          finish('mistake')
        } else {
          setStatusBoth('solved')
          finish('solved')
        }
      }
      if (verdict.mate || indexRef.current >= movesRef.current.length) {
        complete()
        return
      }
      if (indexRef.current === movesRef.current.length - 1) {
        stopClock()
        setStatusBoth('opponent')
        scheduleOpponent(OPPONENT_REPLY_DELAY_MS, complete)
        return
      }
      setStatusBoth('opponent')
      scheduleOpponent(OPPONENT_REPLY_DELAY_MS, () => setStatusBoth('playing'))
    },
    [game, commit, finish, stopClock, playUci, scheduleOpponent, setStatusBoth],
  )

  const giveUp = useCallback(() => {
    if (statusRef.current !== 'playing') return
    setStatusBoth('failed')
    setSelected(null)
    setHintUci(movesRef.current[indexRef.current] ?? null)
    finish(missedRef.current ? 'mistake' : 'gave_up')
  }, [finish, setStatusBoth])

  const selectSquare = useCallback(
    (square: Square) => {
      if (!gameState || (statusRef.current !== 'playing' && !isFinished(statusRef.current)) || pausedRef.current) return
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
      (statusRef.current !== 'playing' && !isFinished(statusRef.current)) ||
      !gameState ||
      (statusRef.current === 'playing' && (paused || gameState.currentNodeId !== tipId))
        ? []
        : gameState.legalMoves.filter((m) => m.from === square).map((m) => m.to),
    [gameState, tipId, paused],
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
  const live = status === 'playing' || isFinished(status)
  const canPrev = !!gameState && live && currentNodeId !== rootId
  const canNext =
    !!gameState && live && !!currentNodeId && (flatten(gameState.moveTree).get(currentNodeId)?.node.children?.length ?? 0) > 0

  const boardState = gameState ? toBoardState(gameState, selected) : null
  const userColor: Color | null = puzzle ? (puzzle.fen.split(' ')[1] === 'w' ? 'w' : 'b') : null

  return {
    progress, puzzle, status, error, boardState, flipped, hintUci, userColor, feedback, paused,
    togglePause, next, retry, giveUp, navPrev, navNext, gotoNode, moveNodes, currentNodeId, canPrev, canNext, selectSquare, move, legalMovesFor,
  }
}

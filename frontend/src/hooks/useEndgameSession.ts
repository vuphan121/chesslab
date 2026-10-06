'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameState } from '@/lib/api/client'
import { LocalGame } from '@/lib/chess/localGame'
import { activeLine, flatten } from '@/lib/chess/moveTree'
import type { Square } from '@/lib/chess/types'
import { playMoveSound } from '@/lib/sound'
import { toBoardState } from '@/hooks/usePuzzleSession'
import { ENDGAME_POSITIONS, pickNextPosition, pickStartFen, userColorOf, type EndgamePosition } from '@/lib/endgame/positions'
import { chooseReply, keepsGoal, keptMoves, moveLimit, uciFor, userOutcomeAfterMove } from '@/lib/endgame/judge'
import { fetchTablebase } from '@/lib/endgame/tablebase'
import { CUSTOM_KEY, parseCustomPositions, serializeCustomPositions } from '@/lib/endgame/custom'

const REPLY_DELAY_MS = 350
const DONE_KEY = 'chesslab:endgames:done'
const RECENT_MEMORY = 3
const HINT_ARROWS = 3
const OFFLINE_TEXT = "Couldn't reach the tablebase. Check your connection."

export type EndgameStatus = 'idle' | 'loading' | 'playing' | 'judging' | 'opponent' | 'success' | 'failed'
export type FeedbackTone = 'good' | 'bad' | 'info'
export interface EndgameFeedback {
  tone: FeedbackTone
  text: string
}

const isFinished = (status: EndgameStatus): boolean => status === 'success' || status === 'failed'

function readDone(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DONE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function readCustom(): EndgamePosition[] {
  try {
    return parseCustomPositions(window.localStorage.getItem(CUSTOM_KEY))
  } catch {
    return []
  }
}

function writeCustom(positions: EndgamePosition[]): void {
  try {
    window.localStorage.setItem(CUSTOM_KEY, serializeCustomPositions(positions))
  } catch {}
}

function writeDone(done: Set<string>): void {
  try {
    window.localStorage.setItem(DONE_KEY, JSON.stringify([...done]))
  } catch {}
}

export function useEndgameSession() {
  const [game] = useState(() => new LocalGame())
  const [position, setPosition] = useState<EndgamePosition | null>(null)
  const [status, setStatus] = useState<EndgameStatus>('idle')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [userColor, setUserColor] = useState<'w' | 'b'>('w')
  const [tipId, setTipId] = useState<string | null>(null)
  const [movesLeft, setMovesLeft] = useState<number | null>(null)
  const [movesUsed, setMovesUsed] = useState(0)
  const [mistakes, setMistakes] = useState(0)
  const [feedback, setFeedback] = useState<EndgameFeedback | null>(null)
  const [hintMoves, setHintMoves] = useState<string[]>([])
  const [customs, setCustoms] = useState<EndgamePosition[]>(() => (typeof window === 'undefined' ? [] : readCustom()))
  const [done, setDone] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : readDone()))

  const positionRef = useRef<EndgamePosition | null>(null)
  const startFenRef = useRef('')
  const statusRef = useRef<EndgameStatus>('idle')
  const generationRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentIdRef = useRef<string | null>(null)
  const tipRef = useRef<string | null>(null)
  const movesLeftRef = useRef(0)
  const mistakesRef = useRef(0)
  const movesUsedRef = useRef(0)
  const recentRef = useRef<string[]>([])

  const setStatusBoth = useCallback((next: EndgameStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const commit = useCallback(() => {
    const snapshot = game.snapshot()
    currentIdRef.current = snapshot.currentNodeId
    setGameState(snapshot)
    return snapshot
  }, [game])

  const markTip = useCallback(() => {
    tipRef.current = currentIdRef.current
    setTipId(currentIdRef.current)
  }, [])

  const finish = useCallback(
    (result: 'success' | 'failed', text: string) => {
      clearTimer()
      setHintMoves([])
      setFeedback({ tone: result === 'success' ? 'good' : 'bad', text })
      setStatusBoth(result)
      const p = positionRef.current
      if (result === 'success' && p) {
        setDone((current) => {
          const next = new Set(current).add(p.id)
          writeDone(next)
          return next
        })
      }
    },
    [clearTimer, setStatusBoth],
  )

  const settleIfOver = useCallback(
    (snapshot: GameState, userColor: 'w' | 'b'): boolean => {
      const p = positionRef.current
      if (!p || !snapshot.isGameOver) return false
      if (snapshot.isCheckmate) {
        if (snapshot.turn !== userColor) finish('success', 'Checkmate. Converted.')
        else finish('failed', 'Checkmated.')
      } else if (p.goal === 'draw') {
        finish('success', 'Drawn. Held the draw.')
      } else {
        finish('failed', 'Drawn. The win slipped away.')
      }
      return true
    },
    [finish],
  )

  const prefetch = useCallback((fen: string) => {
    void fetchTablebase(fen).catch(() => {})
  }, [])

  const startPosition = useCallback(
    async (p: EndgamePosition, fen?: string) => {
      const generation = ++generationRef.current
      const startFen = fen ?? pickStartFen(p)
      startFenRef.current = startFen
      clearTimer()
      positionRef.current = p
      recentRef.current = [p.id, ...recentRef.current.filter((id) => id !== p.id)].slice(0, RECENT_MEMORY)
      mistakesRef.current = 0
      movesUsedRef.current = 0
      setPosition(p)
      setMistakes(0)
      setMovesUsed(0)
      setMovesLeft(null)
      setFeedback(null)
      setHintMoves([])
      setSelected(null)
      game.resetTo(startFen)
      setUserColor(userColorOf(startFen))
      setFlipped(userColorOf(startFen) === 'b')
      commit()
      markTip()
      setStatusBoth('loading')
      try {
        const tb = await fetchTablebase(startFen)
        if (generation !== generationRef.current) return
        const limit = moveLimit(p.goal, tb.dtz)
        movesLeftRef.current = limit
        setMovesLeft(limit)
        setFeedback(null)
        setStatusBoth('playing')
      } catch {
        if (generation !== generationRef.current) return
        setFeedback({ tone: 'bad', text: OFFLINE_TEXT })
        setStatusBoth('idle')
      }
    },
    [clearTimer, commit, game, markTip, setStatusBoth],
  )

  const playReply = useCallback(
    async (generation: number, userColor: 'w' | 'b') => {
      setStatusBoth('opponent')
      let reply
      try {
        reply = chooseReply(await fetchTablebase(game.currentFen))
      } catch {
        if (generation !== generationRef.current) return
        setFeedback({ tone: 'bad', text: OFFLINE_TEXT })
        setStatusBoth('idle')
        return
      }
      if (generation !== generationRef.current || !reply) return
      clearTimer()
      timerRef.current = setTimeout(() => {
        if (generation !== generationRef.current) return
        game.applyMove(reply.uci.slice(0, 2), reply.uci.slice(2, 4), reply.uci.length > 4 ? reply.uci[4] : undefined)
        playMoveSound(game.currentSan.includes('x'))
        const snapshot = commit()
        markTip()
        if (settleIfOver(snapshot, userColor)) return
        setStatusBoth('playing')
        prefetch(game.currentFen)
      }, REPLY_DELAY_MS)
    },
    [clearTimer, commit, game, markTip, prefetch, setStatusBoth, settleIfOver],
  )

  const attemptMove = useCallback(
    async (from: string, to: string, promotion?: string) => {
      const p = positionRef.current
      if (!p) return
      if (isFinished(statusRef.current)) {
        if (game.applyMove(from, to, promotion)) {
          playMoveSound(game.currentSan.includes('x'))
          setSelected(null)
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
      const generation = generationRef.current
      const userColor = userColorOf(startFenRef.current)
      const fen = game.currentFen
      const uci = uciFor(fen, from, to, promotion)
      if (!uci) return
      setSelected(null)
      setStatusBoth('judging')
      let tb
      try {
        tb = await fetchTablebase(fen)
      } catch {
        if (generation !== generationRef.current) return
        setFeedback({ tone: 'bad', text: OFFLINE_TEXT })
        setStatusBoth('playing')
        return
      }
      if (generation !== generationRef.current) return
      const entry = tb.moves.find((m) => m.uci === uci)
      const outcome = entry ? userOutcomeAfterMove(entry) : null
      if (!keepsGoal(p.goal, outcome)) {
        mistakesRef.current += 1
        setMistakes(mistakesRef.current)
        setFeedback({
          tone: 'bad',
          text: p.goal === 'win' ? 'That throws away the win. Try again.' : 'That loses the draw. Try again.',
        })
        setHintMoves(keptMoves(p.goal, tb).slice(0, HINT_ARROWS).map((m) => m.uci))
        setStatusBoth('playing')
        return
      }
      game.applyMove(from, to, promotion)
      playMoveSound(game.currentSan.includes('x'))
      const snapshot = commit()
      markTip()
      setHintMoves([])
      movesLeftRef.current -= 1
      movesUsedRef.current += 1
      setMovesLeft(Math.max(0, movesLeftRef.current))
      setMovesUsed(movesUsedRef.current)
      setFeedback({ tone: 'good', text: p.goal === 'win' ? 'Winning move. Keep going.' : 'Holds the draw. Keep going.' })
      if (p.endsOnPromotion && uci.length > 4) {
        finish('success', 'Promoted. Converted.')
        return
      }
      if (settleIfOver(snapshot, userColor)) return
      if (movesLeftRef.current <= 0) {
        if (p.goal === 'draw') finish('success', 'Held the draw.')
        else finish('failed', 'Out of moves.')
        return
      }
      void playReply(generation, userColor)
    },
    [commit, finish, game, markTip, playReply, setStatusBoth, settleIfOver],
  )

  const move = useCallback(
    (from: string, to: string, promotion?: string) => attemptMove(from, to, promotion),
    [attemptMove],
  )

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
        void attemptMove(selected, square)
        return
      }
      const piece = gameState.pieces[square]
      setSelected(piece && piece.color === gameState.turn ? square : null)
    },
    [gameState, selected, attemptMove, game, commit],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] =>
      (statusRef.current !== 'playing' && !isFinished(statusRef.current)) ||
      !gameState ||
      (statusRef.current === 'playing' && gameState.currentNodeId !== tipId)
        ? []
        : gameState.legalMoves.filter((m) => m.from === square).map((m) => m.to),
    [gameState, tipId],
  )

  const showHint = useCallback(async () => {
    const p = positionRef.current
    if (!p || statusRef.current !== 'playing') return
    try {
      const tb = await fetchTablebase(game.currentFen)
      setHintMoves(keptMoves(p.goal, tb).slice(0, HINT_ARROWS).map((m) => m.uci))
    } catch {
      setFeedback({ tone: 'bad', text: OFFLINE_TEXT })
    }
  }, [game])

  const restart = useCallback(() => {
    const p = positionRef.current
    if (p) void startPosition(p, startFenRef.current)
  }, [startPosition])

  const positions = useMemo(() => [...ENDGAME_POSITIONS, ...customs], [customs])

  const next = useCallback(() => {
    void startPosition(pickNextPosition(positions, recentRef.current))
  }, [positions, startPosition])

  const saveCustom = useCallback((position: EndgamePosition) => {
    setCustoms((current) => {
      const exists = current.some((p) => p.id === position.id)
      const updated = exists ? current.map((p) => (p.id === position.id ? position : p)) : [...current, position]
      writeCustom(updated)
      return updated
    })
  }, [])

  const removeCustom = useCallback((id: string) => {
    setCustoms((current) => {
      const updated = current.filter((p) => p.id !== id)
      writeCustom(updated)
      return updated
    })
    setDone((current) => {
      if (!current.has(id)) return current
      const updated = new Set(current)
      updated.delete(id)
      writeDone(updated)
      return updated
    })
  }, [])

  const backToPicker = useCallback(() => {
    generationRef.current++
    clearTimer()
    positionRef.current = null
    setPosition(null)
    setGameState(null)
    setFeedback(null)
    setHintMoves([])
    setStatusBoth('idle')
  }, [clearTimer, setStatusBoth])

  const navigable = useCallback((): boolean => statusRef.current === 'playing' || isFinished(statusRef.current), [])

  const gotoNode = useCallback(
    (id: string) => {
      if (!navigable() || !game.gotoNode(id)) return
      playMoveSound(game.currentSan.includes('x'))
      setSelected(null)
      setHintMoves([])
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
  const browsing = status === 'playing' || isFinished(status)
  const canPrev = !!gameState && browsing && currentNodeId !== rootId
  const canNext =
    !!gameState && browsing && !!currentNodeId && (flatten(gameState.moveTree).get(currentNodeId)?.node.children?.length ?? 0) > 0

  const boardState = gameState ? toBoardState(gameState, selected) : null

  return {
    positions, customs, saveCustom, removeCustom, position, status, boardState, flipped, userColor, movesLeft, movesUsed, mistakes, feedback, hintMoves, done,
    moveNodes, currentNodeId, canPrev, canNext,
    start: startPosition, next, restart, showHint, backToPicker,
    navPrev, navNext, gotoNode, selectSquare, move, legalMovesFor,
  }
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameState } from '@/lib/api/client'
import { LocalGame } from '@/lib/chess/localGame'
import type { Square } from '@/lib/chess/types'
import { playMoveSound } from '@/lib/sound'
import { toBoardState } from '@/hooks/usePuzzleSession'
import { BrowserEngine } from '@/lib/engine/browserEngine'
import { chooseReply, endsGame, keepsGoal, keptMoves, moveLimit, outcomeOf, uciFor, userOutcomeAfterMove } from '@/lib/endgame/judge'
import { chooseEngineReply, pieceCount } from '@/lib/endgame/engineReply'
import { fetchTablebase, tablebaseMessage } from '@/lib/endgame/tablebase'
import type { EndgameGoal } from '@/lib/endgame/positions'

const REPLY_DELAY_MS = 350
const TABLEBASE_MAX_PIECES = 7
const HINT_ARROWS = 3
const ENGINE_REPLY_SECONDS = 1

export type DrillStatus = 'loading' | 'playing' | 'judging' | 'opponent' | 'success' | 'failed'
export type DrillMode = EndgameGoal | 'free'
export interface DrillFeedback {
  tone: 'good' | 'bad' | 'info'
  text: string
}

const isFinished = (s: DrillStatus): boolean => s === 'success' || s === 'failed'

let sharedEngine: BrowserEngine | null = null
function engine(): BrowserEngine {
  if (!sharedEngine) sharedEngine = new BrowserEngine()
  return sharedEngine
}

export function useBookDrill(fen: string | null, resetKey: string) {
  const [game] = useState(() => new LocalGame())
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [status, setStatus] = useState<DrillStatus>('loading')
  const [mode, setMode] = useState<DrillMode>('free')
  const [selected, setSelected] = useState<Square | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [feedback, setFeedback] = useState<DrillFeedback | null>(null)
  const [hintMoves, setHintMoves] = useState<string[]>([])
  const [mistakes, setMistakes] = useState(0)
  const [movesLeft, setMovesLeft] = useState<number | null>(null)
  const [runId, setRunId] = useState(0)

  const statusRef = useRef<DrillStatus>('loading')
  const modeRef = useRef<DrillMode>('free')
  const generationRef = useRef(0)
  const userColorRef = useRef<'w' | 'b'>('w')
  const movesLeftRef = useRef(0)
  const startedPawnsRef = useRef(false)

  const setStatusBoth = useCallback((next: DrillStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const commit = useCallback(() => {
    const snapshot = game.snapshot()
    setGameState(snapshot)
    return snapshot
  }, [game])

  const finish = useCallback(
    (result: 'success' | 'failed', text: string) => {
      setHintMoves([])
      setFeedback({ tone: result === 'success' ? 'good' : 'bad', text })
      setStatusBoth(result)
    },
    [setStatusBoth],
  )

  const settleIfOver = useCallback(
    (snapshot: GameState): boolean => {
      if (!snapshot.isGameOver) return false
      if (modeRef.current === 'free') {
        setFeedback({ tone: 'info', text: snapshot.isCheckmate ? 'Checkmate.' : 'Game drawn.' })
        setStatusBoth('success')
        return true
      }
      if (snapshot.isCheckmate) {
        if (snapshot.turn !== userColorRef.current) finish('success', 'Checkmate. Converted.')
        else finish('failed', 'Checkmated.')
      } else if (modeRef.current === 'draw') finish('success', 'Drawn. Held the draw.')
      else finish('failed', 'Drawn. The win slipped away.')
      return true
    },
    [finish, setStatusBoth],
  )

  useEffect(() => {
    if (!fen) return
    const generation = ++generationRef.current
    game.resetTo(fen)
    const color = (fen.split(' ')[1] === 'b' ? 'b' : 'w') as 'w' | 'b'
    userColorRef.current = color
    startedPawnsRef.current = fen.split(' ')[0].toLowerCase().includes('p')
    setFlipped(color === 'b')
    setSelected(null)
    setHintMoves([])
    setMistakes(0)
    setMovesLeft(null)
    setFeedback(null)
    modeRef.current = 'free'
    setMode('free')
    commit()
    setStatusBoth('loading')
    if (pieceCount(fen) > TABLEBASE_MAX_PIECES) {
      setFeedback({ tone: 'info', text: 'Too many pieces for the tablebase: Stockfish defends. Play it out.' })
      setStatusBoth('playing')
      return
    }
    fetchTablebase(fen)
      .then((tb) => {
        if (generation !== generationRef.current) return
        const outcome = outcomeOf(tb.category)
        if (outcome === 'win' || outcome === 'draw') {
          modeRef.current = outcome
          setMode(outcome)
          const limit = moveLimit(outcome, tb.dtz)
          movesLeftRef.current = limit
          setMovesLeft(limit)
          setFeedback({ tone: 'info', text: outcome === 'win' ? 'Win this position.' : 'Hold the draw.' })
        } else {
          setFeedback({ tone: 'info', text: 'The tablebase says the side to move is lost here. Put up the best resistance.' })
        }
        setStatusBoth('playing')
      })
      .catch((err) => {
        if (generation !== generationRef.current) return
        setFeedback({ tone: 'bad', text: tablebaseMessage(err) })
        setStatusBoth('playing')
      })
    return () => {
      generationRef.current++
    }
  }, [fen, resetKey, runId, game, commit, setStatusBoth])

  const playReply = useCallback(
    async (generation: number) => {
      setStatusBoth('opponent')
      const fenNow = game.currentFen
      const opponent = userColorRef.current === 'w' ? 'b' : 'w'
      let uci: string | null = null
      try {
        if (pieceCount(fenNow) <= TABLEBASE_MAX_PIECES) {
          const [tb] = await Promise.all([fetchTablebase(fenNow), new Promise((r) => setTimeout(r, REPLY_DELAY_MS))])
          uci = chooseReply(tb, Math.random, (u) => endsGame(fenNow, u))?.uci ?? null
        } else {
          const result = await engine().start({
            fen: fenNow, lines: 3, hashMb: 32, limit: 'time', depth: 20, timeSec: ENGINE_REPLY_SECONDS, onUpdate: () => {},
          }).done
          uci = chooseEngineReply((result.analysis?.lines ?? []).map((l) => ({ uci: l.uciMoves?.[0], score: l.score, mate: l.mate })), opponent)
        }
      } catch (err) {
        if (generation !== generationRef.current) return
        setFeedback({ tone: 'bad', text: tablebaseMessage(err) })
        setStatusBoth('playing')
        return
      }
      if (generation !== generationRef.current) return
      if (!uci) {
        setStatusBoth('playing')
        return
      }
      game.applyMove(uci.slice(0, 2), uci.slice(2, 4), uci.length > 4 ? uci[4] : undefined)
      playMoveSound(game.currentSan.includes('x'))
      const snapshot = commit()
      if (settleIfOver(snapshot)) return
      setStatusBoth('playing')
      if (pieceCount(game.currentFen) <= TABLEBASE_MAX_PIECES) void fetchTablebase(game.currentFen).catch(() => {})
    },
    [commit, game, setStatusBoth, settleIfOver],
  )

  const attemptMove = useCallback(
    async (from: string, to: string, promotion?: string) => {
      if (isFinished(statusRef.current)) {
        if (game.applyMove(from, to, promotion)) {
          playMoveSound(game.currentSan.includes('x'))
          setSelected(null)
          commit()
        }
        return
      }
      if (statusRef.current !== 'playing') return
      const generation = generationRef.current
      const fenNow = game.currentFen
      const uci = uciFor(fenNow, from, to, promotion)
      if (!uci) return
      setSelected(null)
      const goal = modeRef.current
      if (goal !== 'free') {
        setStatusBoth('judging')
        let tb
        try {
          tb = await fetchTablebase(fenNow)
        } catch (err) {
          if (generation !== generationRef.current) return
          setFeedback({ tone: 'bad', text: tablebaseMessage(err) })
          setStatusBoth('playing')
          return
        }
        if (generation !== generationRef.current) return
        const entry = tb.moves.find((m) => m.uci === uci)
        if (!keepsGoal(goal, entry ? userOutcomeAfterMove(entry) : null)) {
          setMistakes((n) => n + 1)
          setFeedback({ tone: 'bad', text: goal === 'win' ? 'That throws away the win. Try again.' : 'That loses the draw. Try again.' })
          setHintMoves(keptMoves(goal, tb).slice(0, HINT_ARROWS).map((m) => m.uci))
          setStatusBoth('playing')
          return
        }
      }
      game.applyMove(from, to, promotion)
      playMoveSound(game.currentSan.includes('x'))
      const snapshot = commit()
      setHintMoves([])
      if (goal !== 'free') {
        movesLeftRef.current -= 1
        setMovesLeft(Math.max(0, movesLeftRef.current))
        setFeedback({ tone: 'good', text: goal === 'win' ? 'Winning move. Keep going.' : 'Holds the draw. Keep going.' })
        if (goal === 'win' && startedPawnsRef.current && uci.length > 4) {
          finish('success', 'Promoted. Converted.')
          return
        }
        if (settleIfOver(snapshot)) return
        if (movesLeftRef.current <= 0) {
          if (goal === 'draw') finish('success', 'Held the draw.')
          else finish('failed', 'Out of moves.')
          return
        }
      } else if (settleIfOver(snapshot)) return
      void playReply(generation)
    },
    [commit, finish, game, playReply, setStatusBoth, settleIfOver],
  )

  const selectSquare = useCallback(
    (square: Square) => {
      if (!gameState || (statusRef.current !== 'playing' && !isFinished(statusRef.current))) return
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
    [gameState, selected, attemptMove],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] =>
      !gameState || (statusRef.current !== 'playing' && !isFinished(statusRef.current))
        ? []
        : gameState.legalMoves.filter((m) => m.from === square).map((m) => m.to),
    [gameState],
  )

  const showHint = useCallback(async () => {
    if (modeRef.current === 'free' || statusRef.current !== 'playing') return
    try {
      const tb = await fetchTablebase(game.currentFen)
      setHintMoves(keptMoves(modeRef.current as EndgameGoal, tb).slice(0, HINT_ARROWS).map((m) => m.uci))
    } catch (err) {
      setFeedback({ tone: 'bad', text: tablebaseMessage(err) })
    }
  }, [game])

  const restart = useCallback(() => setRunId((n) => n + 1), [])

  return {
    boardState: gameState ? toBoardState(gameState, selected) : null,
    flipped, status, mode, feedback, hintMoves, mistakes, movesLeft,
    selectSquare, move: attemptMove, legalMovesFor, showHint, restart,
  }
}

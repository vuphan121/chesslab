'use client'

import { useCallback, useRef, useState } from 'react'
import {
  createGame,
  setPosition as apiSetPosition,
  makeMove,
  getRepertoire,
} from '@/lib/api/client'
import type { GameState } from '@/lib/api/client'
import type { BoardState, Color, PieceType, Square } from '@/lib/chess/types'
import { flatten } from '@/lib/chess/moveTree'
import type { Repertoire, RepCard, SessionOptions, SessionState } from '@/lib/trainer/types'
import { createSession, pickNext, grade, isComplete, summarise } from '@/lib/trainer/scheduler'
import { newRng, weightedChoice } from '@/lib/trainer/rng'
import { cardKey } from '@/lib/trainer/cardKey'
import { loadPersisted, savePersisted, mergeSessionIntoPersisted } from '@/lib/trainer/persistence'

const WEAKNESS_W = 0.75

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function promotionFromUci(uci: string): string | undefined {
  return uci.length >= 5 ? uci[4] : undefined
}

function toBoardState(gs: GameState, selectedSquare: Square | null): BoardState {
  const pieces: BoardState['pieces'] = {}
  for (const [sq, p] of Object.entries(gs.pieces)) {
    pieces[sq] = { type: p.type as PieceType, color: p.color as Color }
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

export type TrainerPhase = 'setup' | 'drilling' | 'line-complete' | 'summary'

export interface Feedback {
  kind: 'correct' | 'correct-alt' | 'incorrect' | 'excluded' | 'line-end'
  playedSan?: string
  expectedSan?: string
  comment?: string
  reason?: string
}

interface RunMove {
  san: string
  uci: string
  mover: 'user' | 'opponent'
}

export function useTrainerSession() {
  const [phase, setPhase] = useState<TrainerPhase>('setup')
  const [repertoire, setRepertoireState] = useState<Repertoire | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // The full position history of the current run, one GameState per ply
  // (index 0 = the position before any move this run; index i+1 = the
  // position after runMoves[i]). This is the trainer's own record — the
  // backend's own tree does NOT reliably span a whole run, since a wrong
  // answer's undo (POST /position) discards it back to a bare root — so
  // "line so far" / back-navigation must be reconstructed from here, not
  // from gameState.moveTree.
  const [runSnapshots, setRunSnapshots] = useState<GameState[]>([])
  const runSnapshotsRef = useRef<GameState[]>([])
  // null = viewing the live (current, interactive) position; otherwise an
  // index into runSnapshots being reviewed read-only.
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)

  const [currentCard, setCurrentCard] = useState<RepCard | null>(null)
  const [runStartCard, setRunStartCard] = useState<RepCard | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [hintUci, setHintUci] = useState<string | null>(null)
  const [runHadMistake, setRunHadMistake] = useState(false)
  const [runMoves, setRunMoves] = useState<RunMove[]>([]) // reactive mirror of runMovesRef, for the "line so far" display
  const [progress, setProgress] = useState({ step: 0, sessionLength: null as number | null })

  const [summary, setSummary] = useState<ReturnType<typeof summarise> | null>(null)

  const gameIdRef = useRef<string | null>(null)
  const sessionRef = useRef<SessionState | null>(null)
  const sessionCardsRef = useRef<RepCard[]>([]) // filtered card list for this session
  const selectedChapterIdsRef = useRef<Set<string>>(new Set()) // chapters selected for this session
  const runStartCardIdRef = useRef<string | null>(null)
  const runMovesRef = useRef<RunMove[]>([])
  const gradedThisPresentationRef = useRef(false)
  const moveReqId = useRef(0)
  const lastArgsRef = useRef<{ repertoireId: string; chapterIds: string[]; opts: SessionOptions } | null>(null)

  const liveIndex = runSnapshots.length - 1
  const isViewingHistory = viewIndex !== null && viewIndex !== liveIndex
  const liveGameState: GameState | null = liveIndex >= 0 ? runSnapshots[liveIndex] : null
  const viewedGameState: GameState | null =
    viewIndex !== null ? (runSnapshots[viewIndex] ?? liveGameState) : liveGameState
  // While reviewing history the board is read-only (no selection); at live
  // it reflects the current click-to-move selection as normal.
  const boardState: BoardState | null = viewedGameState
    ? toBoardState(viewedGameState, isViewingHistory ? null : selected)
    : null

  const cardById = useCallback(
    (id: string): RepCard | undefined => sessionCardsRef.current.find((c) => c.id === id),
    [],
  )

  // resolveRunStartCard maps whatever card the scheduler picked as "due" to
  // the card that begins that card's own chapter — the scheduler still
  // decides *which line* most needs review (via lapses/due-time), but a run
  // is never started mid-line, including inside a sideline: it always
  // replays from the true beginning of the chapter and walks forward
  // naturally from there, so the due card (and everything before it) gets
  // graded as it's actually reached, not jumped to directly.
  // Takes `rep` explicitly (rather than closing over the `repertoire` state)
  // because startSession needs to call this synchronously right after
  // setRepertoireState, before that state update has actually committed.
  const resolveRunStartCard = useCallback(
    (rep: Repertoire, dueCard: RepCard): RepCard => {
      const chapterId = dueCard.chapterIds.find((id) => selectedChapterIdsRef.current.has(id)) ?? dueCard.chapterIds[0]
      const chapter = rep.chapters.find((c) => c.id === chapterId)
      if (!chapter) return dueCard
      const startCard = cardById(cardKey(chapter.startFen))
      return startCard ?? dueCard
    },
    [cardById],
  )

  // pushSnapshot records a new ply's position, appended to the run's history,
  // and snaps the view back to live (a fresh move always returns you to now).
  function pushSnapshot(gs: GameState) {
    const next = [...runSnapshotsRef.current, gs]
    runSnapshotsRef.current = next
    setRunSnapshots(next)
    setViewIndex(null)
  }

  // replaceLastSnapshot swaps the current (live) position without adding a
  // new ply — used after a wrong-answer undo, which returns to the same
  // position the card was already at, not a new move.
  function replaceLastSnapshot(gs: GameState) {
    const next = runSnapshotsRef.current.length > 0 ? [...runSnapshotsRef.current] : [gs]
    if (next.length > 0) next[next.length - 1] = gs
    runSnapshotsRef.current = next
    setRunSnapshots(next)
    setViewIndex(null)
  }

  // beginRun puts the board at `card`'s position and resets all per-run
  // bookkeeping. Refs and setState setters are stable across renders, so
  // this needs no dependencies.
  const beginRun = useCallback((card: RepCard, gs: GameState) => {
    runStartCardIdRef.current = card.id
    runMovesRef.current = []
    setRunMoves([])
    gradedThisPresentationRef.current = false
    setRunHadMistake(false)
    setRunStartCard(card)
    setCurrentCard(card)
    setFeedback(null)
    setHintUci(null)
    setSelected(null)
    runSnapshotsRef.current = [gs]
    setRunSnapshots([gs])
    setViewIndex(null)
  }, [])

  // pickOpponentReply implements the weighted-random reply choice from
  // design.md §6 — reaching for the reply pool at `fen` and biasing toward
  // whichever continuation currently has more lapses recorded against it.
  const pickOpponentReply = useCallback(
    (fen: string) => {
      if (!repertoire) return null
      const replies = repertoire.replies[cardKey(fen)]
      if (!replies || replies.length === 0) return null
      const session = sessionRef.current
      return weightedChoice(
        replies,
        (r) => 1 + WEAKNESS_W * (session?.cards.get(cardKey(r.fen))?.lapses ?? 0),
        Math.random,
      )
    },
    [repertoire],
  )

  // endRun persists this session's per-card progress so far (so nothing is
  // lost if the user closes the tab) and moves to the line-complete gate
  // (Analyze / Redo-or-Next). Runs, not sessions, end here — the session-log
  // entry itself is written once, at actual session end (nextLine's
  // isComplete branch / endSession), not on every run boundary.
  const endRun = useCallback(() => {
    const session = sessionRef.current
    if (session && repertoire) {
      const prior = loadPersisted(repertoire.id)
      savePersisted(repertoire.id, mergeSessionIntoPersisted(repertoire.id, prior, session))
      setProgress({ step: session.step, sessionLength: session.opts.sessionLength })
    }
    // Clear any hint arrow left over from a wrong-attempt-then-correct-retry
    // earlier in this run — otherwise it stays pointing at an already-
    // superseded move on the line-complete screen's board.
    setHintUci(null)
    setPhase('line-complete')
  }, [repertoire])

  // proceedAfterCorrect plays the opponent's reply (if the repertoire has
  // one recorded) and advances the run into the next card; otherwise the
  // run has reached a leaf/out-of-book and ends here.
  const proceedAfterCorrect = useCallback(
    async (answerFen: string) => {
      const gid = gameIdRef.current
      if (!gid) return

      const reply = pickOpponentReply(answerFen)
      if (!reply) {
        endRun()
        return
      }

      await apiSetPosition(gid, answerFen)
      const gs = await makeMove(gid, reply.uci.slice(0, 2), reply.uci.slice(2, 4), promotionFromUci(reply.uci))
      runMovesRef.current.push({ san: reply.san, uci: reply.uci, mover: 'opponent' })
      setRunMoves([...runMovesRef.current])
      pushSnapshot(gs)

      const nextCard = cardById(cardKey(gs.fen))
      if (!nextCard) {
        endRun()
        return
      }

      gradedThisPresentationRef.current = false
      setCurrentCard(nextCard)
      // Feedback is intentionally left showing (the "✓ Correct" banner from
      // the move that just advanced the run) — it stays up through the
      // opponent's reply and into the new prompt, and only gets replaced
      // once the user's next move attempt grades and sets a fresh one.
      setHintUci(null)
      setSelected(null)
    },
    [pickOpponentReply, endRun, cardById],
  )

  // --- session lifecycle ---

  const startSession = useCallback(
    async (repertoireId: string, chapterIds: string[], opts: SessionOptions) => {
      lastArgsRef.current = { repertoireId, chapterIds, opts }
      setLoading(true)
      setLoadError(null)
      try {
        const rep = await getRepertoire(repertoireId)
        setRepertoireState(rep)
        setFlipped(rep.side === 'b')

        const selectedChapters = new Set(chapterIds)
        selectedChapterIdsRef.current = selectedChapters
        const cards = rep.cards.filter((c) => c.chapterIds.some((id) => selectedChapters.has(id)))
        if (cards.length === 0) {
          setLoadError('No positions for the selected chapters.')
          setLoading(false)
          return
        }
        sessionCardsRef.current = cards

        const saved = loadPersisted(repertoireId)
        const session = createSession(cards, opts, saved, newRng())
        sessionRef.current = session

        const first = pickNext(session)
        if (!first) {
          setLoadError('Nothing to drill in this selection.')
          setLoading(false)
          return
        }
        const dueCard = cards.find((c) => c.id === first.cardId)!
        const firstCard = resolveRunStartCard(rep, dueCard)
        setProgress({ step: session.step, sessionLength: opts.sessionLength })

        const gs = await createGame(firstCard.fen)
        gameIdRef.current = gs.id

        beginRun(firstCard, gs)
        setPhase('drilling')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to start session.')
      } finally {
        setLoading(false)
      }
    },
    [beginRun, resolveRunStartCard],
  )

  const submitMove = useCallback(
    async (from: Square, to: Square) => {
      const gid = gameIdRef.current
      const card = currentCard
      if (!gid || !card || phase !== 'drilling' || busy || isViewingHistory) return

      setBusy(true)
      const reqId = ++moveReqId.current
      try {
        const piece = boardState?.pieces[from]
        const isPromo =
          piece?.type === 'p' && ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'))
        const gs = await makeMove(gid, from, to, isPromo ? 'q' : undefined)
        if (reqId !== moveReqId.current) return

        // gs.moveTree.children[0] is only "the move just played" right after a
        // tree reset — within a run the tree accumulates every ply, so the
        // played node must be looked up by the current node id instead.
        const played = flatten(gs.moveTree).get(gs.currentNodeId)?.node
        const playedSan = played?.san ?? ''

        const matchAnswer = card.answers.find((a) => a.san === playedSan)
        const matchExcluded = card.excludedAnswers?.find((a) => a.san === playedSan)

        if (matchAnswer) {
          if (!gradedThisPresentationRef.current) {
            grade(sessionRef.current!, card.id, true)
            gradedThisPresentationRef.current = true
          }
          runMovesRef.current.push({ san: playedSan, uci: `${from}${to}${isPromo ? 'q' : ''}`, mover: 'user' })
          setRunMoves([...runMovesRef.current])
          setSelected(null)
          pushSnapshot(gs)
          setFeedback({
            kind: matchAnswer.primary ? 'correct' : 'correct-alt',
            playedSan,
            comment: matchAnswer.comment,
          })
          setProgress((p) => ({ ...p, step: sessionRef.current?.step ?? p.step }))
          await sleep(450)
          if (reqId !== moveReqId.current) return
          // Use gs.fen (the position the backend just actually computed) rather
          // than matchAnswer.fen (fixed at repertoire-build time from whichever
          // chapter first contributed this answer) — normally identical, but if
          // this card/answer is reached via a longer/shorter transposed path in
          // a different chapter, matchAnswer.fen's clocks would be wrong for
          // this specific run. gs.fen is always correct by construction.
          await proceedAfterCorrect(gs.fen)
        } else {
          setRunHadMistake(true)
          if (!gradedThisPresentationRef.current) {
            grade(sessionRef.current!, card.id, false)
            gradedThisPresentationRef.current = true
          }
          const primary = card.answers.find((a) => a.primary) ?? card.answers[0]
          setFeedback({
            kind: matchExcluded ? 'excluded' : 'incorrect',
            playedSan,
            expectedSan: primary?.san,
            reason: matchExcluded?.reason,
          })
          setHintUci(primary?.uci ?? null)
          // undo: put the board back at the card's own position for a retry
          // (replaces the current/live snapshot in place — this isn't a new
          // ply, just a restore of the position the card was already at)
          const back = await apiSetPosition(gid, card.fen)
          if (reqId !== moveReqId.current) return
          setSelected(null)
          replaceLastSnapshot(back)
        }
      } catch {
        // network hiccup — leave the position untouched, allow retry
      } finally {
        if (reqId === moveReqId.current) setBusy(false)
      }
    },
    [currentCard, phase, busy, boardState, isViewingHistory, proceedAfterCorrect],
  )

  // --- click-to-move / drag-and-drop plumbing (mirrors useChessGame) ---

  const selectSquare = useCallback(
    (square: Square) => {
      if (!boardState || busy || isViewingHistory) return
      if (selected === square) {
        setSelected(null)
        return
      }
      if (selected) {
        const legal = boardState.legalMoves.includes(square) || false
        if (legal) {
          submitMove(selected, square)
          return
        }
      }
      const piece = boardState.pieces[square]
      if (piece && piece.color === boardState.turn) {
        setSelected(square)
      } else {
        setSelected(null)
      }
    },
    [boardState, selected, busy, isViewingHistory, submitMove],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] => {
      if (!liveGameState || isViewingHistory) return []
      return liveGameState.legalMoves.filter((m) => m.from === square).map((m) => m.to)
    },
    [liveGameState, isViewingHistory],
  )

  // --- line-so-far navigation (review only — never mutates the live drill) ---

  const navBack = useCallback(() => {
    setViewIndex((v) => {
      const last = runSnapshotsRef.current.length - 1
      const current = v ?? last
      return Math.max(0, current - 1)
    })
  }, [])

  const navForward = useCallback(() => {
    setViewIndex((v) => {
      if (v === null) return null // already live
      const last = runSnapshotsRef.current.length - 1
      const next = v + 1
      return next >= last ? null : next
    })
  }, [])

  // gotoPly jumps straight to a specific position in the run's history —
  // index 0 is the position before any move, index i+1 is the position
  // right after runMoves[i]. Clicking the live/last entry returns to live.
  const gotoPly = useCallback((index: number) => {
    const last = runSnapshotsRef.current.length - 1
    setViewIndex(index >= last ? null : Math.max(0, index))
  }, [])

  // --- end-of-run actions ---

  const redoLine = useCallback(async () => {
    const gid = gameIdRef.current
    const startId = runStartCardIdRef.current
    if (!gid || !startId) return
    const card = cardById(startId)
    if (!card) return
    setBusy(true)
    try {
      const gs = await apiSetPosition(gid, card.fen)
      beginRun(card, gs)
      setPhase('drilling')
    } finally {
      setBusy(false)
    }
  }, [cardById, beginRun])

  // persistSessionEnd writes the one-time session-log entry (see the note on
  // mergeSessionIntoPersisted) — called only when the session actually ends,
  // not on every run boundary within it.
  const persistSessionEnd = useCallback(
    (session: SessionState) => {
      if (!repertoire) return
      const prior = loadPersisted(repertoire.id)
      const log = {
        startedISO: new Date().toISOString(),
        endedISO: new Date().toISOString(),
        steps: session.step,
        correct: session.correctCount,
        cardsSeen: session.order.filter((id) => session.cards.get(id)!.seen > 0).length,
      }
      savePersisted(repertoire.id, mergeSessionIntoPersisted(repertoire.id, prior, session, log))
    },
    [repertoire],
  )

  const nextLine = useCallback(async () => {
    const session = sessionRef.current
    const gid = gameIdRef.current
    if (!session || !gid) return
    if (isComplete(session)) {
      persistSessionEnd(session)
      setSummary(summarise(session))
      setPhase('summary')
      return
    }
    const next = pickNext(session)
    if (!next) {
      persistSessionEnd(session)
      setSummary(summarise(session))
      setPhase('summary')
      return
    }
    const dueCard = cardById(next.cardId)
    if (!dueCard || !repertoire) return
    const card = resolveRunStartCard(repertoire, dueCard)
    setBusy(true)
    try {
      const gs = await apiSetPosition(gid, card.fen)
      beginRun(card, gs)
      setPhase('drilling')
    } finally {
      setBusy(false)
    }
  }, [cardById, beginRun, persistSessionEnd, repertoire, resolveRunStartCard])

  // analyzeLine hands the exact line just drilled off to the Analysis Board:
  // builds a fresh game at the run's starting position, replays every move
  // actually played this run (both sides), and navigates there.
  const analyzeLine = useCallback(async () => {
    const startId = runStartCardIdRef.current
    if (!startId) return
    const startCard = cardById(startId)
    if (!startCard) return
    setBusy(true)
    try {
      const gs = await createGame(startCard.fen)
      const gid = gs.id
      for (const mv of runMovesRef.current) {
        const from = mv.uci.slice(0, 2)
        const to = mv.uci.slice(2, 4)
        await makeMove(gid, from, to, promotionFromUci(mv.uci))
      }
      window.location.href = `/?gameId=${gid}`
    } finally {
      setBusy(false)
    }
  }, [cardById])

  const endSession = useCallback(() => {
    const session = sessionRef.current
    if (session) {
      persistSessionEnd(session)
      setSummary(summarise(session))
    }
    setPhase('summary')
  }, [persistSessionEnd])

  // sameAgain restarts a fresh session against the same repertoire/chapters/
  // options just used (picking up wherever persisted progress now stands).
  const sameAgain = useCallback(() => {
    const args = lastArgsRef.current
    if (!args) return
    setSummary(null)
    startSession(args.repertoireId, args.chapterIds, args.opts)
  }, [startSession])

  // drillMistakes restarts a session over just this session's missed cards
  // (mode: 'mistakes').
  const drillMistakes = useCallback(() => {
    const args = lastArgsRef.current
    if (!args) return
    setSummary(null)
    startSession(args.repertoireId, args.chapterIds, { ...args.opts, mode: 'mistakes' })
  }, [startSession])

  const changeRepertoire = useCallback(() => {
    setSummary(null)
    setRepertoireState(null)
    sessionRef.current = null
    gameIdRef.current = null
    setPhase('setup')
  }, [])

  const toggleFlipped = useCallback(() => setFlipped((f) => !f), [])

  return {
    phase,
    repertoire,
    loadError,
    loading,
    boardState,
    busy,
    flipped,
    toggleFlipped,
    currentCard,
    runStartCard,
    feedback,
    hintUci,
    runHadMistake,
    runMoves,
    progress,
    summary,
    viewIndex,
    isViewingHistory,
    navBack,
    navForward,
    gotoPly,
    startSession,
    selectSquare,
    move: submitMove,
    legalMovesFor,
    redoLine,
    nextLine,
    analyzeLine,
    endSession,
    sameAgain,
    drillMistakes,
    changeRepertoire,
    cardById,
  }
}

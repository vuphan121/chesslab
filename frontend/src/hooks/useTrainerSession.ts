'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Chess } from 'chess.js'
import {
  createGame,
  makeMove,
  getRepertoire,
  getProgress as apiGetProgress,
  saveProgress as apiSaveProgress,
  getTodayTraining,
  advanceTodayTraining,
  pingBackend,
} from '@/lib/api/client'
import type { GameState, TodayTrainingEntry, TodayTrainingResponse } from '@/lib/api/client'
import type { BoardState, Color, PieceType, Square } from '@/lib/chess/types'
import type { Repertoire, RepCard, RepChapter, RepNode, SessionOptions, SessionState, PersistedCardState } from '@/lib/trainer/types'
import { createSession, grade, isComplete, summarise } from '@/lib/trainer/scheduler'
import { newRng } from '@/lib/trainer/rng'
import { cardKey } from '@/lib/trainer/cardKey'
import { mergeSessionCards, progressDeltas } from '@/lib/trainer/persistence'
import { chooseOpponentReply } from '@/lib/trainer/replySelection'
import { buildDrillLines, createLineQueue, nextQueuedLine, switchToLineThrough } from '@/lib/trainer/lineQueue'
import type { DrillLine, LineQueue } from '@/lib/trainer/lineQueue'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function promotionFromUci(uci: string): string | undefined {
  return uci.length >= 5 ? uci[4] : undefined
}

/**
 * Opening Study is intentionally self-contained while drilling.  The
 * repertoire is already present in the browser, so using chess.js here keeps
 * legal-move validation and board updates off the network.  We retain the
 * GameState-shaped snapshots because the board and its history controls share
 * that view model with the analysis board.
 */
function localGameState(fen: string, lastMove: GameState['lastMove'] = null): GameState {
  const game = new Chess(fen)
  const pieces: GameState['pieces'] = {}
  const files = 'abcdefgh'
  for (const [row, rank] of game.board().entries()) {
    for (const [file, piece] of rank.entries()) {
      if (piece) pieces[`${files[file]}${8 - row}`] = { type: piece.type, color: piece.color }
    }
  }
  const legalMoves = game.moves({ verbose: true }).map((move) => ({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  }))
  const fields = game.fen().split(' ')
  const isCheckmate = game.isCheckmate()
  const isStalemate = game.isStalemate()
  const isDraw = game.isDraw()
  return {
    id: 'opening-study-local',
    fen: game.fen(),
    turn: game.turn(),
    fullMove: Number(fields[5] ?? 1),
    pieces,
    legalMoves,
    lastMove,
    isCheck: game.isCheck(),
    isCheckmate,
    isStalemate,
    isDraw,
    isGameOver: game.isGameOver(),
    gameOverReason: isCheckmate ? 'checkmate' : isStalemate ? 'stalemate' : isDraw ? 'draw' : '',
    moveTree: { id: 'root', san: '', fen: game.fen(), ply: 0, children: [] },
    currentNodeId: 'root',
  }
}

function applyLocalMove(state: GameState, from: string, to: string, promotion?: string): { state: GameState; san: string } {
  const game = new Chess(state.fen)
  const move = game.move({ from, to, promotion })
  if (!move) throw new Error('Illegal move')
  return { state: localGameState(game.fen(), { from: move.from, to: move.to, promotion: move.promotion }), san: move.san }
}










function findPathInChapterTree(node: RepNode, targetKey: string, path: string[] = []): string[] | null {
  if (cardKey(node.fen) === targetKey) return path
  for (const child of node.children ?? []) {
    const found = findPathInChapterTree(child, targetKey, [...path, child.san])
    if (found) return found
  }
  return null
}

// Walks a chapter tree along `fullPath` (SAN from the chapter root) until it
// reaches the first position that is a drillable card. The moves passed on the
// way are the opponent's — they're played for the user before the first
// prompt. `targetPath` is what's left of the path once those are stripped,
// i.e. relative to where the run actually starts.
function walkToFirstCard(
  chapter: RepChapter,
  fullPath: string[],
  cardById: (id: string) => RepCard | undefined,
): { card: RepCard | undefined; targetPath: string[]; leadingMoves: RunMove[] } {
  let node = chapter.tree
  let startCard = cardById(cardKey(node.fen))
  const leadingMoves: RunMove[] = []
  for (const san of fullPath) {
    if (startCard) break
    const next = (node.children ?? []).find((c) => c.san === san)
    if (!next) break
    node = next
    leadingMoves.push({ san: next.san, uci: next.uci, mover: 'opponent' })
    startCard = cardById(cardKey(node.fen))
  }
  return { card: startCard, targetPath: fullPath.slice(leadingMoves.length), leadingMoves }
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
  kind: 'correct' | 'correct-alt' | 'incorrect' | 'excluded' | 'line-end' | 'error'
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
  const router = useRouter()
  const [phase, setPhase] = useState<TrainerPhase>('setup')
  const [repertoire, setRepertoireState] = useState<Repertoire | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Drilling itself never talks to the backend (moves are simulated locally
  // via chess.js — see localGameState above), so a long study session can
  // leave Render's free-tier instance idle long enough to spin down. The
  // next real request (switching chapters, saving progress) then eats a
  // cold-start hit. Ping /healthz periodically while a session is active to
  // keep the instance warm through the gaps between backend calls.
  useEffect(() => {
    if (phase !== 'drilling' && phase !== 'line-complete') return
    const interval = setInterval(pingBackend, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [phase])






  const [runSnapshots, setRunSnapshots] = useState<GameState[]>([])
  const runSnapshotsRef = useRef<GameState[]>([])


  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [busy, setBusy] = useState(false)
  const [animateLastMove, setAnimateLastMove] = useState(false)
  const [flipped, setFlipped] = useState(false)

  const [currentCard, setCurrentCard] = useState<RepCard | null>(null)
  const [runStartCard, setRunStartCard] = useState<RepCard | null>(null)
  // The chapter this run's line was actually taken from. Can't be derived
  // from runStartCard: early positions are shared by every chapter that
  // passes through them (e.g. all four Trompowsky chapters start 1.d4 Nf6
  // 2.Bg5 c5), so the card alone only says "one of these chapters".
  const [runChapterId, setRunChapterId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [hintUci, setHintUci] = useState<string | null>(null)
  const [runHadMistake, setRunHadMistake] = useState(false)
  const [runMoves, setRunMoves] = useState<RunMove[]>([])







  const [leadingMoves, setLeadingMoves] = useState<RunMove[]>([])

  const [summary, setSummary] = useState<ReturnType<typeof summarise> | null>(null)
  const [isTodayTraining, setIsTodayTraining] = useState(false)

  const sessionRef = useRef<SessionState | null>(null)
  const sessionCardsRef = useRef<RepCard[]>([])
  const selectedChapterIdsRef = useRef<Set<string>>(new Set())
  const runStartCardIdRef = useRef<string | null>(null)
  const runChapterIdRef = useRef<string | null>(null)
  const runMovesRef = useRef<RunMove[]>([])













  const dueTargetPathRef = useRef<string[] | null>(null)
  // The deck of lines for the current session (see lib/trainer/lineQueue.ts),
  // and whether the current run is one of its lines. In line mode
  // `dueTargetPathRef` holds the ENTIRE line, so every opponent reply is
  // forced and the run ends where the line does — which is what makes "Do it
  // again" replay the identical line and "Next line" a genuinely different
  // one. Today's-training runs are still built around a single due card and
  // free-walk past it, so they leave this off.
  const lineQueueRef = useRef<LineQueue | null>(null)
  const lineModeRef = useRef(false)
  // The deck line the current run is following (see followPlayedAnswer).
  const runLineIdRef = useRef<string | null>(null)
  // Set when a line run was taken off its line by a repertoire move that no
  // selected line continues from. The rest of the run then free-walks like a
  // today's-training run. "Do it again" keeps it, so a redo retraces the
  // same moves.
  const offLineRef = useRef(false)



  const leadingMovesRef = useRef<RunMove[]>([])
  const gradedThisPresentationRef = useRef(false)
  const moveReqId = useRef(0)
  // startSession has two awaits (getRepertoire, then getProgress) before it
  // commits any state; without this, picking repertoire A then quickly B
  // could let A's slower response land after B's and silently overwrite it.
  const startSessionReqId = useRef(0)
  const lastArgsRef = useRef<{ repertoireId: string; chapterIds: string[]; opts: SessionOptions } | null>(null)




  const sessionProgressRef = useRef<Record<string, PersistedCardState>>({})
  const progressSaveChainRef = useRef<Promise<void>>(Promise.resolve())
  const todayEntryRef = useRef<TodayTrainingEntry | null>(null)
  const todayAdvanceRef = useRef<Promise<TodayTrainingResponse> | null>(null)

  const liveIndex = runSnapshots.length - 1
  const isViewingHistory = viewIndex !== null && viewIndex !== liveIndex
  const liveGameState: GameState | null = liveIndex >= 0 ? runSnapshots[liveIndex] : null
  const viewedGameState: GameState | null =
    viewIndex !== null ? (runSnapshots[viewIndex] ?? liveGameState) : liveGameState


  const boardState: BoardState | null = viewedGameState
    ? toBoardState(viewedGameState, isViewingHistory ? null : selected)
    : null

  const cardById = useCallback(
    (id: string): RepCard | undefined => sessionCardsRef.current.find((c) => c.id === id),
    [],
  )

























































  const resolveRunStartCard = useCallback(
    (
      rep: Repertoire,
      dueCard: RepCard,
    ): { card: RepCard; chapterId: string | null; targetPath: string[]; leadingMoves: RunMove[] } => {
      const chapterId = dueCard.chapterIds.find((id) => selectedChapterIdsRef.current.has(id)) ?? dueCard.chapterIds[0]
      const chapter = rep.chapters.find((c) => c.id === chapterId)
      if (!chapter) return { card: dueCard, chapterId: chapterId ?? null, targetPath: dueCard.pathSan, leadingMoves: [] }
      const fullPath = findPathInChapterTree(chapter.tree, cardKey(dueCard.fen)) ?? dueCard.pathSan
      const start = walkToFirstCard(chapter, fullPath, cardById)
      return { card: start.card ?? dueCard, chapterId: chapter.id, targetPath: start.targetPath, leadingMoves: start.leadingMoves }
    },
    [cardById],
  )



  function pushSnapshot(gs: GameState, animateMove = false) {
    const next = [...runSnapshotsRef.current, gs]
    runSnapshotsRef.current = next
    setRunSnapshots(next)
    setViewIndex(null)
    setAnimateLastMove(animateMove)
  }




  function replaceLastSnapshot(gs: GameState) {
    const next = runSnapshotsRef.current.length > 0 ? [...runSnapshotsRef.current] : [gs]
    if (next.length > 0) next[next.length - 1] = gs
    runSnapshotsRef.current = next
    setRunSnapshots(next)
    setViewIndex(null)
    setAnimateLastMove(false)
  }




  const beginRun = useCallback((card: RepCard, chapterId: string | null, gs: GameState, leading: RunMove[] = []) => {
    runStartCardIdRef.current = card.id
    runChapterIdRef.current = chapterId
    setRunChapterId(chapterId)
    runMovesRef.current = []
    setRunMoves([])
    setLeadingMoves(leading)
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
    setAnimateLastMove(false)
  }, [])








  const pickOpponentReply = useCallback(
    (fen: string) => {
      if (!repertoire) return null
      const replies = repertoire.replies[cardKey(fen)]
      if (!replies || replies.length === 0) return null

      const session = sessionRef.current
      const playedSans = runMovesRef.current.map((m) => m.san)
      // A queued line is a fixed path: once it's used up, the line is over.
      // (Without this, a leaf that transposes into another chapter's
      // position would keep going down whatever it happens to have there.)
      const followsLine = lineModeRef.current && !offLineRef.current
      if (followsLine && playedSans.length >= (dueTargetPathRef.current?.length ?? 0)) return null
      const chosen = chooseOpponentReply(
        replies,
        dueTargetPathRef.current,
        playedSans,
        (replyFen) => session?.cards.get(cardKey(replyFen))?.lapses ?? 0,
        Math.random,
      )
      if (!chosen) return null
      // Line mode never rewrites the line — even if the user played an
      // alternate answer and a fallback reply had to be picked, a redo still
      // has to retrace the original line.
      if (!followsLine) dueTargetPathRef.current = chosen.nextTargetPath
      return chosen.reply
    },
    [repertoire],
  )










  // logAttempt=false is a mid-line skip (the user hit "Next line" before
  // finishing): whatever cards were actually graded up to this point still
  // get persisted, but no line_attempts row is logged and the run doesn't
  // count as done — see nextLine below, which is the only other caller that
  // passes false. The line is still "consumed" from the queue either way
  // (todayAdvanceRef/startNextQueuedLine run the same regardless).
  const endRun = useCallback((opts?: { logAttempt?: boolean }) => {
    const logAttempt = opts?.logAttempt ?? true
    const session = sessionRef.current
    if (session && repertoire) {
      const merged = mergeSessionCards(sessionProgressRef.current, session)
      const deltas = progressDeltas(sessionProgressRef.current, merged)
      sessionProgressRef.current = merged

      let lineAttempt: { chapterId: string; chapterName: string; cardId: string; hadMistake: boolean } | undefined
      if (logAttempt) {
        const startCard = runStartCardIdRef.current ? cardById(runStartCardIdRef.current) : undefined
        // The chapter the run's line was actually dealt from — a start card
        // is often shared by several chapters, so its chapterIds can't say
        // which one this run was (see runChapterId).
        const chapterId = runChapterIdRef.current ?? startCard?.chapterIds[0]
        const chapter = chapterId ? repertoire.chapters.find((c) => c.id === chapterId) : undefined
        lineAttempt =
          startCard && chapter
            ? { chapterId: chapter.id, chapterName: chapter.name, cardId: startCard.id, hadMistake: runHadMistake }
            : undefined
      }

      const operationId = crypto.randomUUID()
      progressSaveChainRef.current = progressSaveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (Object.keys(deltas).length === 0 && !lineAttempt) return
          try {
            await apiSaveProgress(repertoire.id, merged, lineAttempt, deltas, operationId)
          } catch {
            // A response can be lost after the transaction commits. Retrying
            // with the same operation id is safe and avoids silently dropping
            // a run on an ordinary transient network failure.
            await apiSaveProgress(repertoire.id, merged, lineAttempt, deltas, operationId)
          }
        })
        .catch(() => undefined)
    }

    const todayEntry = todayEntryRef.current
    if (todayEntry) {
      // A redo before the previous advance call was ever consumed (e.g. two
      // "Do it again"s in a row) would otherwise orphan that promise —
      // nothing awaits it once this overwrites the ref, so its rejection
      // would surface as an unhandled rejection instead of the graceful
      // "couldn't advance the queue" handling in advanceToNextLine.
      todayAdvanceRef.current?.catch(() => {})
      todayAdvanceRef.current = advanceTodayTraining(todayEntry.repertoireId, todayEntry.cardId)
    }



    setHintUci(null)
    if (logAttempt) setPhase('line-complete')
  }, [repertoire, cardById, runHadMistake])




  const proceedAfterCorrect = useCallback(
    async (answerState: GameState) => {

      const reply = pickOpponentReply(answerState.fen)
      if (!reply) {
        endRun()
        return
      }

      const { state: gs } = applyLocalMove(
        answerState,
        reply.uci.slice(0, 2),
        reply.uci.slice(2, 4),
        promotionFromUci(reply.uci),
      )
      runMovesRef.current.push({ san: reply.san, uci: reply.uci, mover: 'opponent' })
      setRunMoves([...runMovesRef.current])
      pushSnapshot(gs, true)

      const nextCard = cardById(cardKey(gs.fen))
      const lineFinished =
        lineModeRef.current && !offLineRef.current && runMovesRef.current.length >= (dueTargetPathRef.current?.length ?? 0)
      if (!nextCard || lineFinished) {
        endRun()
        return
      }

      gradedThisPresentationRef.current = false
      setCurrentCard(nextCard)




      setHintUci(null)
      setSelected(null)
    },
    [pickOpponentReply, endRun, cardById],
  )



  // Deals the next line off the session's deck and starts a run on it.
  // Returns false when nothing is left to drill (the deck has no active line).
  const startNextQueuedLine = useCallback(
    (rep: Repertoire): boolean => {
      const session = sessionRef.current
      const queue = lineQueueRef.current
      if (!session || !queue) return false

      // A line is worth dealing while at least one of its positions is a
      // card the session hasn't retired.
      const isActive = (line: DrillLine) =>
        line.positionKeys.some((key) => {
          const card = session.cards.get(key)
          return !!card && !card.retired
        })

      // An active line always has a card on it, so the first deal should
      // resolve; the bound only guards against looping on bad data.
      for (let attempt = 0; attempt < queue.lines.length; attempt++) {
        const line = nextQueuedLine(queue, isActive)
        if (!line) return false
        const chapter = rep.chapters.find((c) => c.id === line.chapterId)
        if (!chapter) continue
        const start = walkToFirstCard(chapter, line.path, cardById)
        if (!start.card) continue

        dueTargetPathRef.current = start.targetPath
        leadingMovesRef.current = start.leadingMoves
        runLineIdRef.current = line.id
        offLineRef.current = false
        beginRun(start.card, chapter.id, localGameState(start.card.fen), start.leadingMoves)
        return true
      }
      return false
    },
    [beginRun, cardById],
  )

  const startSession = useCallback(
    async (repertoireId: string, chapterIds: string[], opts: SessionOptions) => {
      const reqId = ++startSessionReqId.current
      setIsTodayTraining(false)
      todayEntryRef.current = null
      todayAdvanceRef.current = null
      lastArgsRef.current = { repertoireId, chapterIds, opts }
      setLoading(true)
      setLoadError(null)
      try {
        // Fire both requests immediately instead of awaiting getRepertoire
        // first — neither depends on the other's result, and on a cold
        // backend that halved a two-round-trip wait to one.
        const repPromise = getRepertoire(repertoireId)
        const progressPromise = apiGetProgress(repertoireId).catch(() => null)

        const rep = await repPromise
        if (reqId !== startSessionReqId.current) return
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

        const progressResult = await progressPromise
        if (reqId !== startSessionReqId.current) return
        const saved: Record<string, PersistedCardState> = progressResult?.cards ?? {}
        sessionProgressRef.current = saved
        const session = createSession(cards, opts, saved, newRng())
        sessionRef.current = session
        lineQueueRef.current = createLineQueue(
          buildDrillLines(rep.chapters.filter((c) => selectedChapters.has(c.id))),
          session.rng,
        )
        lineModeRef.current = true

        if (!startNextQueuedLine(rep)) {
          setLoadError('Nothing to drill in this selection.')
          setLoading(false)
          return
        }
        setPhase('drilling')
      } catch (err) {
        if (reqId === startSessionReqId.current) {
          setLoadError(err instanceof Error ? err.message : 'Failed to start session.')
        }
      } finally {
        if (reqId === startSessionReqId.current) setLoading(false)
      }
    },
    [startNextQueuedLine],
  )

  const startTodayEntry = useCallback(
    async (entry: TodayTrainingEntry, existingReqId?: number) => {
      const reqId = existingReqId ?? ++startSessionReqId.current
      setLoading(true)
      setLoadError(null)
      try {
        const repPromise = getRepertoire(entry.repertoireId)
        const progressPromise = apiGetProgress(entry.repertoireId).catch(() => null)

        const rep = await repPromise
        if (reqId !== startSessionReqId.current) return
        const dueCard = rep.cards.find((card) => card.id === entry.cardId)
        if (!dueCard) throw new Error('This line is no longer available in its repertoire.')
        setRepertoireState(rep)
        setFlipped(rep.side === 'b')
        selectedChapterIdsRef.current = new Set(rep.chapters.map((chapter) => chapter.id))
        sessionCardsRef.current = rep.cards

        const progressResult = await progressPromise
        if (reqId !== startSessionReqId.current) return
        const saved: Record<string, PersistedCardState> = progressResult?.cards ?? {}
        sessionProgressRef.current = saved
        sessionRef.current = createSession(rep.cards, { sessionLength: null, mode: 'mixed' }, saved, newRng())
        const { card, chapterId, targetPath, leadingMoves: leading } = resolveRunStartCard(rep, dueCard)
        lineModeRef.current = false
        lineQueueRef.current = null
        runLineIdRef.current = null
        offLineRef.current = false
        dueTargetPathRef.current = targetPath
        leadingMovesRef.current = leading
        todayEntryRef.current = entry
        beginRun(card, chapterId, localGameState(card.fen), leading)
        setPhase('drilling')
      } catch (err) {
        if (reqId === startSessionReqId.current) {
          setLoadError(err instanceof Error ? err.message : "Couldn't start today's line.")
          setPhase('setup')
        }
      } finally {
        if (reqId === startSessionReqId.current) setLoading(false)
      }
    },
    [beginRun, resolveRunStartCard],
  )

  const resumeTodayTraining = useCallback(
    async () => {
      const reqId = ++startSessionReqId.current
      setIsTodayTraining(true)
      setLoading(true)
      setLoadError(null)
      try {
        const queue = await getTodayTraining()
        if (reqId !== startSessionReqId.current) return
        const first = queue.entries[0]
        if (!first) throw new Error("Today's queue is empty.")
        await startTodayEntry(first, reqId)
      } catch (err) {
        if (reqId === startSessionReqId.current) {
          setLoadError(err instanceof Error ? err.message : "Couldn't resume today's queue.")
          setLoading(false)
        }
      }
    },
    [startTodayEntry],
  )

  // The user played a repertoire move that isn't the one this run planned.
  // It still counts as correct, so the run follows it. In line mode that
  // means switching to a deck line that continues from the new position
  // (the chapter label switches with it). If no selected line does, the
  // rest of the run free-walks the repertoire instead. Without this the run
  // kept forcing the old line's replies from a position that line never
  // reaches, so a run labeled with one chapter played out another.
  const followPlayedAnswer = useCallback((fen: string, answerChapterIds: string[]) => {
    const playedSans = runMovesRef.current.map((m) => m.san)
    if (!lineModeRef.current || offLineRef.current) {
      dueTargetPathRef.current = playedSans
      return
    }
    const queue = lineQueueRef.current
    const switched = queue ? switchToLineThrough(queue, cardKey(fen), runLineIdRef.current, runChapterIdRef.current) : null
    if (switched) {
      dueTargetPathRef.current = [...playedSans, ...switched.rest]
      runLineIdRef.current = switched.line.id
      runChapterIdRef.current = switched.line.chapterId
      setRunChapterId(switched.line.chapterId)
      return
    }
    offLineRef.current = true
    dueTargetPathRef.current = playedSans
    const chapterId =
      answerChapterIds.find((id) => selectedChapterIdsRef.current.has(id)) ?? answerChapterIds[0] ?? runChapterIdRef.current
    runChapterIdRef.current = chapterId
    setRunChapterId(chapterId)
  }, [])

  const submitMove = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      const card = currentCard
      if (!card || phase !== 'drilling' || busy || isViewingHistory || !liveGameState) return

      setBusy(true)
      const reqId = ++moveReqId.current
      setFeedback(null)
      try {
        const piece = boardState?.pieces[from]
        const isPromo =
          piece?.type === 'p' && ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'))
        const promoChar = promotion ?? (isPromo ? 'q' : undefined)
        const { state: gs, san: playedSan } = applyLocalMove(liveGameState, from, to, promoChar)
        if (reqId !== moveReqId.current) return

        const matchAnswer = card.answers.find((a) => a.san === playedSan)
        const matchExcluded = card.excludedAnswers?.find((a) => a.san === playedSan)
        // The move this run's line (or due path) plays here, when it's one of
        // the card's answers. A position can have several repertoire moves,
        // and this one, not the card's primary, is what the run expects.
        const plannedSan = dueTargetPathRef.current?.[runMovesRef.current.length]
        const planned = card.answers.find((a) => a.san === plannedSan)

        if (matchAnswer) {
          if (!gradedThisPresentationRef.current) {
            grade(sessionRef.current!, card.id, true)
            gradedThisPresentationRef.current = true
          }
          // Commit the player's move before waiting for the reply. Without this
          // boundary React can batch both local updates, leaving no painted
          // starting position for the opponent's slide animation.
          flushSync(() => {
            runMovesRef.current.push({ san: playedSan, uci: `${from}${to}${promoChar ?? ''}`, mover: 'user' })
            setRunMoves([...runMovesRef.current])
            setSelected(null)
            pushSnapshot(gs)
            setFeedback({
              kind: (planned ? planned.san === playedSan : matchAnswer.primary) ? 'correct' : 'correct-alt',
              playedSan,
              comment: matchAnswer.comment,
            })
          })
          if (planned && planned.san !== playedSan) followPlayedAnswer(gs.fen, matchAnswer.chapterIds)
          await sleep(150)
          if (reqId !== moveReqId.current) return
          await proceedAfterCorrect(gs)
        } else {
          setRunHadMistake(true)
          if (!gradedThisPresentationRef.current) {
            grade(sessionRef.current!, card.id, false)
            gradedThisPresentationRef.current = true
          }
          const primary = planned ?? card.answers.find((a) => a.primary) ?? card.answers[0]
          setFeedback({
            kind: matchExcluded ? 'excluded' : 'incorrect',
            playedSan,
            expectedSan: primary?.san,
            reason: matchExcluded?.reason,
          })
          setHintUci(primary?.uci ?? null)



          if (reqId !== moveReqId.current) return
          setSelected(null)
          replaceLastSnapshot(localGameState(card.fen))
        }
      } catch (err) {
        if (reqId === moveReqId.current) {
          setFeedback({
            kind: 'error',
            reason: err instanceof Error ? err.message : 'Could not make that move. Please try again.',
          })
        }
      } finally {
        if (reqId === moveReqId.current) setBusy(false)
      }
    },
    [currentCard, phase, busy, boardState, isViewingHistory, liveGameState, proceedAfterCorrect, followPlayedAnswer],
  )



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



  const navBack = useCallback(() => {
    setAnimateLastMove(false)
    setViewIndex((v) => {
      const last = runSnapshotsRef.current.length - 1
      const current = v ?? last
      return Math.max(0, current - 1)
    })
  }, [])

  const navForward = useCallback(() => {
    setAnimateLastMove(false)
    setViewIndex((v) => {
      if (v === null) return null
      const last = runSnapshotsRef.current.length - 1
      const next = v + 1
      return next >= last ? null : next
    })
  }, [])




  const gotoPly = useCallback((index: number) => {
    setAnimateLastMove(false)
    const last = runSnapshotsRef.current.length - 1
    setViewIndex(index >= last ? null : Math.max(0, index))
  }, [])



  const redoLine = useCallback(async () => {
    const startId = runStartCardIdRef.current
    if (!startId) return
    const card = cardById(startId)
    if (!card) return
    setBusy(true)
    try {
      beginRun(card, runChapterIdRef.current, localGameState(card.fen), leadingMovesRef.current)
      setPhase('drilling')
    } finally {
      setBusy(false)
    }
  }, [cardById, beginRun])




  // The "what comes after this line" logic, shared by a normal finish (user
  // already saw line-complete and clicked Next line) and a mid-line skip
  // (see nextLine below, which calls endRun({logAttempt:false}) first).
  const advanceToNextLine = useCallback(async () => {
    if (todayEntryRef.current) {
      // Without a reqId guard here, clicking "Back" (changeRepertoire, which
      // bumps startSessionReqId and nulls todayEntryRef) while this await is
      // in flight didn't stop it: the response would still call
      // startTodayEntry and flip phase back to 'drilling', silently
      // resurrecting the session the user had already navigated away from —
      // not just a stale error banner.
      const reqId = ++startSessionReqId.current
      setBusy(true)
      try {
        const queue = await (todayAdvanceRef.current ?? getTodayTraining())
        todayAdvanceRef.current = null
        if (reqId !== startSessionReqId.current) return
        const next = queue.entries[0]
        if (!next) {
          setLoadError("Today's queue is empty.")
          setPhase('setup')
          return
        }
        await startTodayEntry(next, reqId)
      } catch (err) {
        if (reqId === startSessionReqId.current) {
          setLoadError(err instanceof Error ? err.message : "Couldn't advance today's queue.")
        }
      } finally {
        if (reqId === startSessionReqId.current) setBusy(false)
      }
      return
    }
    const session = sessionRef.current
    if (!session) return
    if (isComplete(session)) {
      setSummary(summarise(session))
      setPhase('summary')
      return
    }
    if (!repertoire) return
    if (!startNextQueuedLine(repertoire)) {
      setSummary(summarise(session))
      setPhase('summary')
      return
    }
    setPhase('drilling')
  }, [repertoire, startNextQueuedLine, startTodayEntry])

  // Exposed to the always-visible "Next line" button. Mid-line (phase still
  // 'drilling') this is a skip: end the current run without logging it as a
  // completed attempt, then advance exactly like a normal finish would.
  const nextLine = useCallback(async () => {
    if (phase === 'drilling') {
      endRun({ logAttempt: false })
    }
    await advanceToNextLine()
  }, [phase, endRun, advanceToNextLine])




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
      router.push(`/?gameId=${gid}`)
    } finally {
      setBusy(false)
    }
  }, [cardById, router])

  const endSession = useCallback(() => {
    const session = sessionRef.current
    if (session) {
      setSummary(summarise(session))
    }
    setPhase('summary')
  }, [])



  const sameAgain = useCallback(() => {
    const args = lastArgsRef.current
    if (!args) return
    setSummary(null)
    startSession(args.repertoireId, args.chapterIds, args.opts)
  }, [startSession])



  const drillMistakes = useCallback(() => {
    const args = lastArgsRef.current
    if (!args) return
    setSummary(null)
    startSession(args.repertoireId, args.chapterIds, { ...args.opts, mode: 'mistakes' })
  }, [startSession])

  const changeRepertoire = useCallback(() => {
    startSessionReqId.current++
    moveReqId.current++
    setLoading(false)
    setBusy(false)
    setSummary(null)
    setRepertoireState(null)
    sessionRef.current = null
    todayEntryRef.current = null
    todayAdvanceRef.current?.catch(() => {})
    todayAdvanceRef.current = null
    setIsTodayTraining(false)
    setFeedback(null)
    setHintUci(null)
    setSelected(null)
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
    animateLastMove,
    flipped,
    toggleFlipped,
    currentCard,
    runStartCard,
    runChapterId,
    feedback,
    hintUci,
    runHadMistake,
    runMoves,
    leadingMoves,
    summary,
    isTodayTraining,
    viewIndex,
    isViewingHistory,
    navBack,
    navForward,
    gotoPly,
    startSession,
    resumeTodayTraining,
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

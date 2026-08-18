'use client'

import { useCallback, useRef, useState } from 'react'
import {
  createGame,
  setPosition as apiSetPosition,
  makeMove,
  getRepertoire,
  getProgress as apiGetProgress,
  saveProgress as apiSaveProgress,
  getTodayTraining,
  saveTodayTraining,
  advanceTodayTraining,
} from '@/lib/api/client'
import type { GameState, TodayTrainingEntry, TodayTrainingResponse } from '@/lib/api/client'
import type { BoardState, Color, PieceType, Square } from '@/lib/chess/types'
import { flatten } from '@/lib/chess/moveTree'
import type { Repertoire, RepCard, RepNode, SessionOptions, SessionState, PersistedCardState } from '@/lib/trainer/types'
import { createSession, pickNext, grade, isComplete, summarise } from '@/lib/trainer/scheduler'
import { newRng, weightedChoice } from '@/lib/trainer/rng'
import { cardKey } from '@/lib/trainer/cardKey'
import { mergeSessionCards } from '@/lib/trainer/persistence'

const WEAKNESS_W = 0.75

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function promotionFromUci(uci: string): string | undefined {
  return uci.length >= 5 ? uci[4] : undefined
}










function findPathInChapterTree(node: RepNode, targetKey: string, path: string[] = []): string[] | null {
  if (cardKey(node.fen) === targetKey) return path
  for (const child of node.children ?? []) {
    const found = findPathInChapterTree(child, targetKey, [...path, child.san])
    if (found) return found
  }
  return null
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








  const [runSnapshots, setRunSnapshots] = useState<GameState[]>([])
  const runSnapshotsRef = useRef<GameState[]>([])


  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)

  const [currentCard, setCurrentCard] = useState<RepCard | null>(null)
  const [runStartCard, setRunStartCard] = useState<RepCard | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [hintUci, setHintUci] = useState<string | null>(null)
  const [runHadMistake, setRunHadMistake] = useState(false)
  const [runMoves, setRunMoves] = useState<RunMove[]>([])







  const [leadingMoves, setLeadingMoves] = useState<RunMove[]>([])

  const [summary, setSummary] = useState<ReturnType<typeof summarise> | null>(null)
  const [isTodayTraining, setIsTodayTraining] = useState(false)

  const gameIdRef = useRef<string | null>(null)
  const sessionRef = useRef<SessionState | null>(null)
  const sessionCardsRef = useRef<RepCard[]>([])
  const selectedChapterIdsRef = useRef<Set<string>>(new Set())
  const runStartCardIdRef = useRef<string | null>(null)
  const runMovesRef = useRef<RunMove[]>([])













  const dueTargetPathRef = useRef<string[] | null>(null)



  const leadingMovesRef = useRef<RunMove[]>([])
  const gradedThisPresentationRef = useRef(false)
  const moveReqId = useRef(0)
  const lastArgsRef = useRef<{ repertoireId: string; chapterIds: string[]; opts: SessionOptions } | null>(null)




  const priorProgressRef = useRef<Record<string, PersistedCardState>>({})
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
    (rep: Repertoire, dueCard: RepCard): { card: RepCard; targetPath: string[]; leadingMoves: RunMove[] } => {
      const chapterId = dueCard.chapterIds.find((id) => selectedChapterIdsRef.current.has(id)) ?? dueCard.chapterIds[0]
      const chapter = rep.chapters.find((c) => c.id === chapterId)
      if (!chapter) return { card: dueCard, targetPath: dueCard.pathSan, leadingMoves: [] }
      const fullPath = findPathInChapterTree(chapter.tree, cardKey(dueCard.fen)) ?? dueCard.pathSan

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

      return { card: startCard ?? dueCard, targetPath: fullPath.slice(leadingMoves.length), leadingMoves }
    },
    [cardById],
  )



  function pushSnapshot(gs: GameState) {
    const next = [...runSnapshotsRef.current, gs]
    runSnapshotsRef.current = next
    setRunSnapshots(next)
    setViewIndex(null)
  }




  function replaceLastSnapshot(gs: GameState) {
    const next = runSnapshotsRef.current.length > 0 ? [...runSnapshotsRef.current] : [gs]
    if (next.length > 0) next[next.length - 1] = gs
    runSnapshotsRef.current = next
    setRunSnapshots(next)
    setViewIndex(null)
  }




  const beginRun = useCallback((card: RepCard, gs: GameState, leading: RunMove[] = []) => {
    runStartCardIdRef.current = card.id
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
  }, [])








  const pickOpponentReply = useCallback(
    (fen: string) => {
      if (!repertoire) return null
      const replies = repertoire.replies[cardKey(fen)]
      if (!replies || replies.length === 0) return null

      const target = dueTargetPathRef.current
      const idx = runMovesRef.current.length
      if (target && idx < target.length) {
        const forced = replies.find((r) => r.san === target[idx])
        if (forced) return forced
      }

      const session = sessionRef.current
      return weightedChoice(
        replies,
        (r) => 1 + WEAKNESS_W * (session?.cards.get(cardKey(r.fen))?.lapses ?? 0),
        Math.random,
      )
    },
    [repertoire],
  )










  const endRun = useCallback(() => {
    const session = sessionRef.current
    if (session && repertoire) {
      const merged = mergeSessionCards(priorProgressRef.current, session)
      priorProgressRef.current = merged

      const startCard = runStartCardIdRef.current ? cardById(runStartCardIdRef.current) : undefined
      const chapterId = startCard?.chapterIds[0]
      const chapter = chapterId ? repertoire.chapters.find((c) => c.id === chapterId) : undefined
      const lineAttempt =
        startCard && chapter
          ? { chapterId: chapter.id, chapterName: chapter.name, cardId: startCard.id, hadMistake: runHadMistake }
          : undefined

      apiSaveProgress(repertoire.id, merged, lineAttempt).catch(() => {

      })
    }

    const todayEntry = todayEntryRef.current
    if (todayEntry) {
      todayAdvanceRef.current = advanceTodayTraining(todayEntry.repertoireId, todayEntry.cardId, runHadMistake)
    }



    setHintUci(null)
    setPhase('line-complete')
  }, [repertoire, cardById, runHadMistake])




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




      setHintUci(null)
      setSelected(null)
    },
    [pickOpponentReply, endRun, cardById],
  )



  const startSession = useCallback(
    async (repertoireId: string, chapterIds: string[], opts: SessionOptions) => {
      setIsTodayTraining(false)
      todayEntryRef.current = null
      todayAdvanceRef.current = null
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







        let saved: Record<string, PersistedCardState> = {}
        try {
          saved = (await apiGetProgress(repertoireId)).cards
        } catch {

        }
        priorProgressRef.current = saved
        const session = createSession(cards, opts, saved, newRng())
        sessionRef.current = session

        const first = pickNext(session)
        if (!first) {
          setLoadError('Nothing to drill in this selection.')
          setLoading(false)
          return
        }
        const dueCard = cards.find((c) => c.id === first.cardId)!
        const { card: firstCard, targetPath, leadingMoves: leading } = resolveRunStartCard(rep, dueCard)
        dueTargetPathRef.current = targetPath
        leadingMovesRef.current = leading

        const gs = await createGame(firstCard.fen)
        gameIdRef.current = gs.id

        beginRun(firstCard, gs, leading)
        setPhase('drilling')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to start session.')
      } finally {
        setLoading(false)
      }
    },
    [beginRun, resolveRunStartCard],
  )

  const startTodayEntry = useCallback(
    async (entry: TodayTrainingEntry) => {
      setLoading(true)
      setLoadError(null)
      try {
        const rep = await getRepertoire(entry.repertoireId)
        const dueCard = rep.cards.find((card) => card.id === entry.cardId)
        if (!dueCard) throw new Error('This line is no longer available in its repertoire.')
        setRepertoireState(rep)
        setFlipped(rep.side === 'b')
        selectedChapterIdsRef.current = new Set(rep.chapters.map((chapter) => chapter.id))
        sessionCardsRef.current = rep.cards
        let saved: Record<string, PersistedCardState> = {}
        try {
          saved = (await apiGetProgress(rep.id)).cards
        } catch {

        }
        priorProgressRef.current = saved
        sessionRef.current = createSession(rep.cards, { sessionLength: null, mode: 'mixed' }, saved, newRng())
        const { card, targetPath, leadingMoves: leading } = resolveRunStartCard(rep, dueCard)
        dueTargetPathRef.current = targetPath
        leadingMovesRef.current = leading
        const gs = await createGame(card.fen)
        gameIdRef.current = gs.id
        todayEntryRef.current = entry
        beginRun(card, gs, leading)
        setPhase('drilling')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Couldn't start today's line.")
        setPhase('setup')
      } finally {
        setLoading(false)
      }
    },
    [beginRun, resolveRunStartCard],
  )

  const startTodayTraining = useCallback(
    async (repertoireIds: string[], linesPerDay: number) => {
      setIsTodayTraining(true)
      setLoading(true)
      setLoadError(null)
      try {
        const queue = await saveTodayTraining({ repertoireIds, linesPerDay })
        const first = queue.entries[0]
        if (!first) throw new Error('No lines are available in the selected repertoires.')
        await startTodayEntry(first)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Couldn't build today's queue.")
        setLoading(false)
      }
    },
    [startTodayEntry],
  )

  const resumeTodayTraining = useCallback(
    async () => {
      setIsTodayTraining(true)
      setLoading(true)
      setLoadError(null)
      try {
        const queue = await getTodayTraining()
        const first = queue.entries[0]
        if (!first) throw new Error("Today's queue is empty.")
        await startTodayEntry(first)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Couldn't resume today's queue.")
        setLoading(false)
      }
    },
    [startTodayEntry],
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
          await sleep(450)
          if (reqId !== moveReqId.current) return






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



          const back = await apiSetPosition(gid, card.fen)
          if (reqId !== moveReqId.current) return
          setSelected(null)
          replaceLastSnapshot(back)
        }
      } catch {

      } finally {
        if (reqId === moveReqId.current) setBusy(false)
      }
    },
    [currentCard, phase, busy, boardState, isViewingHistory, proceedAfterCorrect],
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
    setViewIndex((v) => {
      const last = runSnapshotsRef.current.length - 1
      const current = v ?? last
      return Math.max(0, current - 1)
    })
  }, [])

  const navForward = useCallback(() => {
    setViewIndex((v) => {
      if (v === null) return null
      const last = runSnapshotsRef.current.length - 1
      const next = v + 1
      return next >= last ? null : next
    })
  }, [])




  const gotoPly = useCallback((index: number) => {
    const last = runSnapshotsRef.current.length - 1
    setViewIndex(index >= last ? null : Math.max(0, index))
  }, [])



  const redoLine = useCallback(async () => {
    const gid = gameIdRef.current
    const startId = runStartCardIdRef.current
    if (!gid || !startId) return
    const card = cardById(startId)
    if (!card) return
    setBusy(true)
    try {
      const gs = await apiSetPosition(gid, card.fen)
      beginRun(card, gs, leadingMovesRef.current)
      setPhase('drilling')
    } finally {
      setBusy(false)
    }
  }, [cardById, beginRun])




  const nextLine = useCallback(async () => {
    if (todayEntryRef.current) {
      setBusy(true)
      try {
        const queue = await (todayAdvanceRef.current ?? getTodayTraining())
        todayAdvanceRef.current = null
        const next = queue.entries[0]
        if (!next) {
          setLoadError("Today's queue is empty.")
          setPhase('setup')
          return
        }
        await startTodayEntry(next)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Couldn't advance today's queue.")
      } finally {
        setBusy(false)
      }
      return
    }
    const session = sessionRef.current
    const gid = gameIdRef.current
    if (!session || !gid) return
    if (isComplete(session)) {
      setSummary(summarise(session))
      setPhase('summary')
      return
    }
    const next = pickNext(session)
    if (!next) {
      setSummary(summarise(session))
      setPhase('summary')
      return
    }
    const dueCard = cardById(next.cardId)
    if (!dueCard || !repertoire) return
    const { card, targetPath, leadingMoves: leading } = resolveRunStartCard(repertoire, dueCard)
    dueTargetPathRef.current = targetPath
    leadingMovesRef.current = leading
    setBusy(true)
    try {
      const gs = await apiSetPosition(gid, card.fen)
      beginRun(card, gs, leading)
      setPhase('drilling')
    } finally {
      setBusy(false)
    }
  }, [cardById, beginRun, repertoire, resolveRunStartCard, startTodayEntry])




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
    setSummary(null)
    setRepertoireState(null)
    sessionRef.current = null
    gameIdRef.current = null
    todayEntryRef.current = null
    todayAdvanceRef.current = null
    setIsTodayTraining(false)
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
    leadingMoves,
    summary,
    isTodayTraining,
    viewIndex,
    isViewingHistory,
    navBack,
    navForward,
    gotoPly,
    startSession,
    startTodayTraining,
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

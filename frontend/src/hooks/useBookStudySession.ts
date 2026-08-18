'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createGame, setPosition as apiSetPosition, makeMove, gotoNode, getBook, getBookProgress, markItemDone, analyzeGame, recordBookStudyActivity } from '@/lib/api/client'
import type { Analysis, GameState } from '@/lib/api/client'
import type { BoardState, Color, PieceType, Square } from '@/lib/chess/types'
import { flatten } from '@/lib/chess/moveTree'
import type { Book, BookItem } from '@/lib/books/types'




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

export type BookStudyPhase = 'setup' | 'studying' | 'done'

export interface FlatItem {
  item: BookItem
  chapterId: string
  chapterName: string
  chapterNumber: number
}













export function useBookStudySession() {
  const [phase, setPhase] = useState<BookStudyPhase>('setup')
  const [book, setBook] = useState<Book | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [flatIndex, setFlatIndex] = useState(0)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)

  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [analysisEnabled, setAnalysisEnabled] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [completedItemIds, setCompletedItemIds] = useState<Set<string>>(() => new Set())
  const [bookmarkedItemIds, setBookmarkedItemIds] = useState<Set<string>>(() => new Set())
  const [completionBusy, setCompletionBusy] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  const gameIdRef = useRef<string | null>(null)
  const moveReqId = useRef(0)
  const analysisReqId = useRef(0)

  const flatItems = useMemo<FlatItem[]>(() => {
    if (!book) return []
    const out: FlatItem[] = []
    for (const ch of book.chapters) {
      for (const item of ch.items) {
        out.push({ item, chapterId: ch.id, chapterName: ch.name, chapterNumber: ch.number })
      }
    }
    return out
  }, [book])

  const current = flatItems[flatIndex] ?? null
  const boardState: BoardState | null = gameState ? toBoardState(gameState, selected) : null
  const analysisNodeID = gameState?.currentNodeId

  useEffect(() => {
    const gid = gameIdRef.current
    if (!analysisEnabled || !gid || !analysisNodeID) return
    const requestID = ++analysisReqId.current
    setAnalysisLoading(true)
    setAnalysisError(null)
    analyzeGame(gid)
      .then((result) => {
        if (requestID === analysisReqId.current) setAnalysis(result)
      })
      .catch((err: unknown) => {
        if (requestID === analysisReqId.current) {
          setAnalysis(null)
          setAnalysisError(err instanceof Error ? err.message : 'Analysis is unavailable.')
        }
      })
      .finally(() => {
        if (requestID === analysisReqId.current) setAnalysisLoading(false)
      })
  }, [analysisEnabled, analysisNodeID])

  const currentTreeInfo = useMemo(() => {
    if (!gameState) return { ply: 0, canBack: false, canForward: false }
    const flat = flatten(gameState.moveTree)
    const entry = flat.get(gameState.currentNodeId)
    const canForward = !!entry?.node.children && entry.node.children.length > 0
    const canBack = entry?.parentId != null
    return { ply: entry?.node.ply ?? 0, canBack, canForward }
  }, [gameState])



  const enterItem = useCallback(async (gid: string, item: BookItem) => {
    setSelected(null)
    setFlipped(item.sideToMove === 'b')
    const gs = await apiSetPosition(gid, item.fen)
    setGameState(gs)
  }, [])

  const loadStart = useCallback(
    async (bookId: string, chapterId?: string) => {
      setLoading(true)
      setLoadError(null)
      try {
        const [b, progress] = await Promise.all([
          getBook(bookId),
          getBookProgress(bookId).catch(() => ({ done: [] })),
        ])
        setBook(b)
        setCompletedItemIds(new Set(progress.done))
        try {
          setBookmarkedItemIds(new Set(JSON.parse(localStorage.getItem(`chesslab.book-bookmarks.${bookId}`) ?? '[]')))
        } catch {
          setBookmarkedItemIds(new Set())
        }
        const items = b.chapters.flatMap((c) => c.items)
        if (items.length === 0) {
          setLoadError('This book has no study items yet.')
          setLoading(false)
          return
        }
        const chapter = chapterId ? b.chapters.find((c) => c.id === chapterId) : undefined
        const startItem = chapter && chapter.items.length > 0 ? chapter.items[0] : items[0]
        const startIndex = Math.max(0, items.findIndex((it) => it.id === startItem.id))
        setFlatIndex(startIndex)

        const gs = await createGame(startItem.fen)
        gameIdRef.current = gs.id
        await enterItem(gs.id, startItem)

        setPhase('studying')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load book.')
      } finally {
        setLoading(false)
      }
    },
    [enterItem],
  )

  const goToIndex = useCallback(
    async (index: number) => {
      const gid = gameIdRef.current
      const target = flatItems[index]
      if (!gid || !target) return
      setBusy(true)
      try {
        await enterItem(gid, target.item)
        setFlatIndex(index)
      } finally {
        setBusy(false)
      }
    },
    [flatItems, enterItem],
  )

  const nextItem = useCallback(() => {
    if (flatIndex + 1 >= flatItems.length) {
      setPhase('done')
      return
    }
    goToIndex(flatIndex + 1)
  }, [flatIndex, flatItems, goToIndex])

  const prevItem = useCallback(() => {
    if (flatIndex <= 0) return
    goToIndex(flatIndex - 1)
  }, [flatIndex, goToIndex])

  const stepBack = useCallback(async () => {
    const gid = gameIdRef.current
    if (!gid || !gameState || busy) return
    const parentId = flatten(gameState.moveTree).get(gameState.currentNodeId)?.parentId
    if (parentId == null) return
    setBusy(true)
    try {
      const gs = await gotoNode(gid, parentId)
      setGameState(gs)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }, [gameState, busy])

  const stepForward = useCallback(async () => {
    const gid = gameIdRef.current
    if (!gid || !gameState || busy) return
    const entry = flatten(gameState.moveTree).get(gameState.currentNodeId)
    const child = entry?.node.children?.[0]
    if (!child) return
    setBusy(true)
    try {
      const gs = await gotoNode(gid, child.id)
      setGameState(gs)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }, [gameState, busy])

  const goToMove = useCallback(async (nodeId: string) => {
    const gid = gameIdRef.current
    if (!gid || !gameState || busy) return
    setBusy(true)
    try {
      const gs = await gotoNode(gid, nodeId)
      setGameState(gs)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }, [gameState, busy])



  const attemptMove = useCallback(
    async (from: Square, to: Square) => {
      const gid = gameIdRef.current
      if (!gid || phase !== 'studying' || busy) return

      const activity = book && current
        ? { bookId: book.id, chapterId: current.chapterId, itemId: current.item.id }
        : null

      setBusy(true)
      const reqId = ++moveReqId.current
      try {
        const piece = boardState?.pieces[from]
        const isPromo =
          piece?.type === 'p' && ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'))
        const gs = await makeMove(gid, from, to, isPromo ? 'q' : undefined)
        if (reqId !== moveReqId.current) return
        setGameState(gs)
        setSelected(null)

        if (activity) {
          void recordBookStudyActivity(activity.bookId, activity.chapterId, activity.itemId).catch(() => undefined)
        }

      } catch {

      } finally {
        if (reqId === moveReqId.current) setBusy(false)
      }
    },
    [phase, busy, boardState, book, current],
  )

  const selectSquare = useCallback(
    (square: Square) => {
      if (!boardState || busy) return
      if (selected === square) {
        setSelected(null)
        return
      }
      if (selected) {
        const legal = boardState.legalMoves.includes(square)
        if (legal) {
          attemptMove(selected, square)
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
    [boardState, selected, busy, attemptMove],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] => {
      if (!gameState) return []
      return gameState.legalMoves.filter((m) => m.from === square).map((m) => m.to)
    },
    [gameState],
  )

  const toggleFlipped = useCallback(() => setFlipped((f) => !f), [])
  const toggleAnalysis = useCallback(() => {
    setAnalysisEnabled((enabled) => !enabled)
  }, [])




  const markCurrentComplete = useCallback(async () => {
    if (!book || !current || completionBusy || completedItemIds.has(current.item.id)) return
    setCompletionBusy(true)
    setCompletionError(null)
    try {
      await markItemDone(book.id, current.item.id)
      setCompletedItemIds((previous) => new Set(previous).add(current.item.id))
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : 'Could not save completion.')
    } finally {
      setCompletionBusy(false)
    }
  }, [book, current, completionBusy, completedItemIds])

  const toggleCurrentBookmark = useCallback(() => {
    if (!book || !current) return
    setBookmarkedItemIds((previous) => {
      const next = new Set(previous)
      if (next.has(current.item.id)) next.delete(current.item.id)
      else next.add(current.item.id)
      localStorage.setItem(`chesslab.book-bookmarks.${book.id}`, JSON.stringify([...next]))
      return next
    })
  }, [book, current])

  const restart = useCallback(() => {
    setPhase('setup')
    setBook(null)
    gameIdRef.current = null
    setGameState(null)
    setFlatIndex(0)
    setAnalysisEnabled(false)
    setAnalysis(null)
    setAnalysisError(null)
    setCompletedItemIds(new Set())
    setBookmarkedItemIds(new Set())
    setCompletionError(null)
  }, [])

  return {
    phase,
    book,
    loadError,
    loading,
    flatItems,
    flatIndex,
    current,
    boardState,
    busy,
    flipped,
    toggleFlipped,
    analysisEnabled,
    analysis,
    analysisLoading,
    analysisError,
    toggleAnalysis,
    completedItemIds,
    bookmarkedItemIds,
    completionBusy,
    completionError,
    markCurrentComplete,
    toggleCurrentBookmark,
    currentPly: currentTreeInfo.ply,
    canStepBack: currentTreeInfo.canBack,
    canStepForward: currentTreeInfo.canForward,
    stepBack,
    stepForward,
    loadStart,
    nextItem,
    prevItem,
    goToIndex,
    goToMove,
    selectSquare,
    move: attemptMove,
    legalMovesFor,
    restart,
  }
}

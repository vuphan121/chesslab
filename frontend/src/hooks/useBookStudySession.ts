'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createGame, setPosition as apiSetPosition, makeMove, gotoNode, deleteGameNode, getBook, getBookProgress, markItemDone, analyzeGame, evalFen, recordBookStudyActivity, getBookSavedLine, saveBookLine } from '@/lib/api/client'
import type { Analysis, GameState, FenEval, SavedLine, SavedLineMove } from '@/lib/api/client'
import type { BoardState, Color, MoveNode, PieceType, Square } from '@/lib/chess/types'
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

// Walk the tree's main line (children[0] chain), skipping the root.
function mainlineNodes(root: MoveNode): MoveNode[] {
  const out: MoveNode[] = []
  let node: MoveNode | undefined = root
  while (node) {
    const next: MoveNode | undefined = (node.children ?? [])[0]
    if (!next) break
    out.push(next)
    node = next
  }
  return out
}

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
  const [moveEvals, setMoveEvals] = useState<Record<string, FenEval>>({})
  const [savedLine, setSavedLine] = useState<SavedLine | null>(null)
  const [savingLine, setSavingLine] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [completedItemIds, setCompletedItemIds] = useState<Set<string>>(() => new Set())
  const [bookmarkedItemIds, setBookmarkedItemIds] = useState<Set<string>>(() => new Set())
  const [completionBusy, setCompletionBusy] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)

  const gameIdRef = useRef<string | null>(null)
  const moveReqId = useRef(0)
  const analysisReqId = useRef(0)
  const moveEvalsRef = useRef<Record<string, FenEval>>({})
  // Per-FEN analysis cache so revisiting a position (stepping back/forward, or
  // loading a saved line) is instant instead of another engine round-trip.
  const analysisCacheRef = useRef<Map<string, Analysis>>(new Map())

  // Mirror moveEvals into a ref so the fetch effects/callbacks below can read the
  // latest map without taking it as a dependency (which would re-run them per fetch).
  useEffect(() => {
    moveEvalsRef.current = moveEvals
  }, [moveEvals])

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
  const currentFen = gameState?.fen ?? null

  // Engine analysis for the current position. Deliberately quick-only (depth-10 /
  // cloud with a short timeout) — the deeper refinement pass this used to chain
  // was the "couple seconds" lag on the board. Cache hits are instant.
  useEffect(() => {
    const gid = gameIdRef.current
    if (!analysisEnabled || !gid || !currentFen) return

    const cached = analysisCacheRef.current.get(currentFen)
    if (cached) {
      setAnalysis(cached)
      setAnalysisLoading(false)
      setAnalysisError(null)
      return
    }

    const requestID = ++analysisReqId.current
    setAnalysisLoading(true)
    setAnalysisError(null)
    ;(async () => {
      try {
        const result = await analyzeGame(gid, 'quick')
        analysisCacheRef.current.set(currentFen, result)
        if (result.lines.length > 0 && !(currentFen in moveEvalsRef.current)) {
          const top = result.lines[0]
          setMoveEvals((prev) => ({ ...prev, [currentFen]: { score: top.score, mate: top.mate, depth: top.depth } }))
        }
        if (requestID === analysisReqId.current) setAnalysis(result)
      } catch (err: unknown) {
        if (requestID === analysisReqId.current) {
          setAnalysis(null)
          setAnalysisError(err instanceof Error ? err.message : 'Analysis is unavailable.')
        }
      } finally {
        if (requestID === analysisReqId.current) setAnalysisLoading(false)
      }
    })()
  }, [analysisEnabled, currentFen])

  // With Analysis on, fill in a light per-move eval for every move on the board's
  // main line, so the move list can show "analysis of the moves" and a saved line
  // can carry it. Gated on analysisEnabled — same opt-in as the eval bar — so a
  // user who never opens analysis gets no extra engine traffic.
  useEffect(() => {
    if (!analysisEnabled || !gameState) return
    const fens = mainlineNodes(gameState.moveTree).map((n) => n.fen)
    const missing = fens.filter((f) => !(f in moveEvalsRef.current))
    if (missing.length === 0) return

    let cancelled = false
    ;(async () => {
      for (const fen of missing) {
        if (cancelled) return
        try {
          const e = await evalFen(fen)
          if (!cancelled) setMoveEvals((prev) => ({ ...prev, [fen]: e }))
        } catch {
          /* leave this move without an eval */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [analysisEnabled, gameState])

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
    analysisCacheRef.current = new Map()
    setMoveEvals({})
    setAnalysis(null)
    setAnalysisError(null)
    setSaveNote(null)
    const gs = await apiSetPosition(gid, item.fen)
    setGameState(gs)
  }, [])

  // Rebuild a saved line into the game's move tree, then sit the cursor back at
  // the start position — the full line shows in the Moves panel, but the board
  // stays on move 0 until the user steps forward (arrows) or clicks a move.
  const replayLine = useCallback(async (line: SavedLine): Promise<GameState | null> => {
    const gid = gameIdRef.current
    if (!gid) return null
    let gs = await apiSetPosition(gid, line.startFen)
    for (const m of line.moves) {
      if (m.uci.length < 4) continue
      gs = await makeMove(gid, m.uci.slice(0, 2), m.uci.slice(2, 4), m.uci.slice(4) || undefined)
    }
    return gotoNode(gid, gs.moveTree.id)
  }, [])

  // One saved line per item. On entering an item, pull it and drop it straight
  // onto the board — no click, no list — so the Moves panel just shows it.
  useEffect(() => {
    const bookId = book?.id
    const itemId = current?.item.id
    if (!bookId || !itemId) return
    let cancelled = false
    getBookSavedLine(bookId, itemId)
      .then(async ({ line }) => {
        if (cancelled) return
        setSavedLine(line)
        if (!line) return
        setBusy(true)
        try {
          const gs = await replayLine(line)
          if (!cancelled && gs) {
            setGameState(gs)
            setSelected(null)
          }
        } catch {
          /* a saved move no longer applies — leave the plain position */
        } finally {
          if (!cancelled) setBusy(false)
        }
      })
      .catch(() => {
        // not logged in / no database / offline — just treat it as no saved line
        if (!cancelled) setSavedLine(null)
      })
    return () => {
      cancelled = true
    }
  }, [book?.id, current?.item.id, replayLine])

  const restoreSavedLine = useCallback(async () => {
    if (!savedLine || busy) return
    setBusy(true)
    setSaveNote(null)
    try {
      const gs = await replayLine(savedLine)
      if (gs) {
        setGameState(gs)
        setSelected(null)
      }
    } catch {
      /* ignore — saved line no longer replays cleanly */
    } finally {
      setBusy(false)
    }
  }, [savedLine, busy, replayLine])

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

  const deleteMove = useCallback(async (nodeId: string) => {
    const gid = gameIdRef.current
    if (!gid || !gameState || busy || nodeId === gameState.moveTree.id) return
    setBusy(true)
    try {
      const gs = await deleteGameNode(gid, nodeId)
      setGameState(gs)
      setSelected(null)
      setSaveNote(null)
    } finally {
      setBusy(false)
    }
  }, [gameState, busy])

  const saveCurrentLine = useCallback(async () => {
    const bookId = book?.id
    const itemId = current?.item.id
    if (!bookId || !itemId || !gameState || savingLine) return
    const nodes = mainlineNodes(gameState.moveTree)
    if (nodes.length === 0) {
      setSaveNote('Play some moves first.')
      return
    }
    const moves: SavedLineMove[] = nodes.map((n) => {
      const e = moveEvalsRef.current[n.fen]
      return {
        san: n.san,
        uci: (n.from ?? '') + (n.to ?? '') + (n.promotion ?? ''),
        fen: n.fen,
        score: e?.score ?? 0,
        mate: e?.mate ?? 0,
        hasEval: e != null,
      }
    })
    setSavingLine(true)
    setSaveNote(null)
    try {
      // One row per (user, book, item): the backend upserts, so this replaces
      // whatever was saved for this lesson before.
      const { line } = await saveBookLine(bookId, itemId, current.item.fen, moves)
      setSavedLine(line)
      setSaveNote('Saved')
    } catch (err) {
      setSaveNote(err instanceof Error ? err.message : 'Could not save line.')
    } finally {
      setSavingLine(false)
    }
  }, [book, current, gameState, savingLine])



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
    setMoveEvals({})
    setSavedLine(null)
    setSaveNote(null)
    analysisCacheRef.current = new Map()
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
    moveEvals,
    savedLine,
    savingLine,
    saveNote,
    deleteMove,
    saveCurrentLine,
    restoreSavedLine,
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

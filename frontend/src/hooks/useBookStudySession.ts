'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBook, getBookProgress, markItemDone, recordBookStudyActivity, getBookSavedLine, saveBookLine } from '@/lib/api/client'
import type { Analysis, GameState, FenEval, SavedLine, SavedLineMove } from '@/lib/api/client'
import type { BoardState, Color, PieceType, Square } from '@/lib/chess/types'
import { activeLine, flatten } from '@/lib/chess/moveTree'
import { LocalGame } from '@/lib/chess/localGame'
import { acquireEngine, releaseEngine } from '@/lib/engine/browserEngine'
import { MoveEvaluator } from '@/lib/engine/moveEval'
import { lookupAnalysis, lookupEval } from '@/lib/lichess/lookup'
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
  const [bookGame] = useState(() => new LocalGame())
  const [phase, setPhase] = useState<BookStudyPhase>('setup')
  const [book, setBook] = useState<Book | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [flatIndex, setFlatIndex] = useState(0)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [gameReadyVersion, setGameReadyVersion] = useState(0)
  const [selected, setSelected] = useState<Square | null>(null)

  const [busy, setBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [analysisEnabled, setAnalysisEnabled] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisFen, setAnalysisFen] = useState<string | null>(null)
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
  const itemReqId = useRef(0)
  const boardRevisionRef = useRef(0)
  const moveEvalsRef = useRef<Record<string, FenEval>>({})
  const analysisCacheRef = useRef<Map<string, Analysis>>(new Map())
  const analysisLoadingRef = useRef(false)

  const createGame = useCallback(async (fen: string): Promise<GameState> => {
    bookGame.resetTo(fen)
    return bookGame.snapshot()
  }, [bookGame])

  const apiSetPosition = useCallback(async (_gid: string, fen: string): Promise<GameState> => {
    bookGame.resetTo(fen)
    return bookGame.snapshot()
  }, [bookGame])

  const makeMove = useCallback(async (_gid: string, from: string, to: string, promotion?: string): Promise<GameState> => {
    if (!bookGame.applyMove(from, to, promotion)) throw new Error(`illegal move: ${from}→${to}`)
    return bookGame.snapshot()
  }, [bookGame])

  const gotoNode = useCallback(async (_gid: string, nodeId: string): Promise<GameState> => {
    if (!bookGame.gotoNode(nodeId)) throw new Error(`node not found: ${nodeId}`)
    return bookGame.snapshot()
  }, [bookGame])

  const deleteGameNode = useCallback(async (_gid: string, nodeId: string): Promise<GameState> => {
    if (!bookGame.deleteNode(nodeId)) throw new Error('could not delete that move')
    return bookGame.snapshot()
  }, [bookGame])

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

  useEffect(() => {
    if (!analysisEnabled || !currentFen) return

    const cached = analysisCacheRef.current.get(currentFen)
    if (cached) {
      setAnalysis(cached)
      setAnalysisFen(currentFen)
      analysisLoadingRef.current = false
      setAnalysisLoading(false)
      setAnalysisError(null)
      return
    }

    const fen = currentFen
    const requestID = ++analysisReqId.current
    let cancelled = false
    const isCurrent = () => !cancelled && requestID === analysisReqId.current
    analysisLoadingRef.current = true
    setAnalysisLoading(true)
    setAnalysisError(null)
    const engine = acquireEngine()
    let job: { cancel: () => void } | null = null
    const lookup = new AbortController()
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    const record = (result: Analysis) => {
      analysisCacheRef.current.set(fen, result)
      if (result.lines.length > 0 && !(fen in moveEvalsRef.current)) {
        const top = result.lines[0]
        setMoveEvals((prev) => ({ ...prev, [fen]: { score: top.score, mate: top.mate, depth: top.depth } }))
      }
    }
    ;(async () => {
      try {
        const found = await Promise.race([
          lookupAnalysis(fen, 3, lookup.signal).catch(() => null),
          new Promise<null>((resolve) => {
            fallbackTimer = setTimeout(() => resolve(null), 500)
          }),
        ])
        if (fallbackTimer) clearTimeout(fallbackTimer)
        if (!isCurrent()) return
        if (found) {
          record(found)
          setAnalysis(found)
          setAnalysisFen(fen)
          setAnalysisLoading(false)
          analysisLoadingRef.current = false
          return
        }
        const started = engine.start({
          fen,
          lines: 3,
          hashMb: 16,
          limit: 'depth',
          depth: 14,
          timeSec: 0,
          onUpdate: (partial) => {
            if (isCurrent()) {
              setAnalysis(partial)
              setAnalysisFen(fen)
            }
          },
        })
        job = started
        const result = await started.done
        if (!isCurrent()) return
        if (result.error) throw new Error(result.error)
        if (result.analysis && result.completed) {
          record(result.analysis)
          setAnalysis(result.analysis)
          setAnalysisFen(fen)
        }
      } catch (err: unknown) {
        if (isCurrent()) {
          setAnalysis(null)
          setAnalysisFen(null)
          setAnalysisError(err instanceof Error ? err.message : 'Analysis is unavailable.')
        }
      } finally {
        if (isCurrent()) {
          analysisLoadingRef.current = false
          setAnalysisLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      analysisLoadingRef.current = false
      lookup.abort()
      if (fallbackTimer) clearTimeout(fallbackTimer)
      job?.cancel()
      releaseEngine()
    }
  }, [analysisEnabled, currentFen])

  const evaluatorRef = useRef<MoveEvaluator | null>(null)
  useEffect(() => {
    return () => {
      evaluatorRef.current?.dispose()
      evaluatorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!analysisEnabled || !gameState) return
    const fens = activeLine(gameState.moveTree, gameState.currentNodeId).map((n) => n.fen)
    const missing = fens.filter((f) => !(f in moveEvalsRef.current))
    if (missing.length === 0) return

    let cancelled = false
    ;(async () => {
      for (const fen of missing) {
        if (cancelled) return
        try {
          let e = await lookupEval(fen)
          if (!e && !cancelled) {
            while (analysisLoadingRef.current && !cancelled) {
              await new Promise((resolve) => setTimeout(resolve, 200))
            }
            if (cancelled) return
            const evaluator = (evaluatorRef.current ??= new MoveEvaluator())
            e = await evaluator.evaluate(fen)
          }
          if (!cancelled && e) {
            const found = e
            setMoveEvals((prev) => ({ ...prev, [fen]: found }))
          }
        } catch {
        }
      }
    })()
    return () => {
      cancelled = true
      evaluatorRef.current?.cancel()
    }
  }, [analysisEnabled, gameState])

  const currentTreeInfo = useMemo(() => {
    if (!gameState) return { ply: 0, canBack: false, canForward: false }
    const flat = flatten(gameState.moveTree)
    const entry = flat.get(gameState.currentNodeId)
    const canForward = !!entry?.node.children && entry.node.children.length > 0
    const canBack = entry?.parentId != null
    return { ply: (entry?.node.ply ?? 0) - gameState.moveTree.ply, canBack, canForward }
  }, [gameState])

  const enterItem = useCallback(async (gid: string, item: BookItem): Promise<boolean> => {
    const reqId = ++itemReqId.current
    moveReqId.current++
    setSelected(null)
    setMoveError(null)
    setFlipped(item.sideToMove === 'b')
    boardRevisionRef.current++
    analysisCacheRef.current = new Map()
    setMoveEvals({})
    setAnalysis(null)
    setAnalysisFen(null)
    setAnalysisError(null)
    setSavedLine(null)
    setSaveNote(null)
    const gs = await apiSetPosition(gid, item.fen)
    if (reqId !== itemReqId.current) return false
    setGameState(gs)
    return true
  }, [apiSetPosition])

  const replayLine = useCallback(async (line: SavedLine, expectedItemRequest = itemReqId.current): Promise<GameState | null> => {
    const gid = gameIdRef.current
    if (!gid || expectedItemRequest !== itemReqId.current) return null
    let gs = await apiSetPosition(gid, line.startFen)
    if (expectedItemRequest !== itemReqId.current) return null
    for (const m of line.moves) {
      if (m.uci.length < 4) continue
      gs = await makeMove(gid, m.uci.slice(0, 2), m.uci.slice(2, 4), m.uci.slice(4) || undefined)
      if (expectedItemRequest !== itemReqId.current) return null
    }
    const reset = await gotoNode(gid, gs.moveTree.id)
    return expectedItemRequest === itemReqId.current ? reset : null
  }, [apiSetPosition, gotoNode, makeMove])

  useEffect(() => {
    const bookId = book?.id
    const itemId = current?.item.id
    if (!bookId || !itemId || !gameIdRef.current) return
    const expectedItemRequest = itemReqId.current
    const expectedBoardRevision = boardRevisionRef.current
    let cancelled = false
    getBookSavedLine(bookId, itemId)
      .then(async ({ line }) => {
        if (cancelled || expectedItemRequest !== itemReqId.current) return
        setSavedLine(line)
        if (!line) return
        if (expectedBoardRevision !== boardRevisionRef.current) return
        setBusy(true)
        try {
          const gs = await replayLine(line, expectedItemRequest)
          if (!cancelled && expectedItemRequest === itemReqId.current && gs) {
            setGameState(gs)
            setSelected(null)
          }
        } catch {
        } finally {
          if (!cancelled && expectedItemRequest === itemReqId.current) setBusy(false)
        }
      })
      .catch(() => {
        if (!cancelled) setSavedLine(null)
      })
    return () => {
      cancelled = true
    }
  }, [book?.id, current?.item.id, gameReadyVersion, replayLine])

  const restoreSavedLine = useCallback(async () => {
    if (!savedLine || busy) return
    boardRevisionRef.current++
    setBusy(true)
    setSaveNote(null)
    try {
      const gs = await replayLine(savedLine)
      if (gs) {
        setGameState(gs)
        setSelected(null)
      }
    } catch {
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
        setGameReadyVersion((version) => version + 1)

        setPhase('studying')
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load book.')
      } finally {
        setLoading(false)
      }
    },
    [createGame, enterItem],
  )

  const goToIndex = useCallback(
    async (index: number) => {
      const gid = gameIdRef.current
      const target = flatItems[index]
      if (!gid || !target) return
      setBusy(true)
      try {
        const applied = await enterItem(gid, target.item)
        if (applied) setFlatIndex(index)
      } catch (error) {
        setMoveError(error instanceof Error ? error.message : 'Could not open that item. Please try again.')
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
    const expectedItemRequest = itemReqId.current
    boardRevisionRef.current++
    setBusy(true)
    try {
      const gs = await gotoNode(gid, parentId)
      if (expectedItemRequest !== itemReqId.current) return
      setGameState(gs)
      setSelected(null)
      setMoveError(null)
    } catch (error) {
      if (expectedItemRequest === itemReqId.current) {
        setMoveError(error instanceof Error ? error.message : 'Could not go back. Please try again.')
      }
    } finally {
      if (expectedItemRequest === itemReqId.current) setBusy(false)
    }
  }, [gameState, busy, gotoNode])

  const stepForward = useCallback(async () => {
    const gid = gameIdRef.current
    if (!gid || !gameState || busy) return
    const entry = flatten(gameState.moveTree).get(gameState.currentNodeId)
    const child = entry?.node.children?.[0]
    if (!child) return
    const expectedItemRequest = itemReqId.current
    boardRevisionRef.current++
    setBusy(true)
    try {
      const gs = await gotoNode(gid, child.id)
      if (expectedItemRequest !== itemReqId.current) return
      setGameState(gs)
      setSelected(null)
      setMoveError(null)
    } catch (error) {
      if (expectedItemRequest === itemReqId.current) {
        setMoveError(error instanceof Error ? error.message : 'Could not go forward. Please try again.')
      }
    } finally {
      if (expectedItemRequest === itemReqId.current) setBusy(false)
    }
  }, [gameState, busy, gotoNode])

  const goToMove = useCallback(async (nodeId: string) => {
    const gid = gameIdRef.current
    if (!gid || !gameState || busy) return
    const expectedItemRequest = itemReqId.current
    boardRevisionRef.current++
    setBusy(true)
    try {
      const gs = await gotoNode(gid, nodeId)
      if (expectedItemRequest !== itemReqId.current) return
      setGameState(gs)
      setSelected(null)
      setMoveError(null)
    } catch (error) {
      if (expectedItemRequest === itemReqId.current) {
        setMoveError(error instanceof Error ? error.message : 'Could not open that move. Please try again.')
      }
    } finally {
      if (expectedItemRequest === itemReqId.current) setBusy(false)
    }
  }, [gameState, busy, gotoNode])

  const deleteMove = useCallback(async (nodeId: string) => {
    const gid = gameIdRef.current
    if (!gid || !gameState || busy || nodeId === gameState.moveTree.id) return
    const expectedItemRequest = itemReqId.current
    boardRevisionRef.current++
    setBusy(true)
    try {
      const gs = await deleteGameNode(gid, nodeId)
      if (expectedItemRequest !== itemReqId.current) return
      setGameState(gs)
      setSelected(null)
      setSaveNote(null)
      setMoveError(null)
    } catch (error) {
      if (expectedItemRequest === itemReqId.current) {
        setMoveError(error instanceof Error ? error.message : 'Could not delete that move. Please try again.')
      }
    } finally {
      if (expectedItemRequest === itemReqId.current) setBusy(false)
    }
  }, [gameState, busy, deleteGameNode])

  const saveCurrentLine = useCallback(async () => {
    const bookId = book?.id
    const itemId = current?.item.id
    if (!bookId || !itemId || !gameState || savingLine) return
    const expectedItemRequest = itemReqId.current
    const nodes = activeLine(gameState.moveTree, gameState.currentNodeId)
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
      const { line } = await saveBookLine(bookId, itemId, current.item.fen, moves)
      if (expectedItemRequest !== itemReqId.current) return
      setSavedLine(line)
      setSaveNote('Saved')
    } catch (err) {
      if (expectedItemRequest === itemReqId.current) {
        setSaveNote(err instanceof Error ? err.message : 'Could not save line.')
      }
    } finally {
      setSavingLine(false)
    }
  }, [book, current, gameState, savingLine])

  const attemptMove = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      const gid = gameIdRef.current
      if (!gid || phase !== 'studying' || busy) return

      const activity = book && current
        ? { bookId: book.id, chapterId: current.chapterId, itemId: current.item.id }
        : null

      setBusy(true)
      setMoveError(null)
      const reqId = ++moveReqId.current
      boardRevisionRef.current++
      try {
        const piece = boardState?.pieces[from]
        const isPromo =
          piece?.type === 'p' && ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'))
        const gs = await makeMove(gid, from, to, promotion ?? (isPromo ? 'q' : undefined))
        if (reqId !== moveReqId.current) return
        setGameState(gs)
        setSelected(null)

        if (activity) {
          void recordBookStudyActivity(activity.bookId, activity.chapterId, activity.itemId).catch(() => undefined)
        }

      } catch (error) {
        if (reqId === moveReqId.current) {
          setMoveError(error instanceof Error ? error.message : 'Could not make that move. Please try again.')
        }
      } finally {
        if (reqId === moveReqId.current) setBusy(false)
      }
    },
    [phase, busy, boardState, book, current, makeMove],
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
    const next = new Set(bookmarkedItemIds)
    if (next.has(current.item.id)) next.delete(current.item.id)
    else next.add(current.item.id)
    try {
      localStorage.setItem(`chesslab.book-bookmarks.${book.id}`, JSON.stringify([...next]))
    } catch {}
    setBookmarkedItemIds(next)
  }, [book, current, bookmarkedItemIds])

  const restart = useCallback(() => {
    moveReqId.current++
    analysisReqId.current++
    itemReqId.current++
    setPhase('setup')
    setBook(null)
    gameIdRef.current = null
    setGameReadyVersion(0)
    setGameState(null)
    setBusy(false)
    setMoveError(null)
    setFlatIndex(0)
    setAnalysisEnabled(false)
    setAnalysis(null)
    setAnalysisFen(null)
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
    moveError,
    flipped,
    toggleFlipped,
    analysisEnabled,
    analysis: analysisFen === currentFen ? analysis : null,
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

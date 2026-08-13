'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  createGame,
  setPosition as apiSetPosition,
  makeMove,
  gotoNode,
  getBook,
  getBookProgress,
  markItemDone as apiMarkItemDone,
} from '@/lib/api/client'
import type { GameState } from '@/lib/api/client'
import type { BoardState, Color, PieceType, Square } from '@/lib/chess/types'
import { flatten } from '@/lib/chess/moveTree'
import type { Book, BookItem } from '@/lib/books/types'

function promotionFromUci(uci: string): string | undefined {
  return uci.length >= 5 ? uci[4] : undefined
}

// Duplicated from useTrainerSession/useChessGame — same GameState -> BoardState
// shape, kept as its own small copy rather than a shared import (see frontend
// CLAUDE.md: each hook already keeps its own copy of this).
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

export interface BookFeedback {
  kind: 'solved'
}

// useBookStudySession is a hand-rolled state machine, deliberately not built
// on useChessGame — same reasoning as useTrainerSession: no engine/eval/
// explorer/coach calls, since those would leak a puzzle's answer.
//
// Both lesson and puzzle items are, underneath, just the one backend game
// object's own move tree — no separate client-side snapshot array. This
// works because the backend tree already supports exactly what both need:
//   - Lessons: idle (board shown, not interactive) until `startLesson()`
//     replays the book's line for real via sequential makeMove calls, then
//     the tree is stepped through read-only via stepBack/stepForward
//     (gotoNode against parent / children[0] — the line never branches).
//   - Puzzles: interactive from the start. Any legal move is accepted (no
//     rejection/undo); playing a different move from an earlier point in
//     the tree naturally creates a sideline, same semantics the Analysis
//     Board already relies on. stepBack/stepForward navigate this tree too.
//     After every move, the SAN path from root to the current node is
//     compared against the item's recorded solution (exact match, not a
//     prefix game) to silently detect a correct solve.
// Ephemeral by construction: `enterItem`/`goToIndex` re-point the game at a
// fresh `apiSetPosition` (discarding whatever tree was there), and a new
// session (`loadStart`) creates a brand-new game — so a puzzle's played-out
// tree never survives navigating away or reloading. The one thing that does
// survive is `completedItems`, synced to the server (see markDone below).
export function useBookStudySession() {
  const [phase, setPhase] = useState<BookStudyPhase>('setup')
  const [book, setBook] = useState<Book | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [flatIndex, setFlatIndex] = useState(0)
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [lessonStarted, setLessonStarted] = useState(false)

  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [feedback, setFeedback] = useState<BookFeedback | null>(null)
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set())

  const gameIdRef = useRef<string | null>(null)
  const moveReqId = useRef(0)

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
  const isPuzzle = current?.item.type === 'puzzle'
  const boardState: BoardState | null = gameState ? toBoardState(gameState, isPuzzle ? selected : null) : null

  const currentTreeInfo = useMemo(() => {
    if (!gameState) return { ply: 0, canBack: false, canForward: false }
    const flat = flatten(gameState.moveTree)
    const entry = flat.get(gameState.currentNodeId)
    const canForward = !!entry?.node.children && entry.node.children.length > 0
    const canBack = entry?.parentId != null
    return { ply: entry?.node.ply ?? 0, canBack, canForward }
  }, [gameState])

  const markDone = useCallback(
    async (itemId: string) => {
      const bookId = book?.id
      if (!bookId) return
      setCompletedItems((prev) => {
        if (prev.has(itemId)) return prev
        const next = new Set(prev)
        next.add(itemId)
        return next
      })
      try {
        await apiMarkItemDone(bookId, itemId)
      } catch {
        // sync failure — the checkmark still shows for this session, just won't persist
      }
    },
    [book],
  )

  // enterItem points the game at `item`'s own position with a clean (empty)
  // tree — the shared reset step for both item types.
  const enterItem = useCallback(async (gid: string, item: BookItem) => {
    setSelected(null)
    setFeedback(null)
    setLessonStarted(false)
    setFlipped(item.sideToMove === 'b')
    const gs = await apiSetPosition(gid, item.fen)
    setGameState(gs)
  }, [])

  // playLine replays a move sequence for real (sequential makeMove calls
  // against the live game), returning the final state — used by both
  // startLesson and revealSolution.
  const playLine = useCallback(async (gid: string, fen: string, uciMoves: string[]) => {
    let gs = await apiSetPosition(gid, fen)
    for (const uci of uciMoves) {
      gs = await makeMove(gid, uci.slice(0, 2), uci.slice(2, 4), promotionFromUci(uci))
    }
    return gs
  }, [])

  const loadStart = useCallback(
    async (bookId: string, chapterId?: string) => {
      setLoading(true)
      setLoadError(null)
      try {
        const b = await getBook(bookId)
        setBook(b)
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

        try {
          const prog = await getBookProgress(bookId)
          setCompletedItems(new Set(prog.done))
        } catch {
          setCompletedItems(new Set())
        }

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

  // startLesson (lessons only) builds the book's own line onto the tree for
  // real (sequential makeMove calls, so every ply is a real node), then
  // steps back to the root — the board stays on the starting position and
  // the user reveals the line themselves via stepForward/⟩, one move at a
  // time, rather than landing on the final position immediately.
  const startLesson = useCallback(async () => {
    const gid = gameIdRef.current
    const item = current?.item
    if (!gid || !item || item.type !== 'lesson') return
    setBusy(true)
    try {
      await playLine(gid, item.fen, item.solutionUci ?? [])
      const gs = await gotoNode(gid, '0')
      setGameState(gs)
      setLessonStarted(true)
      await markDone(item.id)
    } finally {
      setBusy(false)
    }
  }, [current, playLine, markDone])

  // revealSolution (puzzles only) replaces whatever's currently on the board
  // with the real solution line (not a reproduction of the book's own
  // solution text — see project notes — just the moves themselves plus the
  // item's existing original note), then steps back to the root so the user
  // still walks through it via stepForward/⟩ instead of it jumping straight
  // to the final position.
  const revealSolution = useCallback(async () => {
    const gid = gameIdRef.current
    const item = current?.item
    if (!gid || !item || item.type !== 'puzzle') return
    setBusy(true)
    try {
      await playLine(gid, item.fen, item.solutionUci ?? [])
      const gs = await gotoNode(gid, '0')
      setGameState(gs)
      setFeedback(null)
      await markDone(item.id)
    } finally {
      setBusy(false)
    }
  }, [current, playLine, markDone])

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

  // --- click-to-move / drag-and-drop plumbing — puzzles only; lessons are
  // never interactive (they replay a fixed line, see startLesson above) ---

  const attemptMove = useCallback(
    async (from: Square, to: Square) => {
      const gid = gameIdRef.current
      const item = current?.item
      if (!gid || !item || item.type !== 'puzzle' || phase !== 'studying' || busy) return

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

        // Silent solved-check: walk the SAN path from root to the current
        // node and compare against the recorded solution exactly — no
        // rejection either way, this only ever adds a "Solved" flash.
        const flat = flatten(gs.moveTree)
        const sans: string[] = []
        let entry = flat.get(gs.currentNodeId)
        while (entry && entry.node.san) {
          sans.unshift(entry.node.san)
          entry = entry.parentId != null ? flat.get(entry.parentId) : undefined
        }
        const solution = item.solution ?? []
        const solved = solution.length > 0 && sans.length === solution.length && sans.every((s, i) => s === solution[i])
        if (solved) {
          setFeedback({ kind: 'solved' })
          await markDone(item.id)
        } else {
          setFeedback(null)
        }
      } catch {
        // network hiccup — leave the position untouched, allow retry
      } finally {
        if (reqId === moveReqId.current) setBusy(false)
      }
    },
    [current, phase, busy, boardState, markDone],
  )

  const selectSquare = useCallback(
    (square: Square) => {
      if (!boardState || busy || !isPuzzle) return
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
    [boardState, selected, busy, isPuzzle, attemptMove],
  )

  const legalMovesFor = useCallback(
    (square: Square): string[] => {
      if (!gameState || !isPuzzle) return []
      return gameState.legalMoves.filter((m) => m.from === square).map((m) => m.to)
    },
    [gameState, isPuzzle],
  )

  const toggleFlipped = useCallback(() => setFlipped((f) => !f), [])

  const restart = useCallback(() => {
    setPhase('setup')
    setBook(null)
    gameIdRef.current = null
    setGameState(null)
    setFlatIndex(0)
    setCompletedItems(new Set())
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
    feedback,
    lessonStarted,
    completedItems,
    currentPly: currentTreeInfo.ply,
    canStepBack: currentTreeInfo.canBack,
    canStepForward: currentTreeInfo.canForward,
    stepBack,
    stepForward,
    startLesson,
    revealSolution,
    loadStart,
    nextItem,
    prevItem,
    goToIndex,
    selectSquare,
    move: attemptMove,
    legalMovesFor,
    restart,
  }
}

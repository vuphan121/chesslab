'use client'

import { pieceImagePath, useUserSettings } from '@/components/settings/UserSettingsProvider'
import { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Square from './Square'
import Piece from './Piece'
import PieceSprite from './PieceSprite'
import Arrow from './Arrow'
import type { BoardState } from '@/lib/chess/types'

const heldPieceImages: HTMLImageElement[] = []
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

const ANNOTATION_COLOR = 'rgba(255, 152, 0, 0.8)'
const USER_MOVE_SLIDE_MS = 140
const PENDING_MAX_MS = 3000

type PromoPiece = 'q' | 'r' | 'b' | 'n'

interface InteractionState {
  fen: string
  dragFrom: string | null
  dragPos: { x: number; y: number }
  dragOver: string | null
  hasMoved: boolean
  rightDragFrom: string | null
  rightDragTo: string | null
  arrows: { from: string; to: string }[]
  circles: Set<string>
  promo: { from: string; to: string; color: 'w' | 'b' } | null
}

interface TrackedPiece {
  id: number
  square: string
  piece: NonNullable<BoardState['pieces'][string]>
  still: boolean
}

interface StillMove {
  from: string
  to: string
}

interface TrackedPieces {
  key: string
  items: TrackedPiece[]
  nextId: number
  animate: boolean
}

function squareDistance(a: string, b: string): number {
  return Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(Number(a[1]) - Number(b[1])))
}

function piecesKey(pieces: BoardState['pieces']): string {
  return Object.entries(pieces)
    .map(([square, piece]) => `${square}${piece!.color}${piece!.type}`)
    .sort()
    .join(',')
}

function trackPieces(
  previous: TrackedPieces,
  pieces: BoardState['pieces'],
  key: string,
  animate: boolean,
  still: StillMove[],
): TrackedPieces {
  const used = new Set<number>()
  const bySquare = new Map(previous.items.map((item) => [item.square, item]))
  const next: TrackedPiece[] = []
  const unmatched: [string, NonNullable<BoardState['pieces'][string]>][] = []
  for (const [square, piece] of Object.entries(pieces)) {
    if (!piece) continue
    const old = bySquare.get(square)
    if (old && old.piece.type === piece.type && old.piece.color === piece.color) {
      used.add(old.id)
      next.push({ ...old, piece, still: false })
    } else {
      unmatched.push([square, piece])
    }
  }
  const leftover = previous.items.filter((item) => !used.has(item.id))
  let nextId = previous.nextId
  let moved = 0
  for (const [square, piece] of unmatched) {
    let best = -1
    for (let i = 0; i < leftover.length; i++) {
      const candidate = leftover[i]
      if (candidate.piece.type !== piece.type || candidate.piece.color !== piece.color) continue
      if (best < 0 || squareDistance(candidate.square, square) < squareDistance(leftover[best].square, square)) best = i
    }
    if (best >= 0) {
      const [match] = leftover.splice(best, 1)
      moved++
      next.push({ id: match.id, square, piece, still: still.some((m) => m.from === match.square && m.to === square) })
    } else {
      next.push({ id: nextId++, square, piece, still: false })
    }
  }
  return { key, items: next, nextId, animate: animate && moved > 0 && moved <= 2 }
}

function emptyInteraction(fen: string): InteractionState {
  return {
    fen,
    dragFrom: null,
    dragPos: { x: 0, y: 0 },
    dragOver: null,
    hasMoved: false,
    rightDragFrom: null,
    rightDragTo: null,
    arrows: [],
    circles: new Set(),
    promo: null,
  }
}

interface Props {
  boardState: BoardState
  onSquareClick: (square: string) => void | Promise<unknown>
  onMove: (from: string, to: string, promotion?: PromoPiece) => void | Promise<unknown>
  legalMovesFor: (square: string) => string[]
  bestMove?: string
  analysisMoves?: { uci: string; scale: number; color?: string }[]
  animateLastMove?: boolean
  flipped?: boolean
  squareSize?: number
}

export default function Board({
  boardState,
  onSquareClick,
  onMove,
  legalMovesFor,
  bestMove,
  analysisMoves = [],
  animateLastMove = true,
  flipped = false,
  squareSize = 80,
}: Props) {
  const files = flipped ? [...FILES].reverse() : FILES
  const ranks = flipped ? [...RANKS].reverse() : RANKS
  const lastRank = ranks[ranks.length - 1]
  const firstFile = files[0]

  const boardRef = useRef<HTMLDivElement>(null)
  const downPos = useRef({ x: 0, y: 0 })
  const dragMovedRef = useRef(false)
  const [interactionState, setInteractionState] = useState(() => emptyInteraction(boardState.fen))
  const interaction = interactionState.fen === boardState.fen
    ? interactionState
    : emptyInteraction(boardState.fen)
  const { dragFrom, dragPos, dragOver, hasMoved, rightDragFrom, rightDragTo, arrows, circles, promo } = interaction
  const updateInteraction = useCallback((update: (current: InteractionState) => InteractionState) => {
    setInteractionState((previous) => update(
      previous.fen === boardState.fen ? previous : emptyInteraction(boardState.fen),
    ))
  }, [boardState.fen])
  const patchInteraction = useCallback((patch: Partial<InteractionState>) => {
    updateInteraction((current) => ({ ...current, ...patch }))
  }, [updateInteraction])
  const pendingSequence = useRef(0)
  const pendingTimers = useRef<Set<number>>(new Set())
  const [pending, setPending] = useState<{
    id: number
    from: string
    to: string
    piece: NonNullable<BoardState['pieces'][string]>
    slide: boolean
    rook?: { from: string; to: string; piece: NonNullable<BoardState['pieces'][string]> }
    ep?: string
  } | null>(null)
  const rightDownSquare = useRef<string | null>(null)

  useLayoutEffect(() => {
    rightDownSquare.current = null
    dragMovedRef.current = false
  }, [boardState.fen])

  const { settings: userSettings } = useUserSettings()
  useEffect(() => {
    heldPieceImages.length = 0
    for (const color of ['w', 'b']) {
      for (const type of ['p', 'n', 'b', 'r', 'q', 'k']) {
        const img = new window.Image()
        img.src = pieceImagePath(userSettings.pieceTheme, `${color}${type}.png`)
        img.decode?.().catch(() => {})
        heldPieceImages.push(img)
      }
    }
  }, [userSettings.pieceTheme])

  useEffect(() => () => {
    pendingSequence.current++
    for (const timer of pendingTimers.current) window.clearTimeout(timer)
    pendingTimers.current.clear()
  }, [])

  useEffect(() => {
    if (!promo) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') patchInteraction({ promo: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [promo, patchInteraction])

  const commitMove = useCallback((
    from: string,
    to: string,
    slide: boolean,
    promotion: PromoPiece | undefined,
    run: () => void | Promise<unknown>,
  ) => {
    const piece = boardState.pieces[from]
    if (!piece) {
      run()
      return
    }
    const id = ++pendingSequence.current
    const next: NonNullable<typeof pending> = {
      id,
      from,
      to,
      piece: promotion ? { ...piece, type: promotion } : piece,
      slide,
    }
    const fileDelta = FILES.indexOf(to[0]) - FILES.indexOf(from[0])
    if (piece.type === 'k' && Math.abs(fileDelta) === 2) {
      const rookFrom = `${fileDelta > 0 ? 'h' : 'a'}${from[1]}`
      const rook = boardState.pieces[rookFrom]
      if (rook) next.rook = { from: rookFrom, to: `${fileDelta > 0 ? 'f' : 'd'}${from[1]}`, piece: rook }
    }
    if (piece.type === 'p' && from[0] !== to[0] && !boardState.pieces[to]) next.ep = `${to[0]}${from[1]}`
    const startedAt = performance.now()
    setPending(next)
    const scheduleClear = (wait: number) => {
      const timer = window.setTimeout(() => {
        pendingTimers.current.delete(timer)
        setPending((cur) => (cur?.id === id ? null : cur))
      }, wait)
      pendingTimers.current.add(timer)
    }
    const clear = () => {
      if (pendingSequence.current !== id) return
      const wait = slide ? Math.max(30, USER_MOVE_SLIDE_MS + 30 - (performance.now() - startedAt)) : 30
      scheduleClear(wait)
    }
    scheduleClear(PENDING_MAX_MS)
    try {
      Promise.resolve(run()).then(clear, clear)
    } catch {
      clear()
    }
  }, [boardState.pieces])

  const displayPieces = useMemo(() => {
    if (!pending) return boardState.pieces
    const out = { ...boardState.pieces }
    delete out[pending.from]
    out[pending.to] = pending.piece
    if (pending.rook) {
      delete out[pending.rook.from]
      out[pending.rook.to] = pending.rook.piece
    }
    if (pending.ep) delete out[pending.ep]
    return out
  }, [pending, boardState.pieces])

  const displayKey = piecesKey(displayPieces)
  const stillMoves: StillMove[] = []
  if (pending && !pending.slide) {
    stillMoves.push({ from: pending.from, to: pending.to })
    if (pending.rook) stillMoves.push({ from: pending.rook.from, to: pending.rook.to })
  }
  const [tracked, setTracked] = useState<TrackedPieces>(() =>
    trackPieces({ key: '', items: [], nextId: 1, animate: false }, displayPieces, displayKey, false, []),
  )
  const trackedNow = tracked.key === displayKey
    ? tracked
    : trackPieces(tracked, displayPieces, displayKey, animateLastMove, stillMoves)
  if (trackedNow !== tracked) setTracked(trackedNow)

  const isPromotionMove = (from: string, to: string): 'w' | 'b' | null => {
    const piece = boardState.pieces[from]
    if (!piece || piece.type !== 'p') return null
    if (piece.color === 'w' && to[1] === '8') return 'w'
    if (piece.color === 'b' && to[1] === '1') return 'b'
    return null
  }
  const toggleAnnotation = (from: string, to: string) => {
    if (from === to) {
      updateInteraction((current) => {
        const next = new Set(current.circles)
        if (next.has(from)) next.delete(from)
        else next.add(from)
        return { ...current, circles: next }
      })
    } else {
      updateInteraction((current) => ({
        ...current,
        arrows: current.arrows.some((a) => a.from === from && a.to === to)
          ? current.arrows.filter((a) => !(a.from === from && a.to === to))
          : [...current.arrows, { from, to }],
      }))
    }
  }

  const dragTargets = useMemo(
    () => new Set(dragFrom ? legalMovesFor(dragFrom) : []),
    [dragFrom, legalMovesFor],
  )

  const isDragging = dragFrom !== null && hasMoved

  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = 'grabbing'
      return () => {
        document.body.style.cursor = ''
      }
    }
  }, [isDragging])

  const squareFromPoint = (clientX: number, clientY: number): string | null => {
    const board = boardRef.current
    if (!board) return null
    const rect = board.getBoundingClientRect()
    const fi = Math.floor((clientX - rect.left) / squareSize)
    const ri = Math.floor((clientY - rect.top) / squareSize)
    if (fi < 0 || fi > 7 || ri < 0 || ri > 7) return null
    return `${files[fi]}${ranks[ri]}`
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sq = squareFromPoint(e.clientX, e.clientY)
    if (!sq) return

    if (e.button === 2) {
      e.preventDefault()
      if (dragFrom) {
        patchInteraction({ dragFrom: null, dragOver: null, hasMoved: false })
        dragMovedRef.current = false
      }
      boardRef.current?.setPointerCapture(e.pointerId)
      rightDownSquare.current = sq
      patchInteraction({ rightDragFrom: sq, rightDragTo: sq })
      return
    }

    patchInteraction({ arrows: [], circles: new Set() })

    if (promo) {
      patchInteraction({ promo: null })
      return
    }

    const piece = boardState.pieces[sq]
    if (piece && piece.color === boardState.turn) {
      e.preventDefault()
      boardRef.current?.setPointerCapture(e.pointerId)
      downPos.current = { x: e.clientX, y: e.clientY }
      dragMovedRef.current = false
      patchInteraction({ dragFrom: sq, dragPos: { x: e.clientX, y: e.clientY }, hasMoved: false })
    } else {
      const sel = boardState.selectedSquare
      const isMoveTarget = !!sel && boardState.legalMoves.includes(sq)
      const promoColor = isMoveTarget ? isPromotionMove(sel!, sq) : null
      if (promoColor) {
        patchInteraction({ promo: { from: sel!, to: sq, color: promoColor } })
      } else {
        if (isMoveTarget) {
          commitMove(sel!, sq, true, undefined, () => onSquareClick(sq))
        } else {
          onSquareClick(sq)
        }
      }
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rightDownSquare.current) {
      patchInteraction({ rightDragTo: squareFromPoint(e.clientX, e.clientY) })
      return
    }
    if (!dragFrom) return
    const dx = e.clientX - downPos.current.x
    const dy = e.clientY - downPos.current.y
    if (!dragMovedRef.current && Math.sqrt(dx * dx + dy * dy) > 5) {
      dragMovedRef.current = true
      patchInteraction({ hasMoved: true })
    }
    patchInteraction({ dragPos: { x: e.clientX, y: e.clientY }, dragOver: squareFromPoint(e.clientX, e.clientY) })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rightDownSquare.current) {
      const from = rightDownSquare.current
      const to = squareFromPoint(e.clientX, e.clientY)
      rightDownSquare.current = null
      patchInteraction({ rightDragFrom: null, rightDragTo: null })
      if (to) toggleAnnotation(from, to)
      return
    }
    if (!dragFrom) return
    const target = squareFromPoint(e.clientX, e.clientY)
    const from = dragFrom
    const moved = dragMovedRef.current
    patchInteraction({ dragFrom: null, dragOver: null, hasMoved: false })
    dragMovedRef.current = false
    if (!moved) {
      onSquareClick(from)
    } else if (target && dragTargets.has(target)) {
      const promoColor = isPromotionMove(from, target)
      if (promoColor) {
        patchInteraction({ promo: { from, to: target, color: promoColor } })
      } else {
        commitMove(from, target, false, undefined, () => onMove(from, target))
      }
    }
  }

  const handlePointerCancel = () => {
    rightDownSquare.current = null
    patchInteraction({ rightDragFrom: null, rightDragTo: null, dragFrom: null, dragOver: null, hasMoved: false })
    dragMovedRef.current = false
  }

  const dragPiece = dragFrom ? (boardState.pieces[dragFrom] ?? null) : null
  const boardSize = squareSize * 8
  const handlePromotionPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!promo) return
    const piece = e.currentTarget.dataset.promotion as PromoPiece | undefined
    if (!piece) return
    const { from, to } = promo
    patchInteraction({ promo: null })
    commitMove(from, to, false, piece, () => onMove(from, to, piece))
  }

  return (
    <>
      <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
        <div
          ref={boardRef}
          className="inline-flex flex-col"
          style={{
            position: 'relative',
            userSelect: 'none',
            touchAction: 'none',
            borderRadius: 4,
            overflow: 'hidden',
            boxShadow:
              '0 6px 28px rgba(30,50,70,0.16), inset 0 0 0 1px rgba(0,0,0,0.1)',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
            {trackedNow.items.map((item) => (
              <PieceSprite
                key={item.id}
                square={item.square}
                piece={item.piece}
                left={files.indexOf(item.square[0]) * squareSize}
                top={ranks.indexOf(item.square[1]) * squareSize}
                size={squareSize}
                animate={trackedNow.animate && !item.still}
                hidden={isDragging && dragFrom === item.square}
              />
            ))}
          </div>
          {ranks.map((rank) => (
            <div key={rank} className="flex">
              {files.map((file) => {
                const square = `${file}${rank}`
                const piece = displayPieces[square] ?? null
                const spriteCol = FILES.indexOf(file)
                const spriteRow = RANKS.indexOf(rank)
                const isDragSource = isDragging && dragFrom === square

                return (
                  <Square
                    key={square}
                    square={square}
                    piece={piece}
                    squareSize={squareSize}
                    spriteCol={spriteCol}
                    spriteRow={spriteRow}
                    isSelected={(!pending && boardState.selectedSquare === square) || isDragSource}
                    isLegalMove={
                      (!pending && boardState.legalMoves.includes(square)) ||
                      (isDragging && dragTargets.has(square))
                    }
                    isLastMove={
                      pending
                        ? pending.from === square || pending.to === square
                        : boardState.lastMove?.from === square || boardState.lastMove?.to === square
                    }
                    isCheck={
                      !pending &&
                      boardState.isCheck &&
                      piece?.type === 'k' &&
                      piece.color === boardState.turn
                    }
                    isDragHighlight={isDragging && dragOver === square && dragTargets.has(square)}
                    rankLabel={file === firstFile ? rank : undefined}
                    fileLabel={rank === lastRank ? file : undefined}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: boardSize,
            height: boardSize,
            pointerEvents: 'none',
            zIndex: 5,
          }}
          viewBox={`0 0 ${boardSize} ${boardSize}`}
        >
          {bestMove && bestMove.length >= 4 && !isDragging && (
            <Arrow
              from={bestMove.slice(0, 2)}
              to={bestMove.slice(2, 4)}
              squareSize={squareSize}
              flipped={flipped}
              scale={0.8}
            />
          )}

          {!isDragging && analysisMoves.map(({ uci, scale, color }, index) =>
            uci.length >= 4 ? (
              <Arrow
                key={`${uci}-${index}`}
                from={uci.slice(0, 2)}
                to={uci.slice(2, 4)}
                squareSize={squareSize}
                flipped={flipped}
                color={color ?? 'rgba(96, 99, 104, 0.68)'}
                scale={scale}
              />
            ) : null,
          )}

          {[...circles].map((sq) => {
            const fi = files.indexOf(sq[0])
            const ri = ranks.indexOf(sq[1])
            if (fi < 0 || ri < 0) return null
            return (
              <circle
                key={sq}
                cx={(fi + 0.5) * squareSize}
                cy={(ri + 0.5) * squareSize}
                r={squareSize * 0.44}
                fill="none"
                stroke={ANNOTATION_COLOR}
                strokeWidth={squareSize * 0.07}
              />
            )
          })}

          {arrows.map((a) => (
            <Arrow
              key={`${a.from}-${a.to}`}
              from={a.from}
              to={a.to}
              squareSize={squareSize}
              flipped={flipped}
              color={ANNOTATION_COLOR}
            />
          ))}

          {rightDragFrom && rightDragTo && rightDragFrom !== rightDragTo && (
            <Arrow
              from={rightDragFrom}
              to={rightDragTo}
              squareSize={squareSize}
              flipped={flipped}
              color={ANNOTATION_COLOR}
            />
          )}
        </svg>

        {promo && (() => {
          const fi = files.indexOf(promo.to[0])
          const ri = ranks.indexOf(promo.to[1])
          if (fi < 0 || ri < 0) return null
          const goingDown = ri === 0
          const order: PromoPiece[] = goingDown ? ['q', 'n', 'r', 'b'] : ['b', 'r', 'n', 'q']
          const top = goingDown ? 0 : (ri - 3) * squareSize
          return (
            <>
              <div
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); patchInteraction({ promo: null }) }}
                style={{ position: 'absolute', inset: 0, background: 'rgba(18,20,24,0.44)', zIndex: 30, cursor: 'pointer' }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: fi * squareSize,
                  top,
                  width: squareSize,
                  zIndex: 31,
                  borderRadius: 4,
                  overflow: 'hidden',
                  boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                }}
              >
                {order.map((pc) => (
                  <button
                    key={pc}
                    data-promotion={pc}
                    onPointerDown={handlePromotionPointerDown}
                    style={{
                      display: 'block', width: squareSize, height: squareSize, padding: 0,
                      border: 'none', background: '#f3f3f0', cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#cfe6f5')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#f3f3f0')}
                  >
                    <Piece piece={{ type: pc, color: promo.color }} size={squareSize * 0.92} />
                  </button>
                ))}
              </div>
            </>
          )
        })()}
      </div>

      {isDragging &&
        dragPiece &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: dragPos.x - (squareSize * 0.9) / 2,
              top: dragPos.y - (squareSize * 0.9) / 2,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          >
            <Piece piece={dragPiece} size={squareSize * 0.9} />
          </div>,
          document.body,
        )}
    </>
  )
}

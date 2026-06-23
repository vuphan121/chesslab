'use client'

import { useState, useRef, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Square from './Square'
import Piece from './Piece'
import Arrow from './Arrow'
import type { BoardState } from '@/lib/chess/types'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

interface Props {
  boardState: BoardState
  onSquareClick: (square: string) => void
  onMove: (from: string, to: string) => void
  legalMovesFor: (square: string) => string[]
  bestMove?: string
  flipped?: boolean
  squareSize?: number
}

export default function Board({
  boardState,
  onSquareClick,
  onMove,
  legalMovesFor,
  bestMove,
  flipped = false,
  squareSize = 80,
}: Props) {
  const files = flipped ? [...FILES].reverse() : FILES
  const ranks = flipped ? [...RANKS].reverse() : RANKS
  const lastRank = ranks[ranks.length - 1]
  const firstFile = files[0]

  const boardRef = useRef<HTMLDivElement>(null)
  const downPos = useRef({ x: 0, y: 0 })
  const [dragFrom, setDragFrom] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 })
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [hasMoved, setHasMoved] = useState(false)

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
    const piece = boardState.pieces[sq]
    if (piece && piece.color === boardState.turn) {
      e.preventDefault()
      boardRef.current?.setPointerCapture(e.pointerId)
      downPos.current = { x: e.clientX, y: e.clientY }
      setDragFrom(sq)
      setDragPos({ x: e.clientX, y: e.clientY })
      setHasMoved(false)
    } else {
      onSquareClick(sq)
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragFrom) return
    const dx = e.clientX - downPos.current.x
    const dy = e.clientY - downPos.current.y
    if (!hasMoved && Math.sqrt(dx * dx + dy * dy) > 5) setHasMoved(true)
    setDragPos({ x: e.clientX, y: e.clientY })
    setDragOver(squareFromPoint(e.clientX, e.clientY))
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragFrom) return
    const target = squareFromPoint(e.clientX, e.clientY)
    const from = dragFrom
    const moved = hasMoved
    setDragFrom(null)
    setDragOver(null)
    setHasMoved(false)
    if (!moved) {
      onSquareClick(from)
    } else if (target && dragTargets.has(target)) {
      onMove(from, target)
    }
  }

  const dragPiece = dragFrom ? (boardState.pieces[dragFrom] ?? null) : null
  const boardSize = squareSize * 8

  return (
    <>
      <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
        <div
          ref={boardRef}
          className="inline-flex flex-col"
          style={{
            userSelect: 'none',
            touchAction: 'none',
            borderRadius: 4,
            overflow: 'hidden',
            boxShadow:
              '0 4px 24px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(0,0,0,0.08)',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {ranks.map((rank) => (
            <div key={rank} className="flex">
              {files.map((file) => {
                const square = `${file}${rank}`
                const piece = boardState.pieces[square] ?? null
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
                    isSelected={boardState.selectedSquare === square || isDragSource}
                    isLegalMove={
                      boardState.legalMoves.includes(square) ||
                      (isDragging && dragTargets.has(square))
                    }
                    isLastMove={
                      boardState.lastMove?.from === square ||
                      boardState.lastMove?.to === square
                    }
                    isCheck={
                      boardState.isCheck &&
                      piece?.type === 'k' &&
                      piece.color === boardState.turn
                    }
                    isDragHighlight={isDragging && dragOver === square && dragTargets.has(square)}
                    hidePiece={isDragSource}
                    rankLabel={file === firstFile ? rank : undefined}
                    fileLabel={rank === lastRank ? file : undefined}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Arrow + drag-highlight overlay — outside overflow:hidden board */}
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
            />
          )}
        </svg>
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

'use client'

import Square from './Square'
import type { BoardState } from '@/lib/chess/types'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

interface Props {
  boardState: BoardState
  onSquareClick: (square: string) => void
  flipped?: boolean
  squareSize?: number
}

export default function Board({ boardState, onSquareClick, flipped = false, squareSize = 80 }: Props) {
  const files = flipped ? [...FILES].reverse() : FILES
  const ranks = flipped ? [...RANKS].reverse() : RANKS

  const lastRank = ranks[ranks.length - 1]
  const firstFile = files[0]

  return (
    <div
      className="inline-flex flex-col"
      style={{
        userSelect: 'none',
        borderRadius: 4,
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(0,0,0,0.08)',
      }}
    >
      {ranks.map((rank) => (
        <div key={rank} className="flex">
          {files.map((file) => {
            const square = `${file}${rank}`
            const piece = boardState.pieces[square] ?? null
            const spriteCol = FILES.indexOf(file)
            const spriteRow = RANKS.indexOf(rank)

            return (
              <Square
                key={square}
                square={square}
                piece={piece}
                squareSize={squareSize}
                spriteCol={spriteCol}
                spriteRow={spriteRow}
                isSelected={boardState.selectedSquare === square}
                isLegalMove={boardState.legalMoves.includes(square)}
                isLastMove={
                  boardState.lastMove?.from === square || boardState.lastMove?.to === square
                }
                isCheck={boardState.isCheck && piece?.type === 'k' && piece.color !== boardState.turn}
                rankLabel={file === firstFile ? rank : undefined}
                fileLabel={rank === lastRank ? file : undefined}
                onClick={() => onSquareClick(square)}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

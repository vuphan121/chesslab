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
  const boardSize = squareSize * 8
  const coordSize = squareSize * 0.22
  const fontSize = Math.max(10, squareSize * 0.18)

  const files = flipped ? [...FILES].reverse() : FILES
  const ranks = flipped ? [...RANKS].reverse() : RANKS

  return (
    <div className="inline-flex flex-col" style={{ userSelect: 'none' }}>
      {ranks.map((rank, rankIdx) => (
        <div key={rank} className="flex">
          {/* Rank label */}
          <div
            className="flex items-start justify-center shrink-0"
            style={{
              width: coordSize,
              height: squareSize,
              paddingTop: squareSize * 0.04,
              color: '#b0c4d8',
              fontSize,
              fontWeight: 600,
              fontFamily: 'sans-serif',
            }}
          >
            {rank}
          </div>

          {/* Squares */}
          {files.map((file, fileIdx) => {
            const square = `${file}${rank}`
            const piece = boardState.pieces[square] ?? null

            // Sprite position: col = file index (a=0..h=7), row = rank index in texture (rank 8 = row 0)
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
                onClick={() => onSquareClick(square)}
              />
            )
          })}
        </div>
      ))}

      {/* File labels row */}
      <div className="flex" style={{ paddingLeft: coordSize }}>
        {files.map((file) => (
          <div
            key={file}
            className="flex items-center justify-end"
            style={{
              width: squareSize,
              height: coordSize,
              paddingRight: squareSize * 0.04,
              color: '#b0c4d8',
              fontSize,
              fontWeight: 600,
              fontFamily: 'sans-serif',
            }}
          >
            {file}
          </div>
        ))}
      </div>
    </div>
  )
}

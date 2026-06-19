import type { Piece as PieceType, Square as SquareType } from '@/lib/chess/types'
import Piece from './Piece'

interface Props {
  square: SquareType
  piece: PieceType | null
  squareSize: number
  // col and row in sprite coords (0-7), where row 0 = rank 8 (top of board)
  spriteCol: number
  spriteRow: number
  isSelected: boolean
  isLegalMove: boolean
  isLastMove: boolean
  isCheck: boolean
  onClick: () => void
}

export default function Square({
  square,
  piece,
  squareSize,
  spriteCol,
  spriteRow,
  isSelected,
  isLegalMove,
  isLastMove,
  isCheck,
  onClick,
}: Props) {
  const textureSize = squareSize * 8

  return (
    <div
      className="relative cursor-pointer"
      style={{
        width: squareSize,
        height: squareSize,
        backgroundImage: "url('/board-texture.png')",
        backgroundSize: `${textureSize}px ${textureSize}px`,
        backgroundPosition: `-${spriteCol * squareSize}px -${spriteRow * squareSize}px`,
      }}
      onClick={onClick}
    >
      {/* Last move highlight */}
      {isLastMove && (
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(20, 85, 30, 0.5)' }} />
      )}

      {/* Selected highlight */}
      {isSelected && (
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(20, 85, 30, 0.5)' }} />
      )}

      {/* Check highlight */}
      {isCheck && piece?.type === 'k' && (
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle, rgba(255,0,0,0.8) 0%, rgba(255,0,0,0.3) 60%, transparent 100%)',
          }}
        />
      )}

      {/* Piece */}
      {piece && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Piece piece={piece} size={squareSize * 0.9} />
        </div>
      )}

      {/* Legal move indicator */}
      {isLegalMove && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          {piece ? (
            // Capture ring
            <div
              className="absolute inset-0 rounded-none"
              style={{
                boxShadow: 'inset 0 0 0 4px rgba(0,0,0,0.25)',
              }}
            />
          ) : (
            // Move dot
            <div
              className="rounded-full"
              style={{
                width: squareSize * 0.3,
                height: squareSize * 0.3,
                backgroundColor: 'rgba(0,0,0,0.2)',
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

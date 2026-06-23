import type { Piece as PieceType, Square as SquareType } from '@/lib/chess/types'
import Piece from './Piece'

interface Props {
  square: SquareType
  piece: PieceType | null
  squareSize: number
  spriteCol: number
  spriteRow: number
  isSelected: boolean
  isLegalMove: boolean
  isLastMove: boolean
  isCheck: boolean
  isDragHighlight?: boolean
  hidePiece?: boolean
  rankLabel?: string
  fileLabel?: string
}

export default function Square({
  piece,
  squareSize,
  spriteCol,
  spriteRow,
  isSelected,
  isLegalMove,
  isLastMove,
  isCheck,
  isDragHighlight,
  hidePiece,
  rankLabel,
  fileLabel,
}: Props) {
  // (col + row) odd = dark square — determines label colour contrast
  const isDark = (spriteCol + spriteRow) % 2 === 1
  const labelColor = isDark ? 'rgba(176, 196, 216, 0.9)' : 'rgba(100, 140, 170, 0.9)'
  const fontSize = Math.max(9, squareSize * 0.2)
  const labelPad = squareSize * 0.04
  const isHighlighted = isSelected || isLastMove || isDragHighlight
  const textureSize = squareSize * 8

  return (
    <div
      className="relative"
      style={{
        width: squareSize,
        height: squareSize,
        backgroundColor: isHighlighted ? '#7ecae8' : undefined,
        backgroundImage: isHighlighted ? undefined : "url('/board-texture.png')",
        backgroundSize: isHighlighted ? undefined : `${textureSize}px ${textureSize}px`,
        backgroundPosition: isHighlighted
          ? undefined
          : `-${spriteCol * squareSize}px -${spriteRow * squareSize}px`,
      }}
    >
      {isCheck && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle, rgba(255,0,0,0.8) 0%, rgba(255,0,0,0.3) 60%, transparent 100%)',
          }}
        />
      )}

      {piece && !hidePiece && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Piece piece={piece} size={squareSize * 0.9} />
        </div>
      )}

      {rankLabel && (
        <span
          className="absolute z-30 font-semibold leading-none select-none pointer-events-none"
          style={{ top: labelPad, left: labelPad, fontSize, color: labelColor }}
        >
          {rankLabel}
        </span>
      )}

      {fileLabel && (
        <span
          className="absolute z-30 font-semibold leading-none select-none pointer-events-none"
          style={{ bottom: labelPad, right: labelPad, fontSize, color: labelColor }}
        >
          {fileLabel}
        </span>
      )}

      {isLegalMove && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          {piece ? (
            <div
              className="absolute inset-0 rounded-none"
              style={{ boxShadow: 'inset 0 0 0 4px rgba(0,0,0,0.25)' }}
            />
          ) : (
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

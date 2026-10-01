import type { Piece as PieceType, Square as SquareType } from '@/lib/chess/types'
import { useLayoutEffect, useRef } from 'react'
import Piece from './Piece'

const SLIDE_MS = 160

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
  slide?: { key: string; dx: number; dy: number } | null
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
  slide,
  rankLabel,
  fileLabel,
}: Props) {
  const pieceRef = useRef<HTMLDivElement>(null)
  const slideKey = slide?.key
  const dx = slide?.dx ?? 0
  const dy = slide?.dy ?? 0
  useLayoutEffect(() => {
    const el = pieceRef.current
    if (!el || !slideKey) return
    el.style.zIndex = '24'
    const animation = el.animate(
      [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: SLIDE_MS, easing: 'cubic-bezier(0.22, 0.8, 0.28, 1)' },
    )
    const done = () => {
      el.style.zIndex = ''
    }
    animation.addEventListener('finish', done, { once: true })
    animation.addEventListener('cancel', done, { once: true })
    window.setTimeout(() => {
      animation.cancel()
      done()
    }, SLIDE_MS + 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideKey])

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
        <div ref={pieceRef} className="absolute inset-0 flex items-center justify-center z-10">
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

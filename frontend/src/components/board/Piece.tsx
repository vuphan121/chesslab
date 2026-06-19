import Image from 'next/image'
import type { Piece as PieceType } from '@/lib/chess/types'

interface Props {
  piece: PieceType
  size: number
}

export default function Piece({ piece, size }: Props) {
  const filename = `${piece.color}${piece.type}.png`

  return (
    <Image
      src={`/pieces/${filename}`}
      alt={`${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}`}
      width={size}
      height={size}
      draggable={false}
      className="pointer-events-none select-none drop-shadow-md"
      style={{ width: size, height: size }}
    />
  )
}

'use client'

import Image from 'next/image'
import type { Piece as PieceType } from '@/lib/chess/types'
import { pieceImagePath, useUserSettings } from '@/components/settings/UserSettingsProvider'

interface Props {
  piece: PieceType
  size: number
}

export default function Piece({ piece, size }: Props) {
  const filename = `${piece.color}${piece.type}.png`
  const { settings } = useUserSettings()

  return (
    <Image
      src={pieceImagePath(settings.pieceTheme, filename)}
      alt={`${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}`}
      width={size}
      height={size}
      loading="eager"
      draggable={false}
      className="pointer-events-none select-none drop-shadow-md"
      style={{ width: size, height: size }}
    />
  )
}

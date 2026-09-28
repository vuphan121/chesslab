'use client'

import type { Color, Piece as PieceShape, Square } from '@/lib/chess/types'
import Piece from './Piece'
import { computeMaterialDiff, type MaterialSurplus } from '@/lib/chess/materialDiff'

export const MATERIAL_CORNERS_WIDTH = 40
export const MATERIAL_CORNERS_GAP = 8

const ICON_SIZE = 13

function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

export function MaterialRow({
  cornerColor,
  surplus,
  pointsAhead,
  justify = 'flex-end',
}: {
  cornerColor: Color
  surplus: MaterialSurplus[]
  pointsAhead: number
  justify?: 'flex-start' | 'flex-end'
}) {
  if (surplus.length === 0 && pointsAhead <= 0) return null
  const iconColor = other(cornerColor)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, justifyContent: justify }}>
      {surplus.flatMap(({ type, count }) =>
        Array.from({ length: count }, (_, i) => (
          <Piece key={`${type}-${i}`} piece={{ type, color: iconColor }} size={ICON_SIZE} />
        )),
      )}
      {pointsAhead > 0 && (
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: '#37352f', marginLeft: 2 }}>
          +{pointsAhead}
        </span>
      )}
    </div>
  )
}

export function computeMaterialRows(pieces: Record<Square, PieceShape>, flipped = false) {
  const diff = computeMaterialDiff(pieces)
  const bottomColor: Color = flipped ? 'b' : 'w'
  const topColor: Color = other(bottomColor)
  const surplusFor = (color: Color) => (color === 'w' ? diff.white : diff.black)
  const pointsFor = (color: Color) => (color === 'w' ? diff.advantage : -diff.advantage)
  return {
    top: { color: topColor, surplus: surplusFor(topColor), pointsAhead: pointsFor(topColor) },
    bottom: { color: bottomColor, surplus: surplusFor(bottomColor), pointsAhead: pointsFor(bottomColor) },
  }
}

interface Props {
  pieces: Record<Square, PieceShape>
  flipped?: boolean
  height: number
}

export default function MaterialCorners({ pieces, flipped = false, height }: Props) {
  const rows = computeMaterialRows(pieces, flipped)

  return (
    <div style={{ position: 'relative', width: MATERIAL_CORNERS_WIDTH, height, flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 0, right: 0 }}>
        <MaterialRow cornerColor={rows.top.color} surplus={rows.top.surplus} pointsAhead={rows.top.pointsAhead} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, right: 0 }}>
        <MaterialRow cornerColor={rows.bottom.color} surplus={rows.bottom.surplus} pointsAhead={rows.bottom.pointsAhead} />
      </div>
    </div>
  )
}

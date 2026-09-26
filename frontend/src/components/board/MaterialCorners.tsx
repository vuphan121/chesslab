'use client'

import type { Color, Piece as PieceShape, Square } from '@/lib/chess/types'
import Piece from './Piece'
import { computeMaterialDiff, type MaterialSurplus } from '@/lib/chess/materialDiff'

// Exported so pages that lay out a fixed-width row containing the board (and
// hardcode that row's total pixel width for alignment elsewhere, e.g. a
// caption row above it) can add this column's footprint to that sum.
export const MATERIAL_CORNERS_WIDTH = 40
export const MATERIAL_CORNERS_GAP = 8

const ICON_SIZE = 13

function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function Row({ cornerColor, surplus, pointsAhead }: { cornerColor: Color; surplus: MaterialSurplus[]; pointsAhead: number }) {
  if (surplus.length === 0 && pointsAhead <= 0) return null
  const iconColor = other(cornerColor)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
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

interface Props {
  pieces: Record<Square, PieceShape>
  flipped?: boolean
  height: number
}

// Lichess-style material imbalance display: per piece type, the side with
// more of that type on the board has the opponent's missing pieces of that
// type rendered as small icons, plus the total point lead (only shown next
// to whichever side is actually ahead). Positioned as the top-right/
// bottom-right corners of the board — which color renders in which corner
// follows `flipped`, not a hardcoded side.
export default function MaterialCorners({ pieces, flipped = false, height }: Props) {
  const diff = computeMaterialDiff(pieces)
  const bottomColor: Color = flipped ? 'b' : 'w'
  const topColor: Color = other(bottomColor)
  const surplusFor = (color: Color) => (color === 'w' ? diff.white : diff.black)
  const pointsFor = (color: Color) => (color === 'w' ? diff.advantage : -diff.advantage)

  return (
    <div style={{ position: 'relative', width: MATERIAL_CORNERS_WIDTH, height, flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 0, right: 0 }}>
        <Row cornerColor={topColor} surplus={surplusFor(topColor)} pointsAhead={pointsFor(topColor)} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, right: 0 }}>
        <Row cornerColor={bottomColor} surplus={surplusFor(bottomColor)} pointsAhead={pointsFor(bottomColor)} />
      </div>
    </div>
  )
}

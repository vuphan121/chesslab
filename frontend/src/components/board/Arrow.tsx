const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

interface Props {
  from: string
  to: string
  squareSize: number
  flipped?: boolean
  color?: string
  scale?: number
}

export default function Arrow({
  from,
  to,
  squareSize,
  flipped = false,
  color = 'rgba(110, 110, 120, 0.55)',
  scale = 1,
}: Props) {
  const files = flipped ? [...FILES].reverse() : FILES
  const ranks = flipped ? [...RANKS].reverse() : RANKS

  const fi1 = files.indexOf(from[0])
  const ri1 = ranks.indexOf(from[1])
  const fi2 = files.indexOf(to[0])
  const ri2 = ranks.indexOf(to[1])

  if (fi1 < 0 || ri1 < 0 || fi2 < 0 || ri2 < 0) return null

  const x1 = (fi1 + 0.5) * squareSize
  const y1 = (ri1 + 0.5) * squareSize
  const x2 = (fi2 + 0.5) * squareSize
  const y2 = (ri2 + 0.5) * squareSize

  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return null

  const ux = dx / len
  const uy = dy / len
  const px = -uy // perpendicular (left of direction)
  const py = ux

  const startOff = squareSize * 0.3
  const sw = squareSize * 0.14 * scale // shaft half-width
  const hw = squareSize * 0.44 * scale // head half-width
  const hl = squareSize * 0.65 * scale // head length

  const sx = x1 + ux * startOff
  const sy = y1 + uy * startOff
  const hx = x2 - ux * hl
  const hy = y2 - uy * hl

  const pts = [
    [sx + px * sw, sy + py * sw],
    [hx + px * sw, hy + py * sw],
    [hx + px * hw, hy + py * hw],
    [x2, y2],
    [hx - px * hw, hy - py * hw],
    [hx - px * sw, hy - py * sw],
    [sx - px * sw, sy - py * sw],
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ')

  return <polygon points={pts} fill={color} />
}

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
  if (fi1 === fi2 && ri1 === ri2) return null

  const x1 = (fi1 + 0.5) * squareSize
  const y1 = (ri1 + 0.5) * squareSize
  const x2 = (fi2 + 0.5) * squareSize
  const y2 = (ri2 + 0.5) * squareSize

  const df = Math.abs(fi2 - fi1)
  const dr = Math.abs(ri2 - ri1)
  const isKnight = (df === 1 && dr === 2) || (df === 2 && dr === 1)
  const corner = isKnight ? (dr === 2 ? [x1, y2] : [x2, y1]) : null

  const [ax, ay] = corner ?? [x1, y1]
  const [bx, by] = corner ?? [x2, y2]
  const len1 = Math.hypot(bx - x1, by - y1) || 1
  const len2 = Math.hypot(x2 - ax, y2 - ay)
  const u1x = corner ? (bx - x1) / len1 : (x2 - x1) / len2
  const u1y = corner ? (by - y1) / len1 : (y2 - y1) / len2
  const u2x = (x2 - ax) / len2
  const u2y = (y2 - ay) / len2
  const n1x = -u1y
  const n1y = u1x
  const n2x = -u2y
  const n2y = u2x

  const sw = squareSize * 0.095 * scale
  const hw = squareSize * 0.235 * scale
  const hl = squareSize * 0.38 * scale
  const startOff = squareSize * 0.12
  const tipBack = squareSize * 0.05

  const tx = x2 - u2x * tipBack
  const ty = y2 - u2y * tipBack
  const hx = tx - u2x * hl
  const hy = ty - u2y * hl
  const sx = x1 + u1x * startOff
  const sy = y1 + u1y * startOff

  const left = corner
    ? [[sx + n1x * sw, sy + n1y * sw], [ax + (n1x + n2x) * sw, ay + (n1y + n2y) * sw]]
    : [[sx + n1x * sw, sy + n1y * sw]]
  const right = corner
    ? [[ax - (n1x + n2x) * sw, ay - (n1y + n2y) * sw], [sx - n1x * sw, sy - n1y * sw]]
    : [[sx - n1x * sw, sy - n1y * sw]]

  const pts = [
    ...left,
    [hx + n2x * sw, hy + n2y * sw],
    [hx + n2x * hw, hy + n2y * hw],
    [tx, ty],
    [hx - n2x * hw, hy - n2y * hw],
    [hx - n2x * sw, hy - n2y * sw],
    ...right,
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ')

  return <polygon points={pts} fill={color} />
}

export interface ArrowShape {
  uci: string
  scale: number
  color: string
}

export interface CandidateLine {
  uci: string | undefined
  score: number
  mate: number
}

export const BEST_ARROW_COLOR = 'rgba(0, 48, 136, 0.4)'
export const ALTERNATIVE_ARROW_COLOR = 'rgba(74, 74, 74, 0.35)'

const BEST_WIDTH = 15
const MAX_ALTERNATIVE_WIDTH = 12
const MIN_ALTERNATIVE_WIDTH = 2
const WIDTH_PER_SHIFT = 50
const MAX_SHIFT = 0.2

const MULTIPLIER = -0.00368208

function rawWinningChances(cp: number): number {
  return 2 / (1 + Math.exp(MULTIPLIER * cp)) - 1
}

export function winningChances(score: number, mate: number): number {
  if (mate !== 0) {
    const cp = (21 - Math.min(10, Math.abs(mate))) * 100
    return rawWinningChances(mate > 0 ? cp : -cp)
  }
  return rawWinningChances(Math.min(Math.max(-1000, score), 1000))
}

export function arrowShapes(lines: CandidateLine[], turn: 'w' | 'b', maxArrows: number): ArrowShape[] {
  const usable = lines.filter((l): l is CandidateLine & { uci: string } => !!l.uci && l.uci.length >= 4)
  if (usable.length === 0 || maxArrows < 1) return []
  const sign = turn === 'w' ? 1 : -1
  const ranked = usable
    .map((line, index) => ({ line, index, chances: sign * winningChances(line.score, line.mate) }))
    .sort((a, b) => b.chances - a.chances || a.index - b.index)
    .map((r) => r.line)
  const best = ranked[0]
  const bestChances = sign * winningChances(best.score, best.mate)
  const shapes: ArrowShape[] = [{ uci: best.uci, scale: 1, color: BEST_ARROW_COLOR }]
  const seen = new Set([best.uci])
  for (const line of ranked.slice(1)) {
    if (shapes.length >= maxArrows) break
    if (seen.has(line.uci)) continue
    const shift = (bestChances - sign * winningChances(line.score, line.mate)) / 2
    if (shift < 0 || shift >= MAX_SHIFT) continue
    seen.add(line.uci)
    const width = Math.round(MAX_ALTERNATIVE_WIDTH - shift * WIDTH_PER_SHIFT)
    shapes.push({
      uci: line.uci,
      scale: Math.max(MIN_ALTERNATIVE_WIDTH, width) / BEST_WIDTH,
      color: ALTERNATIVE_ARROW_COLOR,
    })
  }
  return shapes
}

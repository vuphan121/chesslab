import { winningChances } from '@/lib/engine/arrows'

export interface EngineLine {
  uci: string | undefined
  score: number
  mate: number
}

const TIE_MARGIN = 0.03

export function chooseEngineReply(
  lines: EngineLine[],
  opponent: 'w' | 'b',
  rng: () => number = Math.random,
): string | null {
  const usable = lines.filter((l): l is EngineLine & { uci: string } => !!l.uci && l.uci.length >= 4)
  if (usable.length === 0) return null
  const sign = opponent === 'w' ? 1 : -1
  const scored = usable.map((l) => ({ uci: l.uci, mate: l.mate, value: sign * winningChances(l.score, l.mate) }))
  const top = scored.reduce((a, b) => (b.value > a.value ? b : a))
  const near = scored.filter((s) => (top.mate !== 0 || s.mate !== 0 ? s.value === top.value : top.value - s.value <= TIE_MARGIN))
  return near[Math.floor(rng() * near.length) % near.length].uci
}

export function pieceCount(fen: string): number {
  return (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length
}

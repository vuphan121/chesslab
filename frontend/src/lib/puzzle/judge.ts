import { Chess } from 'chess.js'

export type MoveVerdict =
  | { kind: 'illegal' }
  | { kind: 'wrong'; uci: string }
  | { kind: 'correct'; uci: string; mate: boolean }

export function judgeMove(fen: string, expectedUci: string, from: string, to: string, promotion?: string): MoveVerdict {
  const chess = new Chess(fen)
  const legal = chess.moves({ verbose: true }).find((m) => {
    if (m.from !== from || m.to !== to) return false
    if (m.promotion) return m.promotion === (promotion && 'qrbn'.includes(promotion) ? promotion : 'q')
    return true
  })
  if (!legal) return { kind: 'illegal' }
  const uci = `${legal.from}${legal.to}${legal.promotion ?? ''}`
  chess.move({ from: legal.from, to: legal.to, promotion: legal.promotion })
  const mate = chess.isCheckmate()
  if (uci === expectedUci || mate) return { kind: 'correct', uci, mate: mate && uci !== expectedUci }
  return { kind: 'wrong', uci }
}

export function splitUci(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) }
}

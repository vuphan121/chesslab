// figurineMap replaces a SAN's leading piece letter with a chess glyph,
// matching Lichess's move list. Pawn moves (no piece letter) and castling
// are unchanged.
const figurineMap: Record<string, string> = {
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
}

export function toFigurine(san: string): string {
  const first = san[0]
  if (figurineMap[first]) return figurineMap[first] + san.slice(1)
  return san
}

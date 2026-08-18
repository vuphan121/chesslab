


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

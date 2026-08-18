


export function cardKey(fen: string): string {
  const fields = fen.trim().split(/\s+/)
  if (fields.length < 4) return fen
  return fields.slice(0, 4).join(' ')
}

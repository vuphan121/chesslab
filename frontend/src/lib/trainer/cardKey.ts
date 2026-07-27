// Mirrors backend/internal/repertoire/build.go's CardKey: strip the halfmove
// clock + fullmove number fields so the same position (reached via a
// different chapter or move order) collides into one card/reply-pool entry.
export function cardKey(fen: string): string {
  const fields = fen.trim().split(/\s+/)
  if (fields.length < 4) return fen
  return fields.slice(0, 4).join(' ')
}

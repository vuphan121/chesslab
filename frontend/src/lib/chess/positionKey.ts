export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 3).join(' ')
}

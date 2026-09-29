export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 5).join(' ')
}

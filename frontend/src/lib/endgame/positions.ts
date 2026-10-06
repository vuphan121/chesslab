export type EndgameGoal = 'win' | 'draw'

export interface EndgamePosition {
  id: string
  name: string
  group: string
  fen: string
  goal: EndgameGoal
}

export const ENDGAME_GROUPS: { key: string; label: string }[] = [
  { key: 'pawn', label: 'Pawn endings' },
  { key: 'rook', label: 'Rook endings' },
  { key: 'minor', label: 'Minor pieces' },
  { key: 'queen', label: 'Queen endings' },
]

export const ENDGAME_POSITIONS: EndgamePosition[] = [
  { id: 'key-squares', name: 'Key squares', group: 'pawn', fen: '8/8/4k3/8/3K4/4P3/8/8 w - - 0 1', goal: 'win' },
  { id: 'king-and-pawn', name: 'King and pawn', group: 'pawn', fen: '8/8/k7/8/1K6/1P6/8/8 w - - 0 1', goal: 'win' },
  { id: 'rook-pawn', name: 'Rook pawn', group: 'pawn', fen: '7k/8/5K1P/8/8/8/8/8 b - - 0 1', goal: 'draw' },
  { id: 'king-and-rook', name: 'King and rook', group: 'rook', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'win' },
  { id: 'lucena', name: 'Lucena', group: 'rook', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', goal: 'win' },
  { id: 'philidor', name: 'Philidor', group: 'rook', fen: '4k3/8/r7/3KP3/8/8/8/4R3 b - - 0 1', goal: 'draw' },
  { id: 'rook-vs-bishop', name: 'Rook vs bishop', group: 'rook', fen: '8/8/8/4k3/8/3b4/8/R3K3 b - - 0 1', goal: 'draw' },
  { id: 'rook-vs-knight', name: 'Rook vs knight', group: 'rook', fen: '8/8/8/8/3n4/4k3/8/R3K3 b - - 0 1', goal: 'draw' },
  { id: 'two-bishops', name: 'Two bishops', group: 'minor', fen: '8/8/8/4k3/8/8/8/1BB1K3 w - - 0 1', goal: 'win' },
  { id: 'bishop-and-knight', name: 'Bishop and knight', group: 'minor', fen: '8/8/8/8/3k4/8/8/KBN5 w - - 0 1', goal: 'win' },
  { id: 'king-and-queen', name: 'King and queen', group: 'queen', fen: '8/8/8/4k3/8/8/8/1Q2K3 w - - 0 1', goal: 'win' },
  { id: 'queen-vs-rook', name: 'Queen vs rook', group: 'queen', fen: '8/8/8/8/8/1k6/6r1/Q3K3 w - - 0 1', goal: 'win' },
]

export function userColorOf(position: EndgamePosition): 'w' | 'b' {
  return position.fen.split(' ')[1] === 'b' ? 'b' : 'w'
}

export function pickNextPosition(
  positions: EndgamePosition[],
  recentIds: string[],
  rng: () => number = Math.random,
): EndgamePosition {
  const fresh = positions.filter((p) => !recentIds.includes(p.id))
  const pool = fresh.length > 0 ? fresh : positions
  return pool[Math.floor(rng() * pool.length) % pool.length]
}

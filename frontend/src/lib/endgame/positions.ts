export type EndgameGoal = 'win' | 'draw'

export interface EndgamePosition {
  id: string
  name: string
  group: string
  fens: string[]
  goal: EndgameGoal
}

export const ENDGAME_GROUPS: { key: string; label: string }[] = [
  { key: 'pawn', label: 'Pawn endings' },
  { key: 'rook', label: 'Rook endings' },
  { key: 'minor', label: 'Minor pieces' },
  { key: 'queen', label: 'Queen endings' },
]

export const ENDGAME_POSITIONS: EndgamePosition[] = [
  {
    id: 'key-squares',
    name: 'Key squares',
    group: 'pawn',
    goal: 'win',
    fens: [
      '8/8/4k3/8/3K4/4P3/8/8 w - - 0 1',
      '8/8/3k4/8/4K3/3P4/8/8 w - - 0 1',
      '8/8/2k5/8/3K4/2P5/8/8 w - - 0 1',
      '8/8/5k2/8/4K3/5P2/8/8 w - - 0 1'
    ],
  },
  {
    id: 'king-and-pawn',
    name: 'King and pawn',
    group: 'pawn',
    goal: 'win',
    fens: [
      '8/8/k7/8/1K6/1P6/8/8 w - - 0 1',
      '8/8/8/k7/8/1KP5/8/8 w - - 0 1',
      '8/8/7k/8/6K1/6P1/8/8 w - - 0 1'
    ],
  },
  {
    id: 'rook-pawn',
    name: 'Rook pawn',
    group: 'pawn',
    goal: 'draw',
    fens: [
      '7k/8/5K1P/8/8/8/8/8 b - - 0 1',
      '7k/8/6KP/8/8/8/8/8 b - - 0 1',
      '6k1/8/5K1P/8/8/8/8/8 b - - 0 1',
      '7k/8/4K2P/8/8/8/8/8 b - - 0 1'
    ],
  },
  {
    id: 'king-and-rook',
    name: 'King and rook',
    group: 'rook',
    goal: 'win',
    fens: [
      '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
      '8/8/2k5/8/8/8/8/4K2R w - - 0 1',
      '8/8/8/8/5k2/8/8/R3K3 w - - 0 1',
      '8/8/8/3k4/8/8/8/R2K4 w - - 0 1'
    ],
  },
  {
    id: 'lucena',
    name: 'Lucena',
    group: 'rook',
    goal: 'win',
    fens: [
      '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
      '3K1k2/3P4/8/8/8/8/r7/1R6 w - - 0 1',
      '4K1k1/4P3/8/8/8/8/r7/2R5 w - - 0 1',
      '1K2k3/1P6/8/8/8/8/r7/3R4 w - - 0 1'
    ],
  },
  {
    id: 'philidor',
    name: 'Philidor',
    group: 'rook',
    goal: 'draw',
    fens: [
      '4k3/8/r7/3KP3/8/8/8/4R3 b - - 0 1'
    ],
  },
  {
    id: 'rook-vs-bishop',
    name: 'Rook vs bishop',
    group: 'rook',
    goal: 'draw',
    fens: [
      '8/8/8/4k3/8/3b4/8/R3K3 b - - 0 1',
      '8/8/8/8/4k3/5b2/8/R3K3 b - - 0 1',
      '8/8/8/4k3/8/4b3/8/R3K3 b - - 0 1',
      '8/8/8/8/8/3k4/4b3/R3K3 b - - 0 1'
    ],
  },
  {
    id: 'rook-vs-knight',
    name: 'Rook vs knight',
    group: 'rook',
    goal: 'draw',
    fens: [
      '8/8/8/8/3n4/4k3/8/R3K3 b - - 0 1',
      '8/8/8/8/2n5/3k4/8/R3K3 b - - 0 1',
      '8/8/8/8/4n3/3k4/8/R3K3 b - - 0 1',
      '8/8/8/8/3n4/3k4/8/R3K3 b - - 0 1',
      '8/8/8/8/5n2/4k3/8/R3K3 b - - 0 1'
    ],
  },
  {
    id: 'two-bishops',
    name: 'Two bishops',
    group: 'minor',
    goal: 'win',
    fens: [
      '8/8/8/4k3/8/8/8/1BB1K3 w - - 0 1',
      '8/8/8/3k4/8/8/8/2BBK3 w - - 0 1',
      '8/8/8/8/4k3/8/8/2B1KB2 w - - 0 1'
    ],
  },
  {
    id: 'bishop-and-knight',
    name: 'Bishop and knight',
    group: 'minor',
    goal: 'win',
    fens: [
      '8/8/8/8/3k4/8/8/KBN5 w - - 0 1',
      '8/8/8/4k3/8/8/8/K1B1N3 w - - 0 1',
      '8/8/8/8/4k3/8/8/KN1B4 w - - 0 1',
      '8/8/8/8/2k5/8/8/K1BN4 w - - 0 1'
    ],
  },
  {
    id: 'king-and-queen',
    name: 'King and queen',
    group: 'queen',
    goal: 'win',
    fens: [
      '8/8/8/4k3/8/8/8/1Q2K3 w - - 0 1',
      '8/8/4k3/8/8/8/8/3QK3 w - - 0 1',
      '8/8/8/8/3k4/8/8/1Q2K3 w - - 0 1'
    ],
  },
  {
    id: 'queen-vs-rook',
    name: 'Queen vs rook',
    group: 'queen',
    goal: 'win',
    fens: [
      '8/8/8/8/8/1k6/6r1/Q3K3 w - - 0 1'
    ],
  },
]

export function userColorOf(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
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

export function mirrorFen(fen: string): string {
  const [board, ...rest] = fen.split(' ')
  const mirrored = board.split('/').map((rank) => [...rank].reverse().join('')).join('/')
  return [mirrored, ...rest].join(' ')
}

export function swapColorsFen(fen: string): string {
  const [board, turn, ...rest] = fen.split(' ')
  const swapped = board
    .split('/')
    .reverse()
    .map((rank) => [...rank].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join(''))
    .join('/')
  return [swapped, turn === 'w' ? 'b' : 'w', ...rest].join(' ')
}

export function pickStartFen(position: EndgamePosition, rng: () => number = Math.random): string {
  let fen = position.fens[Math.floor(rng() * position.fens.length) % position.fens.length]
  if (rng() < 0.5) fen = mirrorFen(fen)
  if (rng() < 0.5) fen = swapColorsFen(fen)
  return fen
}

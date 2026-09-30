export const THEME_CATEGORIES: { key: string; label: string }[] = [
  { key: 'phases', label: 'Phases' },
  { key: 'motifs', label: 'Motifs' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'mates', label: 'Mates' },
  { key: 'mateThemes', label: 'Mate themes' },
  { key: 'specialMoves', label: 'Special moves' },
  { key: 'goals', label: 'Goals' },
  { key: 'lengths', label: 'Lengths' },
]

const LABELS: Record<string, string> = {
  queenRookEndgame: 'Queen and Rook',
  attackingF2F7: 'Attacking f2 or f7',
  capturingDefender: 'Capture the defender',
  xRayAttack: 'X-Ray attack',
  underPromotion: 'Underpromotion',
  mate: 'Checkmate',
  mateIn5: 'Mate in 5 or more',
  anastasiaMate: "Anastasia's mate",
  bodenMate: "Boden's mate",
  morphysMate: "Morphy's mate",
  pillsburysMate: "Pillsbury's mate",
  swallowstailMate: "Swallow's tail mate",
  vukovicMate: 'Vuković mate',
  blindSwineMate: 'Blind Swine mate',
  oneMove: 'One-move puzzle',
  short: 'Short puzzle',
  long: 'Long puzzle',
  veryLong: 'Very long puzzle',
}

export function prettyTheme(key: string): string {
  if (LABELS[key]) return LABELS[key]
  const words = key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

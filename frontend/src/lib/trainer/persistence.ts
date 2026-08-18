





import type { PersistedCardState, SessionState } from './types'

export function mergeSessionCards(
  prior: Record<string, PersistedCardState>,
  session: SessionState,
): Record<string, PersistedCardState> {
  const cards = { ...prior }
  for (const id of session.order) {
    const c = session.cards.get(id)
    if (!c || c.seen === 0) continue
    cards[id] = {
      box: c.box,
      lapses: c.lapses,
      seen: c.seen,
      correct: c.correct,
      lastSeenISO: c.lastSeenISO,
    }
  }
  return cards
}

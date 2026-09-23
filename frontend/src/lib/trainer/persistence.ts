





import type { PersistedCardState, SessionState } from './types'

export interface ProgressDelta {
  lapses: number
  seen: number
  correct: number
}

export function progressDeltas(
  prior: Record<string, PersistedCardState>,
  next: Record<string, PersistedCardState>,
): Record<string, ProgressDelta> {
  return Object.fromEntries(
    Object.entries(next).flatMap(([id, card]) => {
      const before = prior[id]
      const delta = {
        lapses: Math.max(0, card.lapses - (before?.lapses ?? 0)),
        seen: Math.max(0, card.seen - (before?.seen ?? 0)),
        correct: Math.max(0, card.correct - (before?.correct ?? 0)),
      }
      return delta.lapses || delta.seen || delta.correct ? [[id, delta]] : []
    }),
  )
}

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

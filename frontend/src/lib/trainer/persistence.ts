// Pure merge logic for folding a session's per-card progress into whatever
// was already known. This used to also own the localStorage read/write —
// trainer progress is server-side now (see frontend CLAUDE.md's
// "Server-side trainer sync" note and useTrainerSession.ts, which fetches
// prior state via client.ts's getProgress and writes the merged result back
// via saveProgress), so this module is just the data-shape logic, no I/O.
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

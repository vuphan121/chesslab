// localStorage persistence for per-card scheduler history. See
// docs/opening-trainer/data-format.md §6 for the schema.
import type { PersistedState, SessionState, PersistedSessionLog } from './types'

const MAX_SESSIONS = 20

function key(repertoireId: string): string {
  return `chesslab.trainer.v1.${repertoireId}`
}

export function loadPersisted(repertoireId: string): PersistedState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key(repertoireId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedState
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export function savePersisted(repertoireId: string, state: PersistedState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key(repertoireId), JSON.stringify(state))
  } catch {
    // storage full/unavailable — drop silently, nothing else reasonable to do
  }
}

// mergeSessionIntoPersisted folds a session's per-card state into whatever
// was previously persisted for this repertoire. `sessionLog` is optional and
// should be passed only once, at actual session end (not on every run
// boundary within a session) — otherwise the sessions array accumulates one
// overlapping, cumulative-so-far entry per run instead of one entry per
// completed drilling session.
export function mergeSessionIntoPersisted(
  repertoireId: string,
  prior: PersistedState | null,
  session: SessionState,
  sessionLog?: PersistedSessionLog,
): PersistedState {
  const cards = { ...(prior?.cards ?? {}) }
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

  const sessions = sessionLog
    ? [...(prior?.sessions ?? []), sessionLog].slice(-MAX_SESSIONS)
    : (prior?.sessions ?? [])

  return {
    version: 1,
    repertoireId,
    updatedISO: new Date().toISOString(),
    cards,
    sessions,
  }
}

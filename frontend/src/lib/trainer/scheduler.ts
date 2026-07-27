// Pure scheduling algorithm — no chess knowledge, no network, no wall clock
// inside a session. See docs/opening-trainer/scheduler.md for the full spec
// and worked trace this implementation is checked against.
import type { RepCard, CardState, SessionOptions, SessionState, PersistedState, SessionSummary } from './types'
import { uniform, weightedChoice } from './rng'

export const BASE_GAP = [2, 4, 8, 16, 32, 64]
export const MAX_BOX = 5
export const DEMOTE = 2
export const RELEARN_GAP = 2
export const LAPSE_DECAY = 0.8
export const JITTER = 0.35
export const RETIRE_STREAK = 2
export const PICK_WINDOW = 4
export const LAPSE_W = 1.0
export const OVERDUE_W = 0.25
export const NEW_RATE = 0.3

export const defaultSessionOptions: SessionOptions = {
  sessionLength: 40,
  newLimit: 8,
  mode: 'mixed',
}

function freshCardState(cardId: string): CardState {
  return {
    cardId,
    box: 0,
    lapses: 0,
    streak: 0,
    seen: 0,
    correct: 0,
    lastSeenISO: null,
    introduced: false,
    retired: false,
    dueStep: 0,
  }
}

// createSession seeds a session's card states from persisted history
// (time-decayed per scheduler.md §8), filtered/ordered by mode.
export function createSession(
  cards: RepCard[],
  opts: SessionOptions,
  saved: PersistedState | null,
  rng: () => number,
): SessionState {
  const states = new Map<string, CardState>()
  const order: string[] = []

  for (const card of cards) {
    if (opts.mode === 'mistakes' && !(saved?.cards[card.id]?.lapses)) continue

    const st = freshCardState(card.id)
    const persisted = saved?.cards[card.id]
    if (persisted) {
      st.box = persisted.box
      st.lapses = persisted.lapses
      st.seen = persisted.seen
      st.correct = persisted.correct
      st.lastSeenISO = persisted.lastSeenISO

      if (persisted.lastSeenISO) {
        const days = Math.floor((Date.now() - Date.parse(persisted.lastSeenISO)) / 86_400_000)
        if (days > st.box) st.box = Math.max(0, st.box - 1)
      }
      st.introduced = opts.mode !== 'review-only' || st.box > 0 || st.seen > 0
      if (opts.mode === 'review-only' && st.seen === 0) continue
    } else {
      if (opts.mode === 'review-only' || opts.mode === 'mistakes') continue
    }

    states.set(card.id, st)
    order.push(card.id)
  }

  return {
    step: 0,
    cards: states,
    order,
    rng,
    opts,
    correctCount: 0,
    incorrectCount: 0,
  }
}

function activeCards(s: SessionState): CardState[] {
  return s.order.map((id) => s.cards.get(id)!).filter((c) => c.introduced && !c.retired)
}

// pickNext returns the next card to present, or null if the session is
// complete (every card retired). See scheduler.md §4.
export function pickNext(s: SessionState): CardState | null {
  const active = activeCards(s)
  let due = active.filter((c) => c.dueStep <= s.step)
  const newPool = s.order.map((id) => s.cards.get(id)!).filter((c) => !c.introduced)
  const inFlight = active.filter((c) => c.box < 2).length

  if (newPool.length > 0 && inFlight < s.opts.newLimit) {
    if (due.length === 0 || s.rng() < NEW_RATE) {
      const c = newPool[0]
      c.introduced = true
      c.dueStep = s.step
      return c
    }
  }

  if (due.length === 0) {
    if (active.length === 0) return null
    s.step = Math.min(...active.map((c) => c.dueStep))
    due = active.filter((c) => c.dueStep <= s.step)
  }
  if (due.length === 0) return null

  due.sort((a, b) => a.dueStep - b.dueStep || s.order.indexOf(a.cardId) - s.order.indexOf(b.cardId))
  const window = due.slice(0, PICK_WINDOW)
  return weightedChoice(
    window,
    (c) => (1 + LAPSE_W * c.lapses) * (1 + OVERDUE_W * (s.step - c.dueStep)),
    s.rng,
  )
}

// grade records a graded attempt at cardId and reschedules it. See
// scheduler.md §5.
export function grade(s: SessionState, cardId: string, correct: boolean): void {
  const c = s.cards.get(cardId)
  if (!c) return

  s.step += 1
  c.seen += 1
  c.lastSeenISO = new Date().toISOString()
  // A card reached inside a run (not picked by pickNext) is still graded —
  // mark it introduced so it isn't later treated as fresh "new" material.
  c.introduced = true

  let gap: number
  if (correct) {
    s.correctCount += 1
    c.correct += 1
    c.streak += 1
    c.box = Math.min(c.box + 1, MAX_BOX)
    if (c.box === MAX_BOX && c.streak >= RETIRE_STREAK) {
      c.retired = true
      return
    }
    gap = BASE_GAP[c.box] * Math.pow(LAPSE_DECAY, c.lapses)
  } else {
    s.incorrectCount += 1
    c.lapses += 1
    c.streak = 0
    c.box = Math.max(0, c.box - DEMOTE)
    gap = RELEARN_GAP
  }

  const jittered = gap * uniform(1 - JITTER, 1 + JITTER, s.rng)
  c.dueStep = s.step + Math.max(1, Math.round(jittered))
}

export function isComplete(s: SessionState): boolean {
  const active = activeCards(s)
  const newPool = s.order.map((id) => s.cards.get(id)!).filter((c) => !c.introduced)
  if (active.length === 0 && newPool.length === 0) return true
  if (s.opts.sessionLength != null && s.step >= s.opts.sessionLength) return true
  return false
}

export function summarise(s: SessionState): SessionSummary {
  const seen = s.order.map((id) => s.cards.get(id)!).filter((c) => c.seen > 0)
  return {
    steps: s.step,
    cardsSeen: seen.length,
    correct: s.correctCount,
    incorrect: s.incorrectCount,
    learned: seen.filter((c) => c.retired).map((c) => c.cardId),
    missed: seen
      .filter((c) => c.lapses > 0)
      .sort((a, b) => b.lapses - a.lapses)
      .map((c) => ({ cardId: c.cardId, lapses: c.lapses })),
  }
}

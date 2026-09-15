


import type { RepCard, CardState, SessionOptions, SessionState, PersistedCardState, SessionSummary } from './types'
import { uniform, weightedChoice, shuffle } from './rng'

export const BASE_GAP = [2, 4, 8, 16, 32, 64]
export const MAX_BOX = 5
export const DEMOTE = 2
export const RELEARN_GAP = 2
export const LAPSE_DECAY = 0.8
export const JITTER = 0.35
export const RETIRE_STREAK = 2
export const LAPSE_W = 1.0
// Weight from lapses is capped so a single hard line can't dominate its
// same-round siblings: every extra miss keeps shortening its relearn gap
// (bringing it back sooner across rounds, uncapped, by design), but past
// this many lapses it stops ALSO getting more likely to win a same-round
// tiebreak every time it's drawn. Uncapped, a line with e.g. 10 lapses would
// get 11x the pick weight of a fresh sibling, forever growing with every miss.
export const LAPSE_WEIGHT_CAP = 3

export const defaultSessionOptions: SessionOptions = {
  sessionLength: 40,
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
    retired: false,
    dueStep: 0,
  }
}















export function createSession(
  cards: RepCard[],
  opts: SessionOptions,
  saved: Record<string, PersistedCardState> | null,
  rng: () => number,
): SessionState {
  const states = new Map<string, CardState>()
  const order: string[] = []






  for (const card of shuffle(cards, rng)) {
    if (opts.mode === 'mistakes' && !(saved?.[card.id]?.lapses)) continue

    const st = freshCardState(card.id)
    const persisted = saved?.[card.id]
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
  return s.order.map((id) => s.cards.get(id)!).filter((c) => !c.retired)
}



// True round-robin selection: always show whichever active card has been
// presented the FEWEST times so far this session, so no card gets a repeat
// presentation before every other active card has had its turn this round.
//
// An earlier version gated on a time/step-based "due" cycle instead (each
// card getting its own relearn/promotion gap in steps). That meant a card
// you kept missing — whose relearn gap stays short (by design, so it comes
// back soon) — could requalify as "due" far more often in absolute terms
// than a mastered sibling, whose gap balloons to 16-64 steps. Verified
// against the real French repertoire data behind this bug: a line the user
// was missing claimed ~12-15% of picks in a 49-card chapter (vs. a ~2% fair
// share) even with a capped lapse weight, because the skew came from *how
// often it re-qualified for consideration*, not from winning a fair draw
// too often once it did.
//
// Round-robin fixes this structurally: a struggling card still ends up
// shown more *overall* over a full session — legitimately, since it takes
// longer to retire and so persists across more rounds — but never crowds
// out its siblings within any given stretch of picks. Lapses still nudge
// which card wins a same-round tiebreak (mild SRS flavor), capped so that
// nudge can't grow unbounded either.
export function pickNext(s: SessionState): CardState | null {
  const active = activeCards(s)
  if (active.length === 0) return null

  const minSeen = Math.min(...active.map((c) => c.seen))
  const atMin = active.filter((c) => c.seen === minSeen)
  const candidates = atMin.length > 1 ? atMin.filter((c) => c.cardId !== s.lastCardId) : atMin
  const pool = candidates.length > 0 ? candidates : atMin

  const picked = weightedChoice(
    pool,
    (c) => 1 + LAPSE_W * Math.min(c.lapses, LAPSE_WEIGHT_CAP),
    s.rng,
  )
  s.lastCardId = picked.cardId
  return picked
}



export function grade(s: SessionState, cardId: string, correct: boolean): void {
  const c = s.cards.get(cardId)
  if (!c) return

  s.step += 1
  c.seen += 1
  c.lastSeenISO = new Date().toISOString()

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
  if (active.length === 0) return true
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

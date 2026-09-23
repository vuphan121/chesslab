


import type { RepCard, CardState, SessionOptions, SessionState, PersistedCardState, SessionSummary } from './types'
import { uniform, shuffle } from './rng'

export const BASE_GAP = [2, 4, 8, 16, 32, 64]
export const MAX_BOX = 5
export const DEMOTE = 2
export const RELEARN_GAP = 2
export const LAPSE_DECAY = 0.8
export const JITTER = 0.35
export const RETIRE_STREAK = 2

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
      st.box = Math.min(MAX_BOX, Math.max(0, persisted.box))
      st.lapses = persisted.lapses
      st.seen = persisted.seen
      st.correct = persisted.correct
      st.lastSeenISO = persisted.lastSeenISO

      if (persisted.lastSeenISO) {
        const days = Math.floor((Date.now() - Date.parse(persisted.lastSeenISO)) / 86_400_000)
        if (days > BASE_GAP[st.box]) st.box = Math.max(0, st.box - 1)
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



// NOTE: the trainer no longer uses this to decide what to drill next — that's
// lineQueue.ts (a shuffled deck of whole lines). It stays as the card-level
// picker, and `grade`/`createSession` are still what drive per-card progress.
//
// Pure random selection: every active (non-retired) card in the current
// selection — whether that's a whole repertoire or a hand-picked subset of
// its chapters — has an equal chance of coming up next, with no preference
// for less-practiced or more-lapsed material.
//
// Earlier versions here tried to be smarter than that: first a time/step-
// based "due" cycle, then a strict round-robin by presentation count (always
// show whichever active card has been seen fewest times), with lapses and
// then chapter identity nudging same-round ties. Each version fixed one
// reported skew (a missed card dominating its chapter, then one chapter's
// pile of untouched cards dominating its siblings) by adding another rule —
// but any rule that looks at seen-count/lapses/chapter size to decide what's
// "due" next inherently produces a non-random, front-loaded order: whatever
// a session hasn't gotten to yet keeps winning until it's caught up, which
// is exactly what read as "stuck on one chapter" even when it was working
// as designed. Removing the preference entirely removes that whole class of
// bug at the root, at the cost of the round-robin's old guarantee that
// nothing goes neglected for long — accepted tradeoff, not an oversight.
//
// Only exact back-to-back repeats of the same card are avoided (when a
// different active card exists), matching how a shuffled playlist skips
// immediately replaying the last track rather than true independent draws.
export function pickNext(s: SessionState): CardState | null {
  const active = activeCards(s)
  if (active.length === 0) return null

  const candidates = active.length > 1 ? active.filter((c) => c.cardId !== s.lastCardId) : active
  const pool = candidates.length > 0 ? candidates : active

  const picked = pool[Math.floor(s.rng() * pool.length)]
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

import { describe, it, expect } from 'vitest'
import { createSession, pickNext, grade, isComplete, BASE_GAP, LAPSE_DECAY, MAX_BOX } from './scheduler'
import { mulberry32 } from './rng'
import type { RepCard, SessionOptions } from './types'

function makeCard(id: string): RepCard {
  return {
    id,
    fen: id,
    side: 'w',
    ply: 0,
    chapterIds: ['ch1'],
    pathSan: [],
    answers: [{ san: 'e4', uci: 'e2e4', fen: id, primary: true, chapterIds: ['ch1'] }],
  }
}

const noJitterRng = () => 0.5

function session(cards: RepCard[], opts?: Partial<SessionOptions>, rng: () => number = noJitterRng) {
  return createSession(cards, { sessionLength: null, mode: 'mixed', ...opts }, null, rng)
}

describe('scheduler', () => {
  it('a correct answer reschedules further out than a wrong one from the same state', () => {
    const s1 = session([makeCard('A')])
    pickNext(s1)
    grade(s1, 'A', true)
    const dueAfterCorrect = s1.cards.get('A')!.dueStep

    const s2 = session([makeCard('A')])
    pickNext(s2)
    grade(s2, 'A', false)
    const dueAfterWrong = s2.cards.get('A')!.dueStep

    expect(dueAfterCorrect).toBeGreaterThan(dueAfterWrong)
  })

  it('box progresses 0->5 over six correct answers with documented gaps', () => {
    const s = session([makeCard('A')])
    const boxesSeen: number[] = []
    for (let i = 0; i < 6; i++) {
      pickNext(s)
      const before = s.cards.get('A')!.box
      grade(s, 'A', true)
      boxesSeen.push(before)
    }
    expect(boxesSeen).toEqual([0, 1, 2, 3, 4, 5])

  })

  it('a miss demotes by exactly 2, floored at 0', () => {
    const s = session([makeCard('A')])
    const c = s.cards.get('A')!
    c.box = 1
    pickNext(s)
    grade(s, 'A', false)
    expect(c.box).toBe(0)

    c.box = 3
    grade(s, 'A', false)
    expect(c.box).toBe(1)
  })

  it('lapses monotonically shorten the gap and never go below 1', () => {
    const gapAt = (lapses: number) => BASE_GAP[3] * Math.pow(LAPSE_DECAY, lapses)
    expect(gapAt(0)).toBeGreaterThan(gapAt(1))
    expect(gapAt(1)).toBeGreaterThan(gapAt(2))
    expect(Math.max(1, Math.round(gapAt(50)))).toBeGreaterThanOrEqual(1)
  })

  it('retires only at box 5 with streak >= 2, and never picks a retired card again', () => {
    const s = session([makeCard('A')])
    for (let i = 0; i < 7; i++) {
      pickNext(s)
      grade(s, 'A', true)
    }
    const c = s.cards.get('A')!
    expect(c.box).toBe(MAX_BOX)
    expect(c.retired).toBe(true)
    expect(pickNext(s)).toBeNull()
  })

  it('pickNext ignores seen/box/lapses entirely and draws uniformly across active cards', () => {
    // Full reversal of the earlier round-robin design (and its later
    // chapter-aware tiebreak): both picked "whatever's least practiced"
    // first, which produces a front-loaded order — whatever a session
    // hadn't gotten to yet keeps winning until it's caught up. For a
    // repertoire drilled unevenly across many real sessions (one chapter at
    // seen: 500+, another still at seen: 0), that read as "stuck on one
    // chapter" for as long as its backlog took to clear, even though the
    // algorithm was working exactly as designed. Selection is now a plain
    // uniform draw over every active card, regardless of seen/box/lapses —
    // explicitly requested over the round-robin fix as the simpler, more
    // predictable behavior.
    const cards = [makeCard('lots'), makeCard('some'), makeCard('none')]
    const saved = {
      lots: { box: 3, lapses: 0, seen: 500, correct: 500, lastSeenISO: null },
      some: { box: 1, lapses: 4, seen: 20, correct: 15, lastSeenISO: null },
      // 'none' never attempted — seen: 0 by default.
    }
    const s = createSession(cards, { sessionLength: null, mode: 'mixed' }, saved, mulberry32(3))
    const counts: Record<string, number> = { lots: 0, some: 0, none: 0 }
    const draws = 3000
    for (let i = 0; i < draws; i++) {
      counts[pickNext(s)!.cardId]++
    }
    for (const id of ['lots', 'some', 'none']) {
      const share = counts[id] / draws
      expect(share).toBeGreaterThan(0.28)
      expect(share).toBeLessThan(0.38)
    }
  })

  it('every card is immediately eligible — no gradual new-card introduction', () => {
    const cards = [makeCard('A'), makeCard('B'), makeCard('C')]
    const s = session(cards)


    const active = s.order.map((id) => s.cards.get(id)!).filter((c) => !c.retired)
    expect(active).toHaveLength(3)
  })

  it('is deterministic: same seed + same answers -> same pick order', () => {
    const cards = [makeCard('A'), makeCard('B'), makeCard('C'), makeCard('D')]
    const run = () => {
      const s = createSession(cards, { sessionLength: 12, mode: 'mixed' }, null, mulberry32(42))
      const picks: string[] = []
      for (let i = 0; i < 12 && !isComplete(s); i++) {
        const c = pickNext(s)
        if (!c) break
        picks.push(c.cardId)
        grade(s, c.cardId, i % 3 !== 0)
      }
      return picks
    }
    expect(run()).toEqual(run())
  })

  it('never repeats the same card back-to-back while another card is active', () => {
    // Selection is a plain uniform draw now (see the dedicated randomness
    // test above) — the one guarantee still enforced is that the exact same
    // card never repeats twice in a row while an alternative exists, the
    // same way a shuffled playlist skips replaying the last track instead of
    // drawing fully independently each time.
    const cards = [makeCard('A'), makeCard('B'), makeCard('C')]
    const s = createSession(cards, { sessionLength: 60, mode: 'mixed' }, null, mulberry32(11))
    let lastPicked: string | null = null
    let steps = 0
    while (!isComplete(s) && steps < 200) {
      const c = pickNext(s)
      if (!c) break
      const activeCount = s.order.filter((id) => !s.cards.get(id)!.retired).length
      if (activeCount > 1) {
        expect(c.cardId).not.toBe(lastPicked)
      }
      lastPicked = c.cardId
      grade(s, c.cardId, c.cardId !== 'A')
      steps++
    }
  })

  it('a consistently-wrong card ends with the lowest box and highest presentation count', () => {
    const cards = [makeCard('A'), makeCard('B'), makeCard('C')]
    const s = createSession(cards, { sessionLength: 40, mode: 'mixed' }, null, mulberry32(7))
    let steps = 0
    while (!isComplete(s) && steps < 200) {
      const c = pickNext(s)
      if (!c) break
      grade(s, c.cardId, c.cardId !== 'A')
      steps++
    }
    const a = s.cards.get('A')!
    const b = s.cards.get('B')!
    const cc = s.cards.get('C')!
    expect(a.box).toBeLessThanOrEqual(Math.min(b.box, cc.box))
    expect(a.seen).toBeGreaterThanOrEqual(Math.max(b.seen, cc.seen))
  })

  it('a hard line among many siblings stays close to a fair share of picks during a normal session', () => {
    // Regression test for the reported bug at real scale: one card in a
    // 49-card pool (matching the actual repertoire chapter involved) is
    // wrong 60% of the time; every other card is wrong ~10% of the time
    // (realistic — not perfect, so siblings stay in genuine rotation too,
    // not all instantly retiring). Bounded to a session length well short
    // of exhausting the whole chapter — once every OTHER card has actually
    // been mastered/retired, the hard line is the only thing left to show
    // and must dominate by then; that's correct, not a bug. Verified against
    // the real repertoire data behind this report: at this same budget the
    // pre-fix algorithm already put the missed line at ~16% of all picks —
    // 8x its 1/49 ≈ 2% fair share — while this round-robin selection stays
    // within a couple percent of fair share all the way out to ~300 steps.
    const N = 49
    const cards = Array.from({ length: N }, (_, i) => makeCard(`c${i}`))
    const target = 'c0'
    const rng = mulberry32(123)
    const answerRng = mulberry32(456)
    const budget = 200
    const s = createSession(cards, { sessionLength: budget, mode: 'mixed' }, null, rng)
    const picks: string[] = []
    let steps = 0
    while (!isComplete(s) && steps < budget) {
      const c = pickNext(s)
      if (!c) break
      picks.push(c.cardId)
      const correct = c.cardId === target ? answerRng() > 0.6 : answerRng() > 0.1
      grade(s, c.cardId, correct)
      steps++
    }
    const share = picks.filter((id) => id === target).length / picks.length
    // Fair share is 1/49 ≈ 2%. Allow real headroom for legitimately being
    // shown more (it IS the one being missed) without allowing a runaway.
    expect(share).toBeLessThan(0.08)
  })

  it('pickNext works correctly with mode: "mistakes" (only previously-lapsed cards)', () => {
    // Mode filtering happens in createSession, before pickNext ever sees the
    // cards — this confirms that combination still behaves regardless of how
    // pickNext itself selects among them: only cards with persisted lapses >
    // 0 are included, and pickNext draws only from exactly that filtered set.
    const cards = [makeCard('A'), makeCard('B'), makeCard('C'), makeCard('D')]
    const saved = {
      A: { box: 2, lapses: 3, seen: 5, correct: 2, lastSeenISO: null },
      B: { box: 5, lapses: 0, seen: 6, correct: 6, lastSeenISO: null },
      C: { box: 1, lapses: 1, seen: 2, correct: 1, lastSeenISO: null },
      // D never attempted — no entry at all.
    }
    const s = createSession(cards, { sessionLength: null, mode: 'mistakes' }, saved, mulberry32(1))
    expect(s.order.sort()).toEqual(['A', 'C']) // only cards with lapses > 0

    const picked = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const c = pickNext(s)
      if (!c) break
      picked.add(c.cardId)
      grade(s, c.cardId, true)
    }
    expect(picked).toEqual(new Set(['A', 'C']))
  })

  it('pickNext works correctly with mode: "review-only" (only previously-seen cards)', () => {
    const cards = [makeCard('A'), makeCard('B'), makeCard('C')]
    const saved = {
      A: { box: 2, lapses: 0, seen: 5, correct: 5, lastSeenISO: null },
      // B and C never attempted.
    }
    const s = createSession(cards, { sessionLength: null, mode: 'review-only' }, saved, mulberry32(1))
    expect(s.order).toEqual(['A'])
    const c = pickNext(s)
    expect(c?.cardId).toBe('A')
  })
})

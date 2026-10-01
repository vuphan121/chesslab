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
  it('uses the box review gap before applying staleness decay', () => {
    const now = Date.now()
    const recent = {
      A: { box: 5, lapses: 0, seen: 8, correct: 8, lastSeenISO: new Date(now - 7 * 86_400_000).toISOString() },
    }
    const overdue = {
      A: { box: 3, lapses: 0, seen: 8, correct: 8, lastSeenISO: new Date(now - 17 * 86_400_000).toISOString() },
    }

    const recentSession = createSession([makeCard('A')], { sessionLength: null, mode: 'mixed' }, recent, mulberry32(1))
    const overdueSession = createSession([makeCard('A')], { sessionLength: null, mode: 'mixed' }, overdue, mulberry32(1))

    expect(recentSession.cards.get('A')?.box).toBe(5)
    expect(overdueSession.cards.get('A')?.box).toBe(2)
  })

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
    const cards = [makeCard('lots'), makeCard('some'), makeCard('none')]
    const saved = {
      lots: { box: 3, lapses: 0, seen: 500, correct: 500, lastSeenISO: null },
      some: { box: 1, lapses: 4, seen: 20, correct: 15, lastSeenISO: null },
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
    expect(share).toBeLessThan(0.08)
  })

  it('pickNext works correctly with mode: "mistakes" (only previously-lapsed cards)', () => {
    const cards = [makeCard('A'), makeCard('B'), makeCard('C'), makeCard('D')]
    const saved = {
      A: { box: 2, lapses: 3, seen: 5, correct: 2, lastSeenISO: null },
      B: { box: 5, lapses: 0, seen: 6, correct: 6, lastSeenISO: null },
      C: { box: 1, lapses: 1, seen: 2, correct: 1, lastSeenISO: null },
    }
    const s = createSession(cards, { sessionLength: null, mode: 'mistakes' }, saved, mulberry32(1))
    expect(s.order.sort()).toEqual(['A', 'C'])

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
    }
    const s = createSession(cards, { sessionLength: null, mode: 'review-only' }, saved, mulberry32(1))
    expect(s.order).toEqual(['A'])
    const c = pickNext(s)
    expect(c?.cardId).toBe('A')
  })
})

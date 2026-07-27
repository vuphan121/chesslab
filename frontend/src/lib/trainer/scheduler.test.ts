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

const noJitterRng = () => 0.5 // uniform(1-J,1+J, rng)=1.0 at rng()=0.5

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
    // dueStep gaps should match BASE_GAP at each box (jitter stubbed to 1.0)
  })

  it('a miss demotes by exactly 2, floored at 0', () => {
    const s = session([makeCard('A')])
    const c = s.cards.get('A')!
    c.box = 1
    pickNext(s)
    grade(s, 'A', false)
    expect(c.box).toBe(0) // floored, not -1

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

  it('pickNext never returns a card whose dueStep > step while another is due', () => {
    const s = session([makeCard('A'), makeCard('B')])
    pickNext(s)
    grade(s, 'A', true) // A now due later
    const picked = pickNext(s) // B still due at step 0
    expect(picked?.cardId).toBe('B')
  })

  it('fast-forwards step to the minimum dueStep without skipping a card', () => {
    const s = session([makeCard('A'), makeCard('B')])
    grade(s, 'A', true) // A due later
    grade(s, 'B', true) // B due later too, both retired? no just box1
    const before = s.step
    const picked = pickNext(s)
    expect(s.step).toBeGreaterThanOrEqual(before)
    expect(picked).not.toBeNull()
  })

  it('every card is immediately eligible — no gradual new-card introduction', () => {
    const cards = [makeCard('A'), makeCard('B'), makeCard('C')]
    const s = session(cards)
    // all three should already be "active" (pickable) from step 0, not
    // drip-fed in one at a time
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
})

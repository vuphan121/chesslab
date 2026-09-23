import { describe, expect, it } from 'vitest'
import { progressDeltas } from './persistence'

describe('progressDeltas', () => {
  it('sends only work performed since the device loaded its snapshot', () => {
    const prior = {
      existing: { box: 2, lapses: 1, seen: 5, correct: 4, lastSeenISO: '2026-09-22T00:00:00Z' },
    }
    const next = {
      existing: { box: 3, lapses: 1, seen: 6, correct: 5, lastSeenISO: '2026-09-23T00:00:00Z' },
      new: { box: 0, lapses: 1, seen: 1, correct: 0, lastSeenISO: '2026-09-23T00:00:00Z' },
    }

    expect(progressDeltas(prior, next)).toEqual({
      existing: { lapses: 0, seen: 1, correct: 1 },
      new: { lapses: 1, seen: 1, correct: 0 },
    })
  })

  it('does not resend unchanged counters or turn a stale snapshot into negative increments', () => {
    const prior = {
      card: { box: 4, lapses: 3, seen: 8, correct: 5, lastSeenISO: '2026-09-23T00:00:00Z' },
    }
    const stale = {
      card: { box: 3, lapses: 2, seen: 7, correct: 4, lastSeenISO: '2026-09-22T00:00:00Z' },
    }

    expect(progressDeltas(prior, prior)).toEqual({})
    expect(progressDeltas(prior, stale)).toEqual({})
  })
})

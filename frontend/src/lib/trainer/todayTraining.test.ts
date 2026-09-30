import { describe, expect, it } from 'vitest'
import { rotateTodayTraining, summarizeTodayTraining, type TodayTrainingSnapshot } from './todayTraining'

const snapshot: TodayTrainingSnapshot = {
  queueDate: '2026-09-30',
  settings: { repertoireIds: ['white', 'black'] },
  entries: [
    { repertoireId: 'white', cardId: 'A' },
    { repertoireId: 'black', cardId: 'B' },
    { repertoireId: 'white', cardId: 'C' },
  ],
}

describe('today training offline queue', () => {
  it('moves a completed entry to the tail without mutating the cached snapshot', () => {
    const rotated = rotateTodayTraining(snapshot, 'white', 'A')
    expect(rotated?.entries.map((entry) => entry.cardId)).toEqual(['B', 'C', 'A'])
    expect(snapshot.entries.map((entry) => entry.cardId)).toEqual(['A', 'B', 'C'])
  })

  it('matches the server behavior when a non-front entry is completed', () => {
    const rotated = rotateTodayTraining(snapshot, 'black', 'B')
    expect(rotated?.entries.map((entry) => entry.cardId)).toEqual(['A', 'C', 'B'])
  })

  it('does not invent an entry that is absent from the snapshot', () => {
    expect(rotateTodayTraining(snapshot, 'white', 'missing')).toBeNull()
  })

  it('derives the compact UI response from the local queue', () => {
    expect(summarizeTodayTraining(snapshot)).toEqual({
      settings: snapshot.settings,
      entryCount: 3,
      nextEntry: snapshot.entries[0],
    })
  })
})

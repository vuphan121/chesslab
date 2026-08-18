


const chapterOnePages: Record<string, number> = {
  'buyc1-ch1-lesson-2': 1,
  'buyc1-ch1-lesson-3': 2,
  'buyc1-ch1-lesson-4': 2,
  'buyc1-ch1-lesson-5': 2,
  'buyc1-ch1-lesson-6': 3,
  'buyc1-ch1-lesson-7': 3,
  'buyc1-ch1-lesson-8': 3,
  'buyc1-ch1-lesson-9': 4,
  'buyc1-ch1-lesson-10': 4,
  'buyc1-ch1-lesson-11': 4,
  'buyc1-ch1-lesson-12': 5,
  'buyc1-ch1-lesson-13': 5,
  'buyc1-ch1-puzzle-1': 6,
  'buyc1-ch1-puzzle-2': 6,
  'buyc1-ch1-puzzle-3': 6,
  'buyc1-ch1-puzzle-4': 6,
  'buyc1-ch1-puzzle-5': 6,
  'buyc1-ch1-puzzle-6': 6,
  'buyc1-ch1-puzzle-7': 7,
  'buyc1-ch1-puzzle-8': 7,
  'buyc1-ch1-puzzle-9': 7,
  'buyc1-ch1-puzzle-10': 7,
  'buyc1-ch1-puzzle-11': 7,
  'buyc1-ch1-puzzle-12': 7,
}

export function sourcePageForItem(bookId: string, itemId: string, stored?: number): number | undefined {
  if (stored) return stored
  if (bookId === 'build-up-your-chess-1') return chapterOnePages[itemId]
  return undefined
}

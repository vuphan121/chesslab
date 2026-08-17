// Temporary local metadata for the Chapter 1 source PDF. These are PDF page
// numbers and position identifiers only (no source prose); once a book is
// re-seeded with sourcePage fields, BookItem.sourcePage takes precedence.
const chapterOnePages: Record<string, number> = {
  'buyc1-ch1-lesson-2': 6,
  'buyc1-ch1-lesson-3': 7,
  'buyc1-ch1-lesson-4': 7,
  'buyc1-ch1-lesson-5': 7,
  'buyc1-ch1-lesson-6': 8,
  'buyc1-ch1-lesson-7': 8,
  'buyc1-ch1-lesson-8': 8,
  'buyc1-ch1-lesson-9': 9,
  'buyc1-ch1-lesson-10': 9,
  'buyc1-ch1-lesson-11': 9,
  'buyc1-ch1-lesson-12': 10,
  'buyc1-ch1-lesson-13': 10,
  'buyc1-ch1-puzzle-1': 11,
  'buyc1-ch1-puzzle-2': 11,
  'buyc1-ch1-puzzle-3': 11,
  'buyc1-ch1-puzzle-4': 11,
  'buyc1-ch1-puzzle-5': 11,
  'buyc1-ch1-puzzle-6': 11,
  'buyc1-ch1-puzzle-7': 12,
  'buyc1-ch1-puzzle-8': 12,
  'buyc1-ch1-puzzle-9': 12,
  'buyc1-ch1-puzzle-10': 12,
  'buyc1-ch1-puzzle-11': 12,
  'buyc1-ch1-puzzle-12': 12,
}

export function sourcePageForItem(bookId: string, itemId: string, stored?: number): number | undefined {
  if (stored) return stored
  if (bookId === 'build-up-your-chess-1') return chapterOnePages[itemId]
  return undefined
}

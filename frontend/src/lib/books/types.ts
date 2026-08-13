// --- wire shapes (mirror backend/internal/api/book_handler.go) ---

export interface BookItem {
  id: string
  chapterId: string
  type: 'lesson' | 'puzzle'
  fen: string
  sideToMove: 'w' | 'b'
  prompt: string
  solution?: string[]
  solutionUci?: string[]
  note?: string
}

export interface BookChapter {
  id: string
  number: number
  name: string
  items: BookItem[]
}

export interface Book {
  id: string
  title: string
  author: string
  chapters: BookChapter[]
}

export interface BookChapterSummary {
  id: string
  number: number
  name: string
  itemCount: number
}

export interface BookSummary {
  id: string
  title: string
  author: string
  chapters: BookChapterSummary[]
  itemCount: number
}



export interface LineNode {
  san?: string
  annotation?: string
  before?: string
  after?: string
  children?: LineNode[]
}

export interface LineNote {
  annotation?: string
  before?: string
  after?: string
}

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
  line?: LineNode
  sourcePage?: number
  bookPage?: number
  masterPDFPage?: number
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

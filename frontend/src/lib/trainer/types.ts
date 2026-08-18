import type { Color } from '@/lib/chess/types'



export interface RepertoireChapterSummary {
  id: string
  name: string
  cardCount: number
}

export interface RepertoireSummary {
  id: string
  name: string
  side: Color
  source: string
  description: string
  chapters: RepertoireChapterSummary[]
  cardCount: number
}

export interface RepNode {
  san: string
  uci: string
  fen: string
  ply: number
  comment?: string
  nags?: number[]
  excluded: boolean
  excludedReason?: string
  excludedSubtree: boolean
  children: RepNode[] | null
}

export interface RepChapter {
  id: string
  name: string
  url: string
  startFen: string
  tree: RepNode
}

export interface RepAnswer {
  san: string
  uci: string
  fen: string
  primary: boolean
  comment?: string
  chapterIds: string[]
}

export interface RepExcludedAnswer {
  san: string
  uci: string
  reason?: string
}

export interface RepCard {
  id: string
  fen: string
  side: Color
  ply: number
  chapterIds: string[]
  pathSan: string[]
  answers: RepAnswer[]
  excludedAnswers?: RepExcludedAnswer[]
}

export interface RepReply {
  san: string
  uci: string
  fen: string
  chapterIds: string[]
}

export interface Repertoire {
  id: string
  name: string
  side: Color
  source: string
  description: string
  chapters: RepChapter[]
  cards: RepCard[]
  replies: Record<string, RepReply[]>
}



export interface CardState {
  cardId: string
  box: number
  lapses: number
  streak: number
  seen: number
  correct: number
  lastSeenISO: string | null
  retired: boolean
  dueStep: number
}

export interface SessionOptions {
  sessionLength: number | null
  mode: 'mixed' | 'review-only' | 'mistakes'
}

export interface SessionState {
  step: number
  cards: Map<string, CardState>
  order: string[]
  rng: () => number
  opts: SessionOptions
  correctCount: number
  incorrectCount: number
}

export interface SessionSummary {
  steps: number
  cardsSeen: number
  correct: number
  incorrect: number
  learned: string[]
  missed: { cardId: string; lapses: number }[]
}






export interface PersistedCardState {
  box: number
  lapses: number
  seen: number
  correct: number
  lastSeenISO: string | null
}

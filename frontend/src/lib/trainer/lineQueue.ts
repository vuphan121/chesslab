import type { RepChapter, RepNode } from './types'
import { cardKey } from './cardKey'
import { shuffle } from './rng'

export interface ChapterLine {
  sans: string[]
  // cardKey of every position along the line, chapter root included — how a
  // line is matched against the session's per-card state.
  positionKeys: string[]
  hasExcluded: boolean
}

// Every root-to-leaf path of a chapter tree. Also what the setup screen uses
// for its per-chapter "N lines" count, so the count and the drill queue can
// never disagree about what a "line" is.
export function enumerateLines(
  node: RepNode,
  sans: string[] = [],
  hasExcluded = false,
  positionKeys: string[] = [cardKey(node.fen)],
): ChapterLine[] {
  const children = node.children ?? []
  if (children.length === 0) {
    return sans.length > 0 ? [{ sans, positionKeys, hasExcluded }] : []
  }
  const lines: ChapterLine[] = []
  for (const child of children) {
    lines.push(
      ...enumerateLines(child, [...sans, child.san], hasExcluded || child.excluded, [...positionKeys, cardKey(child.fen)]),
    )
  }
  return lines
}

export interface DrillLine {
  id: string
  chapterId: string
  path: string[]
  positionKeys: string[]
}

// Lines flagged as inferior in the source study are left out entirely, same
// as the setup screen's line count.
export function buildDrillLines(chapters: RepChapter[]): DrillLine[] {
  return chapters.flatMap((ch) =>
    enumerateLines(ch.tree)
      .filter((l) => !l.hasExcluded)
      .map((l) => ({ id: `${ch.id}:${l.sans.join(' ')}`, chapterId: ch.id, path: l.sans, positionKeys: l.positionKeys })),
  )
}

export interface LineQueue {
  lines: DrillLine[]
  pending: DrillLine[]
  lastId: string | null
  rng: () => number
}

export function createLineQueue(lines: DrillLine[], rng: () => number): LineQueue {
  return { lines, pending: [], lastId: null, rng }
}

/**
 * Deals lines like a shuffled deck: every eligible line comes up exactly once
 * before any line comes up a second time, then the deck is reshuffled.
 *
 * This replaced a uniform random draw with replacement, which is what made a
 * line reappear after only one or two others (nothing stopped it) and left
 * some lines unseen for a long stretch. The one seam a deck has — the last
 * line of one pass being dealt again first in the next — is smoothed over by
 * rotating the new deck when that would happen.
 *
 * `isActive` says whether a line still has something left to drill (e.g. not
 * every card on it is retired); inactive lines are skipped and dropped from
 * the current pass.
 */
export function nextQueuedLine(q: LineQueue, isActive: (line: DrillLine) => boolean): DrillLine | null {
  q.pending = q.pending.filter(isActive)
  if (q.pending.length === 0) {
    const eligible = q.lines.filter(isActive)
    if (eligible.length === 0) return null
    q.pending = shuffle(eligible, q.rng)
    if (q.pending.length > 1 && q.pending[0].id === q.lastId) {
      q.pending.push(q.pending.shift()!)
    }
  }
  const line = q.pending.shift()!
  q.lastId = line.id
  return line
}

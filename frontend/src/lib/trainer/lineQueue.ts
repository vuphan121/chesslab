import type { RepChapter, RepNode } from './types'
import { cardKey } from './cardKey'
import { shuffle } from './rng'

export interface ChapterLine {
  sans: string[]
  // uci of every ply along the line (same length as sans) — lets a hover
  // preview show the move that was just played, not just the resting FEN.
  ucis: string[]
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
  ucis: string[] = [],
): ChapterLine[] {
  const children = node.children ?? []
  if (children.length === 0) {
    return sans.length > 0 ? [{ sans, ucis, positionKeys, hasExcluded }] : []
  }
  const lines: ChapterLine[] = []
  for (const child of children) {
    lines.push(
      ...enumerateLines(
        child,
        [...sans, child.san],
        hasExcluded || child.excluded,
        [...positionKeys, cardKey(child.fen)],
        [...ucis, child.uci],
      ),
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

/**
 * Moves a run onto a different line of the deck when the user plays a move
 * that's in their repertoire but not on the line they were dealt. Positions
 * with several repertoire moves are common, e.g. one chapter per candidate
 * move, and without this the run kept "following" the old line's
 * replies from a position that line never reaches.
 *
 * Picks a line that passes through `positionKey` (the position after the
 * user's move). It prefers a line not yet dealt this pass, then one from
 * `preferChapterId`, with `q.rng` breaking ties. The line that was dealt goes
 * back into the pending pile, since it hasn't actually been drilled, and the
 * chosen line leaves it. `rest` is the chosen line's SAN from that position
 * on. Returns null when no line in the deck reaches the position (e.g. the
 * move only appears in a chapter that wasn't selected).
 */
export function switchToLineThrough(
  q: LineQueue,
  positionKey: string,
  fromId: string | null,
  preferChapterId: string | null,
): { line: DrillLine; rest: string[] } | null {
  const candidates = q.lines.flatMap((line) => {
    const at = line.positionKeys.indexOf(positionKey)
    return at > 0 && line.id !== fromId ? [{ line, rest: line.path.slice(at) }] : []
  })
  if (candidates.length === 0) return null

  const pendingIds = new Set(q.pending.map((l) => l.id))
  const score = (c: { line: DrillLine }) =>
    (pendingIds.has(c.line.id) ? 2 : 0) + (c.line.chapterId === preferChapterId ? 1 : 0)
  const best = Math.max(...candidates.map(score))
  const top = candidates.filter((c) => score(c) === best)
  const chosen = top[Math.floor(q.rng() * top.length)]

  q.pending = q.pending.filter((l) => l.id !== chosen.line.id)
  const from = fromId ? q.lines.find((l) => l.id === fromId) : undefined
  if (from && !q.pending.some((l) => l.id === from.id)) {
    q.pending.splice(Math.floor(q.rng() * (q.pending.length + 1)), 0, from)
  }
  q.lastId = chosen.line.id
  return chosen
}

import type { RepChapter, RepNode } from './types'
import { cardKey } from './cardKey'
import { shuffle } from './rng'

export interface ChapterLine {
  sans: string[]
  ucis: string[]
  positionKeys: string[]
  hasExcluded: boolean
}

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

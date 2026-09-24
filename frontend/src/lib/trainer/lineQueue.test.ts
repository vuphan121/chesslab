import { describe, it, expect } from 'vitest'
import { buildDrillLines, createLineQueue, enumerateLines, nextQueuedLine, switchToLineThrough } from './lineQueue'
import type { DrillLine } from './lineQueue'
import { mulberry32 } from './rng'
import type { RepChapter, RepNode } from './types'

function node(san: string, children: RepNode[] | null = null, excluded = false): RepNode {
  return { san, uci: san, fen: `fen-${san} 0 1`, ply: 0, excluded, excludedSubtree: excluded, children }
}

function chapter(id: string, tree: RepNode): RepChapter {
  return { id, name: id, url: '', startFen: tree.fen, tree }
}

function line(id: string, positionKeys: string[] = [id]): DrillLine {
  return { id, chapterId: 'ch', path: [id], positionKeys }
}

const always = () => true

describe('enumerateLines / buildDrillLines', () => {
  const tree = node('root', [
    node('a', [node('a1'), node('a2')]),
    node('b'),
    node('bad', [node('bad1')], true),
  ])

  it('returns every root-to-leaf path with the position key of each step', () => {
    const lines = enumerateLines(tree)
    expect(lines.map((l) => l.sans)).toEqual([['a', 'a1'], ['a', 'a2'], ['b'], ['bad', 'bad1']])
    // root + one key per move
    expect(lines[0].positionKeys).toHaveLength(3)
    expect(lines[2].positionKeys).toHaveLength(2)
  })

  it('flags lines that pass through an excluded move, and buildDrillLines drops them', () => {
    expect(enumerateLines(tree).map((l) => l.hasExcluded)).toEqual([false, false, false, true])
    const lines = buildDrillLines([chapter('ch1', tree)])
    expect(lines.map((l) => l.path)).toEqual([['a', 'a1'], ['a', 'a2'], ['b']])
    expect(new Set(lines.map((l) => l.id)).size).toBe(3)
    expect(lines.every((l) => l.chapterId === 'ch1')).toBe(true)
  })
})

describe('nextQueuedLine', () => {
  const lines = ['A', 'B', 'C', 'D', 'E'].map((id) => line(id))

  it('deals every line exactly once per pass, in a shuffled order', () => {
    const q = createLineQueue(lines, mulberry32(5))
    for (let pass = 0; pass < 4; pass++) {
      const dealt = lines.map(() => nextQueuedLine(q, always)!.id)
      expect([...dealt].sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    }
  })

  it('actually shuffles rather than dealing in chapter order every pass', () => {
    const orders = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const q = createLineQueue(lines, mulberry32(seed))
      orders.add(lines.map(() => nextQueuedLine(q, always)!.id).join(''))
    }
    expect(orders.size).toBeGreaterThan(1)
  })

  it('never deals the same line twice in a row, including across the pass boundary', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const q = createLineQueue(lines, mulberry32(seed))
      let prev: string | null = null
      for (let i = 0; i < 40; i++) {
        const id = nextQueuedLine(q, always)!.id
        expect(id).not.toBe(prev)
        prev = id
      }
    }
  })

  it('skips lines that are no longer active, mid-pass and on later passes', () => {
    const q = createLineQueue(lines, mulberry32(9))
    const retired = new Set<string>()
    const isActive = (l: DrillLine) => !retired.has(l.id)
    const first = nextQueuedLine(q, isActive)!
    // Retire everything else that's still waiting in this pass except one.
    const keep = q.pending[0].id
    for (const l of lines) if (l.id !== keep && l.id !== first.id) retired.add(l.id)
    expect(nextQueuedLine(q, isActive)!.id).toBe(keep)
    // Next pass: only the still-active lines (keep + first) remain.
    const next = [nextQueuedLine(q, isActive)!.id, nextQueuedLine(q, isActive)!.id]
    expect(next.sort()).toEqual([first.id, keep].sort())
  })

  it('returns null when nothing is active', () => {
    const q = createLineQueue(lines, mulberry32(1))
    expect(nextQueuedLine(q, () => false)).toBeNull()
    expect(nextQueuedLine(createLineQueue([], mulberry32(1)), always)).toBeNull()
  })

  it('a single active line is dealt repeatedly (nothing else to alternate with)', () => {
    const q = createLineQueue([line('only')], mulberry32(1))
    expect(nextQueuedLine(q, always)!.id).toBe('only')
    expect(nextQueuedLine(q, always)!.id).toBe('only')
  })
})

describe('switchToLineThrough', () => {
  const dealt: DrillLine = { id: 'h6', chapterId: 'h6', path: ['h6', 'Be3'], positionKeys: ['root', 'after-h6', 'x'] }
  const nbd7a: DrillLine = { id: 'n1', chapterId: 'nbd7', path: ['Nbd7', 'Qd2'], positionKeys: ['root', 'after-nbd7', 'y'] }
  const nbd7b: DrillLine = { id: 'n2', chapterId: 'nbd7', path: ['Nbd7', 'Nf3'], positionKeys: ['root', 'after-nbd7', 'z'] }

  it('moves onto a line through the played position and puts the dealt line back', () => {
    const q = createLineQueue([dealt, nbd7a, nbd7b], mulberry32(1))
    q.pending = [nbd7b]
    const got = switchToLineThrough(q, 'after-nbd7', 'h6', 'h6')
    // n2 is still pending this pass, so it's preferred over the already-dealt n1.
    expect(got?.line.id).toBe('n2')
    expect(got?.rest).toEqual(['Nf3'])
    expect(q.pending.map((l) => l.id)).toEqual(['h6'])
    expect(q.lastId).toBe('n2')
  })

  it('returns null and leaves the deck alone when no line reaches the position', () => {
    const q = createLineQueue([dealt, nbd7a], mulberry32(1))
    q.pending = [nbd7a]
    expect(switchToLineThrough(q, 'nowhere', 'h6', 'h6')).toBeNull()
    expect(q.pending.map((l) => l.id)).toEqual(['n1'])
  })
})

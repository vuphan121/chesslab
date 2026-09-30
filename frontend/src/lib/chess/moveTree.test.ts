import { describe, it, expect } from 'vitest'
import { activeLine, flatten } from './moveTree'
import type { MoveNode } from './types'

function n(id: string, children: MoveNode[] = []): MoveNode {
  return { id, san: id, fen: id, ply: 0, children } as MoveNode
}

describe('activeLine', () => {
  const tree = n('root', [n('a', [n('b', [n('c')]), n('x', [n('y')])])])

  it('is the main line when the cursor is on it', () => {
    expect(activeLine(tree, 'b').map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(activeLine(tree, 'root').map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('follows a sideline the cursor is on, including its continuation', () => {
    expect(activeLine(tree, 'x').map((m) => m.id)).toEqual(['a', 'x', 'y'])
  })

  it('reuses the index while an immutable tree root is unchanged', () => {
    expect(flatten(tree)).toBe(flatten(tree))
  })
})

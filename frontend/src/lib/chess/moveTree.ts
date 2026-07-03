import type { MoveNode } from './types'

// Go serializes an empty children slice as null; normalize to an array.
export function childrenOf(node: MoveNode): MoveNode[] {
  return node.children ?? []
}

export interface FlatEntry {
  node: MoveNode
  parentId: string | null
}

// flatten walks the tree into an id → { node, parentId } map for O(1) lookups.
export function flatten(root: MoveNode): Map<string, FlatEntry> {
  const map = new Map<string, FlatEntry>()
  const walk = (n: MoveNode, parentId: string | null) => {
    map.set(n.id, { node: n, parentId })
    for (const c of childrenOf(n)) walk(c, n.id)
  }
  walk(root, null)
  return map
}

// mainlineEnd follows children[0] from node to the leaf of its main line.
export function mainlineEnd(node: MoveNode): MoveNode {
  let cur = node
  for (let kids = childrenOf(cur); kids.length > 0; kids = childrenOf(cur)) {
    cur = kids[0]
  }
  return cur
}

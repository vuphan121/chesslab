import type { MoveNode } from './types'


export function childrenOf(node: MoveNode): MoveNode[] {
  return node.children ?? []
}

export interface FlatEntry {
  node: MoveNode
  parentId: string | null
}


export function flatten(root: MoveNode): Map<string, FlatEntry> {
  const map = new Map<string, FlatEntry>()
  const walk = (n: MoveNode, parentId: string | null) => {
    map.set(n.id, { node: n, parentId })
    for (const c of childrenOf(n)) walk(c, n.id)
  }
  walk(root, null)
  return map
}


export function mainlineEnd(node: MoveNode): MoveNode {
  let cur = node
  for (let kids = childrenOf(cur); kids.length > 0; kids = childrenOf(cur)) {
    cur = kids[0]
  }
  return cur
}

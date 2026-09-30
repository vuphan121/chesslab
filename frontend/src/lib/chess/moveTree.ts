import type { MoveNode } from './types'


export function childrenOf(node: MoveNode): MoveNode[] {
  return node.children ?? []
}

export interface FlatEntry {
  node: MoveNode
  parentId: string | null
}

const flatCache = new WeakMap<MoveNode, Map<string, FlatEntry>>()

export function flatten(root: MoveNode): Map<string, FlatEntry> {
  const cached = flatCache.get(root)
  if (cached) return cached
  const map = new Map<string, FlatEntry>()
  const walk = (n: MoveNode, parentId: string | null) => {
    map.set(n.id, { node: n, parentId })
    for (const c of childrenOf(n)) walk(c, n.id)
  }
  walk(root, null)
  flatCache.set(root, map)
  return map
}


export function mainlineEnd(node: MoveNode): MoveNode {
  let cur = node
  for (let kids = childrenOf(cur); kids.length > 0; kids = childrenOf(cur)) {
    cur = kids[0]
  }
  return cur
}

export function activeLine(root: MoveNode, currentId: string): MoveNode[] {
  const flat = flatten(root)
  const path: MoveNode[] = []
  for (let entry = flat.get(currentId); entry && entry.parentId !== null; entry = flat.get(entry.parentId)) {
    path.push(entry.node)
  }
  path.reverse()
  let cur = flat.get(currentId)?.node ?? root
  for (let kids = childrenOf(cur); kids.length > 0; kids = childrenOf(cur)) {
    cur = kids[0]
    path.push(cur)
  }
  return path
}

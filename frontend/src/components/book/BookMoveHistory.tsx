'use client'

import type { MoveNode } from '@/lib/chess/types'
import { toFigurine } from '@/lib/chess/figurine'

interface Props {
  moveTree: MoveNode
  currentNodeId: string
  busy: boolean
  onGoto: (nodeId: string) => void
}

// A deliberately local move tree: it records only the student's current
// exploration of this card and disappears when they choose another card.
export default function BookMoveHistory({ moveTree, currentNodeId, busy, onGoto }: Props) {
  const mainline: MoveNode[] = []
  let node: MoveNode | undefined = moveTree
  while (node) {
    const next: MoveNode | undefined = (node.children ?? [])[0]
    if (!next) break
    mainline.push(next)
    node = next
  }

  const moveCell = (move: MoveNode | undefined) => {
    if (!move) return <span style={{ flex: 1 }} />
    const active = move.id === currentNodeId
    return (
      <button
        onClick={() => onGoto(move.id)}
        disabled={busy}
        style={{
          flex: 1, minWidth: 0, border: 'none', borderRadius: 5, padding: '4px 6px', textAlign: 'left',
          background: active ? '#dff0fb' : 'transparent', color: active ? '#1f6294' : '#37352f',
          cursor: busy ? 'default' : 'pointer', fontSize: 12,
        }}
      >
        <span className="mono" style={{ fontWeight: active ? 700 : 500 }}>{toFigurine(move.san)}</span>
      </button>
    )
  }

  const rows: React.ReactNode[] = []
  for (let i = 0; i < mainline.length; i += 2) {
    const white = mainline[i]
    const black = mainline[i + 1]
    rows.push(
      <div key={white.id} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span className="mono" style={{ width: 26, color: '#b4b1a8', fontSize: 11, textAlign: 'right' }}>{Math.ceil(white.ply / 2)}.</span>
        {moveCell(white)}
        {moveCell(black)}
      </div>,
    )
  }

  // Go omits empty slices in the game-tree JSON, so a leaf's children can be
  // null rather than []. Treat both as an empty move list.
  const hasMoves = mainline.length > 0
  return (
    <section style={{ background: '#fff', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: '1px solid #efeee9' }}>
        <span className="lbl" style={{ color: '#b4b1a8' }}>Moves</span>
        <button onClick={() => onGoto(moveTree.id)} disabled={busy || currentNodeId === moveTree.id} style={{ border: 'none', background: 'transparent', color: currentNodeId === moveTree.id ? '#c8c5bd' : '#4a90d9', fontSize: 11, cursor: busy || currentNodeId === moveTree.id ? 'default' : 'pointer' }}>Start</button>
      </div>
      <div style={{ maxHeight: 126, overflow: 'auto', padding: hasMoves ? 6 : '10px 12px' }}>
        {hasMoves ? rows : <span style={{ color: '#a3a099', fontSize: 12 }}>Moves will appear here.</span>}
      </div>
    </section>
  )
}

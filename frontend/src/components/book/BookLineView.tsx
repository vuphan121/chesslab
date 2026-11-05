'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import type { MoveNode } from '@/lib/chess/types'
import type { LineNote } from '@/lib/books/types'
import { toFigurine } from '@/lib/chess/figurine'

interface Props {
  moveTree: MoveNode
  notes: Record<string, LineNote>
  currentNodeId: string
  busy: boolean
  onGoto: (nodeId: string) => void
}

export default function BookLineView({ moveTree, notes, currentNodeId, busy, onGoto }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const active = activeRef.current
    if (!container || !active) return
    const box = container.getBoundingClientRect()
    const rect = active.getBoundingClientRect()
    if (rect.top < box.top) container.scrollTop += rect.top - box.top - 8
    else if (rect.bottom > box.bottom) container.scrollTop += rect.bottom - box.bottom + 8
  }, [currentNodeId])

  const label = (node: MoveNode, parent: MoveNode, forceNumber: boolean) => {
    const fields = parent.fen.split(' ')
    const white = fields[1] === 'w'
    const number = fields[5] ?? '1'
    const prefix = white ? `${number}.` : forceNumber ? `${number}…` : ''
    return `${prefix}${prefix ? ' ' : ''}${toFigurine(node.san)}${notes[node.id]?.annotation ?? ''}`
  }

  const moveParts = (node: MoveNode, parent: MoveNode, forceNumber: boolean): ReactNode[] => {
    const active = node.id === currentNodeId
    const parts: ReactNode[] = []
    parts.push(
      <button
        key={`m${node.id}`}
        ref={active ? activeRef : undefined}
        disabled={busy}
        onClick={() => onGoto(node.id)}
        style={{
          border: 'none', cursor: 'pointer', padding: '1px 4px', margin: '0 1px', borderRadius: 4,
          fontSize: 13, fontWeight: 600, background: active ? '#4a90d9' : 'transparent', color: active ? '#fff' : '#37352f',
        }}
      >
        {label(node, parent, forceNumber)}
      </button>,
      ' ',
    )
    return parts
  }

  const renderChildren = (parent: MoveNode, forceNumber: boolean): ReactNode[] => {
    const kids = parent.children ?? []
    if (kids.length === 0) return []
    const [main, ...variations] = kids
    const out = moveParts(main, parent, forceNumber)
    for (const variation of variations) {
      out.push(
        <div key={`v${variation.id}`} style={variationStyle}>
          {moveParts(variation, parent, true)}
          {renderChildren(variation, false)}
        </div>,
      )
    }
    out.push(...renderChildren(main, variations.length > 0))
    return out
  }

  return (
    <div ref={containerRef} style={{ background: '#fff', border: '1px solid #eae8e2', borderRadius: 8, padding: '10px 12px', maxHeight: 420, overflowY: 'auto', lineHeight: 1.7 }}>
      {renderChildren(moveTree, false)}
    </div>
  )
}

const variationStyle: React.CSSProperties = { margin: '4px 0 4px 8px', padding: '2px 0 2px 8px', borderLeft: '2px solid #e0ddd3' }

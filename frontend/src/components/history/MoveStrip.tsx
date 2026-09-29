'use client'

import { useEffect, useRef } from 'react'
import { activeLine } from '@/lib/chess/moveTree'
import { toFigurine } from '@/lib/chess/figurine'
import type { MoveNode } from '@/lib/chess/types'

interface Props {
  moveTree: MoveNode
  currentNodeId: string
  onGotoNode: (id: string) => void
  width: number
}

export default function MoveStrip({ moveTree, currentNodeId, onGotoNode, width }: Props) {
  const line = activeLine(moveTree, currentNodeId)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const box = scrollRef.current
    const chip = box?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!box) return
    const left = chip ? chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2 : 0
    box.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [currentNodeId, line.length])

  return (
    <div
      ref={scrollRef}
      style={{
        width,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        background: '#fff',
        border: '1px solid #eae8e2',
        borderRadius: 10,
        padding: '4px 6px',
        minHeight: 44,
        boxSizing: 'border-box',
      }}
    >
      {line.length === 0 && <span style={{ fontSize: 12, color: '#a3a099', padding: '0 6px' }}>Make a move to start</span>}
      {line.map((node, i) => {
        const isCurrent = node.id === currentNodeId
        const isWhite = node.ply % 2 === 1
        const num = Math.ceil(node.ply / 2)
        const showNum = isWhite || i === 0
        return (
          <span key={node.id} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            {showNum && (
              <span className="mono" style={{ fontSize: 11, color: '#b4b1a8', padding: '0 2px 0 6px' }}>
                {num}{isWhite ? '.' : '…'}
              </span>
            )}
            <button
              onClick={() => onGotoNode(node.id)}
              aria-current={isCurrent ? 'true' : undefined}
              className="mono"
              style={{
                border: 'none',
                borderRadius: 8,
                padding: '8px 8px',
                minHeight: 36,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                background: isCurrent ? '#4a90d9' : 'transparent',
                color: isCurrent ? '#fff' : '#37352f',
                whiteSpace: 'nowrap',
              }}
            >
              {toFigurine(node.san)}
            </button>
          </span>
        )
      })}
    </div>
  )
}

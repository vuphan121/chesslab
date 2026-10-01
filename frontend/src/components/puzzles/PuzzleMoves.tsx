'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { toFigurine } from '@/lib/chess/figurine'
import type { MoveNode } from '@/lib/chess/types'

interface Props {
  nodes: MoveNode[]
  currentId: string | null
  canPrev: boolean
  canNext: boolean
  onGoto: (id: string) => void
  onPrev: () => void
  onNext: () => void
  height?: number
}

function NavBtn({ label, disabled, onClick, title }: { label: ReactNode; disabled: boolean; onClick: () => void; title: string }) {
  return (
    <button
      className="tap"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        width: 26,
        minWidth: 'var(--nav-min, 26px)',
        height: 24,
        border: '1px solid #eae8e2',
        background: '#fff',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#d6d3ca' : '#9a978f',
        fontSize: 11,
      }}
    >
      {label}
    </button>
  )
}

type Cell = { id: string; san: string }
type Row = { num: number; white?: Cell; black?: Cell }

function buildRows(nodes: MoveNode[]): Row[] {
  const rows: Row[] = []
  let pending: Row | null = null
  for (const node of nodes) {
    const cell = { id: node.id, san: toFigurine(node.san) }
    const num = Math.ceil(node.ply / 2)
    if (node.ply % 2 === 1) {
      if (pending) rows.push(pending)
      pending = { num, white: cell }
    } else if (pending && pending.num === num) {
      pending.black = cell
    } else {
      if (pending) rows.push(pending)
      pending = { num, black: cell }
    }
  }
  if (pending) rows.push(pending)
  return rows
}

export default function PuzzleMoves({ nodes, currentId, canPrev, canNext, onGoto, onPrev, onNext, height }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const rows = buildRows(nodes)

  useEffect(() => {
    const box = listRef.current
    const el = box?.querySelector<HTMLElement>('[data-active="true"]')
    if (!box || !el) return
    const b = box.getBoundingClientRect()
    const e = el.getBoundingClientRect()
    if (e.top < b.top) box.scrollTop -= b.top - e.top + 8
    else if (e.bottom > b.bottom) box.scrollTop += e.bottom - b.bottom + 8
  }, [currentId, nodes.length])

  const renderCell = (cell: Cell | undefined) => {
    if (!cell) return <span style={{ flex: 1 }} />
    const active = cell.id === currentId
    return (
      <span
        onClick={() => onGoto(cell.id)}
        data-active={active ? 'true' : undefined}
        className="mono"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'baseline',
          padding: '6px 8px',
          borderRadius: 6,
          fontSize: 14,
          cursor: 'pointer',
          background: active ? '#4a90d9' : 'transparent',
          color: active ? '#fff' : '#37352f',
          fontWeight: active ? 700 : 400,
        }}
        onMouseEnter={(e) => {
          if (!active) (e.currentTarget as HTMLElement).style.background = '#f4f3ee'
        }}
        onMouseLeave={(e) => {
          if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        {cell.san}
      </span>
    )
  }

  return (
    <div
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #efeee9' }}>
        <span className="lbl" style={{ color: '#b4b1a8' }}>Moves</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <NavBtn label="⟨" disabled={!canPrev} onClick={onPrev} title="Previous move" />
          <NavBtn label="⟩" disabled={!canNext} onClick={onNext} title="Next move" />
        </div>
      </div>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 0' }}>
        {rows.map((r, i) => (
          <div key={`${r.num}-${r.white?.id ?? r.black?.id}`} style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: '0 6px', background: i % 2 === 0 ? '#fbfaf7' : 'transparent' }}>
            <span className="mono" style={{ width: 34, flexShrink: 0, color: '#b4b1a8', fontSize: 11, textAlign: 'right', alignSelf: 'center', paddingRight: 8 }}>
              {r.white ? `${r.num}.` : `${r.num}…`}
            </span>
            {renderCell(r.white)}
            {renderCell(r.black)}
          </div>
        ))}
      </div>
    </div>
  )
}

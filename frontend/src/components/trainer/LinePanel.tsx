'use client'

import type { ReactNode } from 'react'
import { toFigurine } from '@/lib/chess/figurine'
import type { Repertoire, RepCard } from '@/lib/trainer/types'

interface RunMove {
  san: string
  uci: string
  mover: 'user' | 'opponent'
}

interface Props {
  repertoire: Repertoire
  runStartCard: RepCard
  runMoves: RunMove[]
  answerComment?: string
  viewIndex: number | null // null = live (the last position)
  onGotoPly: (index: number) => void
  onNavBack: () => void
  onNavForward: () => void
}

function NavBtn({ label, disabled, onClick, title }: { label: ReactNode; disabled?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 26,
        height: 24,
        border: '1px solid #eae8e2',
        background: '#fff',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#d6d3ca' : '#9a978f',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  )
}

export default function LinePanel({
  repertoire,
  runStartCard,
  runMoves,
  answerComment,
  viewIndex,
  onGotoPly,
  onNavBack,
  onNavForward,
}: Props) {
  const chapter = repertoire.chapters.find((c) => runStartCard.chapterIds.includes(c.id))
  const chapterName = chapter?.name ?? repertoire.name

  const liveIndex = runMoves.length
  const activeIndex = viewIndex ?? liveIndex
  const atStart = activeIndex <= 0
  const atLive = activeIndex >= liveIndex

  type Cell = { san: string; index: number }
  const rows: { num: number; white?: Cell; black?: Cell }[] = []
  let pending: { num: number; white?: Cell; black?: Cell } | null = null
  for (let i = 0; i < runMoves.length; i++) {
    const ply = runStartCard.ply + 1 + i
    const num = Math.ceil(ply / 2)
    const isWhite = ply % 2 === 1
    const cell: Cell = { san: toFigurine(runMoves[i].san), index: i + 1 }
    if (isWhite) {
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

  const renderCell = (cell: Cell | undefined) => {
    if (!cell) return <span style={{ flex: 1 }} />
    const isActive = cell.index === activeIndex
    return (
      <span
        onClick={() => onGotoPly(cell.index)}
        className="mono"
        style={{
          flex: 1,
          cursor: 'pointer',
          padding: '1px 5px',
          borderRadius: 5,
          background: isActive ? '#4a90d9' : 'transparent',
          color: isActive ? '#fff' : '#37352f',
          fontWeight: isActive ? 700 : 500,
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = '#f4f3ee'
        }}
        onMouseLeave={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        {cell.san}
      </span>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #efeee9' }}>
        <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 6 }}>
          Chapter
        </div>
        <div className="serif" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.3 }}>
          {chapterName}
        </div>
      </div>

      {/* The study's own intro/description text is deliberately never shown here —
          it can describe the position's plan while it's the user's own turn to find it. */}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 16px 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div className="lbl" style={{ color: '#b4b1a8' }}>
            Line so far
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <NavBtn label="⟨" disabled={rows.length === 0 || atStart} onClick={onNavBack} title="Back" />
            <NavBtn label="⟩" disabled={rows.length === 0 || atLive} onClick={onNavForward} title="Forward" />
          </div>
        </div>
        {rows.length === 0 ? (
          <p style={{ fontSize: 12, color: '#bbb' }}>No moves yet — make your move on the board.</p>
        ) : (
          rows.map((r) => (
            <div key={r.num} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.7 }}>
              <span className="mono" style={{ width: 22, color: '#c0bdb4', textAlign: 'right' }}>
                {r.num}.
              </span>
              {renderCell(r.white)}
              {renderCell(r.black)}
            </div>
          ))
        )}
        {!atLive && (
          <p style={{ fontSize: 11, color: '#a3a099', marginTop: 8 }}>
            Reviewing an earlier position — <a
              onClick={() => onGotoPly(liveIndex)}
              style={{ color: '#4a90d9', cursor: 'pointer', textDecoration: 'underline' }}
            >
              back to current
            </a>
          </p>
        )}
      </div>

      {answerComment && (
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #efeee9' }}>
          <p className="serif" style={{ fontSize: 13, color: '#4a4740', lineHeight: 1.5 }}>
            “{answerComment}”
          </p>
        </div>
      )}
    </div>
  )
}

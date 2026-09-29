'use client'

import { useEffect, useRef } from 'react'
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
  runChapterId?: string | null
  runMoves: RunMove[]
  leadingMoves?: RunMove[]
  isTodayTraining?: boolean
  answerComment?: string
  viewIndex: number | null
  onGotoPly: (index: number) => void
  onNavBack: () => void
  onNavForward: () => void
  onExport?: () => void
  large?: boolean
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
  runChapterId,
  runMoves,
  leadingMoves = [],
  isTodayTraining,
  answerComment,
  viewIndex,
  onGotoPly,
  onNavBack,
  onNavForward,
  onExport,
  large = false,
}: Props) {
  const chapter =
    (runChapterId ? repertoire.chapters.find((c) => c.id === runChapterId) : undefined) ??
    repertoire.chapters.find((c) => runStartCard.chapterIds.includes(c.id))
  const chapterName = chapter?.name ?? repertoire.name

  const listRef = useRef<HTMLDivElement | null>(null)
  const liveIndex = runMoves.length
  const activeIndex = viewIndex ?? liveIndex
  const atStart = activeIndex <= 0
  const atLive = activeIndex >= liveIndex

  type Cell = { san: string; index: number | null }
  const rows: { num: number; white?: Cell; black?: Cell }[] = []
  let pending: { num: number; white?: Cell; black?: Cell } | null = null
  function addCell(ply: number, cell: Cell) {
    const num = Math.ceil(ply / 2)
    const isWhite = ply % 2 === 1
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

  const leadingBasePly = runStartCard.ply - leadingMoves.length
  leadingMoves.forEach((m, j) => addCell(leadingBasePly + 1 + j, { san: toFigurine(m.san), index: null }))
  runMoves.forEach((m, i) => addCell(runStartCard.ply + 1 + i, { san: toFigurine(m.san), index: i + 1 }))
  if (pending) rows.push(pending)

  const renderCell = (cell: Cell | undefined) => {
    if (!cell) return <span style={{ flex: 1 }} />
    const clickable = cell.index !== null
    const isActive = clickable && cell.index === activeIndex
    return (
      <span
        onClick={clickable ? () => onGotoPly(cell.index as number) : undefined}
        data-active={isActive ? 'true' : undefined}
        className="mono"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'baseline',
          padding: '6px 8px',
          borderRadius: 6,
          fontSize: large ? 15 : 14,
          cursor: clickable ? 'pointer' : 'default',
          background: isActive ? '#4a90d9' : 'transparent',
          color: isActive ? '#fff' : clickable ? '#37352f' : '#a3a099',
          fontWeight: isActive ? 700 : 400,
          fontStyle: clickable ? 'normal' : 'italic',
          transition: 'background 0.1s',
        }}
        onMouseEnter={
          clickable
            ? (e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = '#f4f3ee'
              }
            : undefined
        }
        onMouseLeave={
          clickable
            ? (e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }
            : undefined
        }
      >
        {cell.san}
      </span>
    )
  }

  useEffect(() => {
    const box = listRef.current
    const el = box?.querySelector<HTMLElement>('[data-active="true"]')
    if (!box || !el) return
    const b = box.getBoundingClientRect()
    const e = el.getBoundingClientRect()
    if (e.top < b.top) box.scrollTop -= b.top - e.top + 8
    else if (e.bottom > b.bottom) box.scrollTop += e.bottom - b.bottom + 8
  }, [activeIndex, runMoves.length])

  return (
    <div
      style={{
        flex: large ? undefined : 1,
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
          {repertoire.name}
          {isTodayTraining ? ' · Today’s Training' : ''}
        </div>
        <div className="serif" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.3 }}>
          {chapterName}
        </div>
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 0' }}>
        {!large && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              padding: '4px 16px 8px',
            }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              <NavBtn label="⟨" disabled={rows.length === 0 || atStart} onClick={onNavBack} title="Back" />
              <NavBtn label="⟩" disabled={rows.length === 0 || atLive} onClick={onNavForward} title="Forward" />
            </div>
          </div>
        )}
        {rows.map((r, rowIndex) => (
          <div
            key={r.num}
            style={{
              display: 'flex',
              alignItems: 'stretch',
              gap: 4,
              padding: '0 6px',
              background: rowIndex % 2 === 0 ? '#fbfaf7' : 'transparent',
            }}
          >
            <span
              className="mono"
              style={{ width: 34, flexShrink: 0, color: '#b4b1a8', fontSize: 11, textAlign: 'right', alignSelf: 'center', paddingRight: 8 }}
            >
              {r.white ? `${r.num}.` : `${r.num}…`}
            </span>
            {renderCell(r.white)}
            {renderCell(r.black)}
          </div>
        ))}
      </div>

      {answerComment && (
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #efeee9' }}>
          <p className="serif" style={{ fontSize: 13, color: '#4a4740', lineHeight: 1.5 }}>
            “{answerComment}”
          </p>
        </div>
      )}

      {onExport && (
        <div style={{ padding: '10px 16px 12px', borderTop: '1px solid #efeee9', flexShrink: 0 }}>
          <button
            onClick={onExport}
            title="Export this line as PGN"
            aria-label="Export this line as PGN"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 34,
              background: '#f2f8fd',
              border: 'none',
              borderRadius: 9,
              padding: '0 14px',
              fontSize: 12.5,
              fontWeight: 600,
              color: '#2f6db0',
              cursor: 'pointer',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <path d="M6 1.5V8M6 8L3.5 5.5M6 8L8.5 5.5M2 10.5H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export PGN
          </button>
        </div>
      )}
    </div>
  )
}

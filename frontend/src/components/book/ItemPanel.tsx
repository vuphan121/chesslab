'use client'

import type { FlatItem } from '@/hooks/useBookStudySession'

interface Props {
  current: FlatItem
  index: number
  total: number
  busy: boolean
  onPrev: () => void
  onNext: () => void
}

export default function ItemPanel({
  current,
  index,
  total,
  busy,
  onPrev,
  onNext,
}: Props) {
  const { item } = current
  const isPuzzle = item.type === 'puzzle'
  const prompt = item.prompt.replace(/^(White|Black) to move[.:]?\s*/i, '')

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
        <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>Chapter {current.chapterNumber}</span>
          <span>
            {index + 1} / {total}
          </span>
        </div>
        <div className="serif" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.3 }}>
          {current.chapterName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <span
            className="mono"
            style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 600,
              color: isPuzzle ? '#8a5a1c' : '#2f6db0',
              background: isPuzzle ? '#fdf3e4' : '#ecf3fb',
              padding: '2px 8px',
              borderRadius: 5,
            }}
          >
            {isPuzzle ? 'Puzzle' : 'Lesson'}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 16px' }}>
        {prompt && <p style={{ fontSize: 14, color: '#37352f', lineHeight: 1.5 }}>{prompt}</p>}

        {item.note && (
          <p className="serif" style={{ fontSize: 13, color: '#4a4740', lineHeight: 1.5, marginTop: 12 }}>
            {item.note}
          </p>
        )}

      </div>

      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 16px' }}>
        <button
          onClick={onPrev}
          disabled={index === 0 || busy}
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            padding: '9px 0',
            borderRadius: 8,
            border: '1px solid #eae8e2',
            background: '#fff',
            color: index === 0 ? '#d6d3ca' : '#37352f',
            cursor: index === 0 || busy ? 'default' : 'pointer',
          }}
        >
          ⟨ Previous
        </button>
        <button
          onClick={onNext}
          disabled={busy}
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            padding: '9px 0',
            borderRadius: 8,
            border: 'none',
            background: '#4a90d9',
            color: '#fff',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Next ⟩
        </button>
      </div>
    </div>
  )
}

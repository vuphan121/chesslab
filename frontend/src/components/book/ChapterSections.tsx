'use client'

import type { FlatItem } from '@/hooks/useBookStudySession'

interface Props {
  items: FlatItem[] // every item in the current chapter, in order
  activeItemId: string
  completedItems: Set<string>
  busy: boolean
  onSelect: (globalIndex: number) => void
}

// ChapterSections is the right-hand navigation bar: one entry per item
// ("part") in the current chapter, clickable to jump straight to it —
// distinct from ItemPanel's Previous/Next, which only step one at a time.
export default function ChapterSections({ items, activeItemId, completedItems, busy, onSelect }: Props) {
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
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #efeee9' }}>
        <div className="lbl" style={{ color: '#b4b1a8' }}>
          Sections
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}>
        {items.map((flat, i) => {
          const active = flat.item.id === activeItemId
          const isPuzzle = flat.item.type === 'puzzle'
          const done = completedItems.has(flat.item.id)
          return (
            <button
              key={flat.item.id}
              onClick={() => onSelect(i)}
              disabled={busy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                marginBottom: 4,
                borderRadius: 7,
                border: 'none',
                background: active ? '#f2f8fd' : 'transparent',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              <span
                className="mono"
                style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  borderRadius: 5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: active ? '#fff' : isPuzzle ? '#8a5a1c' : '#2f6db0',
                  background: active ? '#4a90d9' : isPuzzle ? '#fdf3e4' : '#ecf3fb',
                }}
              >
                {i + 1}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: active ? '#2f6db0' : '#37352f',
                  fontWeight: active ? 600 : 500,
                }}
              >
                {isPuzzle ? 'Puzzle' : 'Lesson'}
              </span>
              {done && (
                <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 700 }} title="Completed">
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

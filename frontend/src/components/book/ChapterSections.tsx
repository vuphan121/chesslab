'use client'

import { useState } from 'react'
import type { FlatItem } from '@/hooks/useBookStudySession'

interface Props {
  items: FlatItem[]
  startIndex: number
  activeItemId: string
  completedItemIds: Set<string>
  bookmarkedItemIds: Set<string>
  busy: boolean
  onSelect: (globalIndex: number) => void
}

type Filter = 'all' | 'remaining' | 'lesson' | 'puzzle' | 'saved'

export default function ChapterSections({ items, startIndex, activeItemId, completedItemIds, bookmarkedItemIds, busy, onSelect }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const completedCount = items.filter((flat) => completedItemIds.has(flat.item.id)).length
  const visibleItems = items
    .map((flat, index) => ({ flat, index }))
    .filter(({ flat }) => filter === 'all' || (filter === 'remaining' ? !completedItemIds.has(flat.item.id) : filter === 'saved' ? bookmarkedItemIds.has(flat.item.id) : flat.item.type === filter && !completedItemIds.has(flat.item.id)))

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 11, boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #efeee9' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div className="lbl" style={{ color: '#b4b1a8' }}>Chapter progress</div>
          <span className="mono" style={{ fontSize: 11, color: '#4d8760' }}>{completedCount}/{items.length}</span>
        </div>
        <div style={{ height: 4, background: '#edf0eb', borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
          <div style={{ width: `${items.length ? (completedCount / items.length) * 100 : 0}%`, height: '100%', background: '#54ad72', transition: 'width 160ms ease' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
          {([
            ['all', 'All'],
            ['remaining', 'To do'],
            ['lesson', 'To-do lessons'],
            ['puzzle', 'To-do puzzles'],
            ['saved', 'Saved'],
          ] as [Filter, string][]).map(([value, label]) => (
            <button key={value} onClick={() => setFilter(value)} style={{ border: filter === value ? 'none' : '1px solid #e5e3dc', background: filter === value ? '#4a90d9' : '#fff', color: filter === value ? '#fff' : '#77746c', borderRadius: 5, padding: '3px 6px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}>
        {visibleItems.map(({ flat, index }) => {
          const active = flat.item.id === activeItemId
          const isPuzzle = flat.item.type === 'puzzle'
          const completed = completedItemIds.has(flat.item.id)
          return (
            <button key={flat.item.id} onClick={() => onSelect(startIndex + index)} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4, borderRadius: 7, border: 'none', background: active ? '#f2f8fd' : 'transparent', cursor: busy ? 'default' : 'pointer' }}>
              <span className="mono" style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: active ? '#fff' : isPuzzle ? '#8a5a1c' : '#2f6db0', background: active ? '#4a90d9' : isPuzzle ? '#fdf3e4' : '#ecf3fb' }}>{index + 1}</span>
              <span style={{ flex: 1, fontSize: 12, color: active ? '#2f6db0' : '#37352f', fontWeight: active ? 600 : 500 }}>{isPuzzle ? 'Puzzle' : 'Lesson'}</span>
              {bookmarkedItemIds.has(flat.item.id) && <span title="Saved" style={{ color: '#b88124', fontSize: 13 }}>★</span>}
              {completed && <span aria-label="Completed" title="Completed" style={{ color: '#2f9e5b', fontSize: 16, fontWeight: 700 }}>✓</span>}
            </button>
          )
        })}
        {visibleItems.length === 0 && <p style={{ padding: '10px 6px', color: '#a3a099', fontSize: 12 }}>Nothing here yet.</p>}
      </div>
    </div>
  )
}

'use client'

import type { SavedLine } from '@/lib/api/client'
import { toFigurine } from '@/lib/chess/figurine'

interface Props {
  lines: SavedLine[]
  busy: boolean
  onLoad: (line: SavedLine) => void
  onDelete: (id: number) => void
}

function preview(line: SavedLine): string {
  const parts: string[] = []
  line.moves.slice(0, 8).forEach((m, i) => {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`)
    parts.push(toFigurine(m.san))
  })
  const more = line.moves.length > 8 ? ' …' : ''
  return parts.join(' ') + more
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const day = 86_400_000
  if (diff < day && d.getDate() === new Date().getDate()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  if (diff < 7 * day) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function BookSavedLines({ lines, busy, onLoad, onDelete }: Props) {
  return (
    <section style={{ background: '#fff', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: '1px solid #efeee9' }}>
        <span className="lbl" style={{ color: '#b4b1a8' }}>Saved lines</span>
        {lines.length > 0 && <span style={{ fontSize: 11, color: '#c0bdb4' }}>{lines.length}</span>}
      </div>
      <div style={{ maxHeight: 150, overflow: 'auto', padding: lines.length ? 4 : '10px 12px' }}>
        {lines.length === 0 ? (
          <span style={{ color: '#a3a099', fontSize: 12 }}>Build a line, then hit “Save line” to keep it here with its evals.</span>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6 }}
            >
              <button
                onClick={() => !busy && onLoad(line)}
                disabled={busy}
                title="Load this line onto the board"
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent',
                  cursor: busy ? 'default' : 'pointer', padding: '2px 0',
                }}
                onMouseEnter={(e) => ((e.currentTarget.parentElement as HTMLElement).style.background = '#f6f5f0')}
                onMouseLeave={(e) => ((e.currentTarget.parentElement as HTMLElement).style.background = 'transparent')}
              >
                <span className="mono" style={{ fontSize: 12, color: '#37352f', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {preview(line)}
                </span>
                <span style={{ fontSize: 10, color: '#b4b1a8' }}>{line.moves.length} moves · {when(line.createdAt)}</span>
              </button>
              <button
                onClick={() => !busy && onDelete(line.id)}
                disabled={busy}
                title="Delete this saved line"
                style={{ border: 'none', background: 'transparent', color: '#c0bdb4', cursor: busy ? 'default' : 'pointer', fontSize: 13, padding: '0 4px' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#b1453b')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#c0bdb4')}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

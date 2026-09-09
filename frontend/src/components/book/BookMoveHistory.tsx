'use client'

import { useEffect, useState } from 'react'
import type { MoveNode } from '@/lib/chess/types'
import type { FenEval, SavedLine } from '@/lib/api/client'
import { toFigurine } from '@/lib/chess/figurine'

interface Props {
  moveTree: MoveNode
  currentNodeId: string
  busy: boolean
  evals: Record<string, FenEval>
  canSave: boolean
  saving: boolean
  saveNote: string | null
  savedLines: SavedLine[]
  onGoto: (nodeId: string) => void
  onDeleteMove: (nodeId: string) => void
  onSaveLine: () => void
  onLoadSavedLine: (line: SavedLine) => void
  onDeleteSavedLine: (id: number) => void
}

function fmtEval(e: FenEval | undefined): string {
  if (!e) return ''
  if (e.mate !== 0) return `#${e.mate}`
  const v = (Math.abs(e.score) / 100).toFixed(1)
  return e.score >= 0 ? `+${v}` : `−${v}`
}

function linePreview(line: SavedLine): string {
  const parts: string[] = []
  line.moves.slice(0, 8).forEach((m, i) => {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`)
    parts.push(toFigurine(m.san))
  })
  return parts.join(' ') + (line.moves.length > 8 ? ' …' : '')
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function BookMoveHistory({
  moveTree, currentNodeId, busy, evals, canSave, saving, saveNote, savedLines,
  onGoto, onDeleteMove, onSaveLine, onLoadSavedLine, onDeleteSavedLine,
}: Props) {
  const [menu, setMenu] = useState<{ nodeId: string; san: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

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
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ nodeId: move.id, san: move.san, x: e.clientX, y: e.clientY })
        }}
        disabled={busy}
        title="Right-click to delete from here"
        style={{
          flex: 1, minWidth: 0, border: 'none', borderRadius: 5, padding: '4px 6px',
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6,
          background: active ? '#dff0fb' : 'transparent', color: active ? '#1f6294' : '#37352f',
          cursor: busy ? 'default' : 'pointer', fontSize: 12,
        }}
      >
        <span className="mono" style={{ fontWeight: active ? 700 : 500 }}>{toFigurine(move.san)}</span>
        <span className="mono" style={{ fontSize: 11, color: active ? '#4b87ab' : '#a3a099' }}>{fmtEval(evals[move.fen])}</span>
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

  const hasMoves = mainline.length > 0
  const saveEnabled = canSave && !saving && !busy

  return (
    <section style={{ background: '#fff', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: '1px solid #efeee9' }}>
        <span className="lbl" style={{ color: '#b4b1a8' }}>Moves</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {saveNote && <span style={{ fontSize: 11, color: saveNote.startsWith('Saved') ? '#25864d' : '#b1453b' }}>{saveNote}</span>}
          <button
            onClick={onSaveLine}
            disabled={!saveEnabled}
            style={{
              border: `1px solid ${saveEnabled ? '#b9e5c8' : '#eae8e2'}`,
              background: saveEnabled ? '#e5f6eb' : '#f4f3ee',
              borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 700,
              color: saveEnabled ? '#25864d' : '#c8c5bd',
              cursor: saveEnabled ? 'pointer' : 'default',
            }}
          >
            {saving ? 'Saving…' : 'Save line'}
          </button>
        </div>
      </div>

      <div style={{ maxHeight: 280, overflow: 'auto', padding: hasMoves || savedLines.length ? 6 : '10px 12px' }}>
        {hasMoves && rows}
        {!hasMoves && savedLines.length === 0 && <span style={{ color: '#a3a099', fontSize: 12 }}>No moves yet</span>}

        {savedLines.length > 0 && (
          <div style={{ marginTop: hasMoves ? 8 : 0, paddingTop: hasMoves ? 8 : 0, borderTop: hasMoves ? '1px solid #efeee9' : 'none' }}>
            {savedLines.map((line) => (
              <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6 }}>
                <button
                  onClick={() => !busy && onLoadSavedLine(line)}
                  disabled={busy}
                  title="Load this saved line onto the board"
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', padding: '2px 0' }}
                  onMouseEnter={(e) => ((e.currentTarget.parentElement as HTMLElement).style.background = '#f4f3ee')}
                  onMouseLeave={(e) => ((e.currentTarget.parentElement as HTMLElement).style.background = 'transparent')}
                >
                  <span className="mono" style={{ fontSize: 12, color: '#37352f', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ★ {linePreview(line)}
                  </span>
                  <span style={{ fontSize: 10, color: '#b4b1a8' }}>{line.moves.length} moves · {when(line.createdAt)}</span>
                </button>
                <button
                  onClick={() => !busy && onDeleteSavedLine(line.id)}
                  disabled={busy}
                  title="Delete this saved line"
                  style={{ border: 'none', background: 'transparent', color: '#c0bdb4', cursor: busy ? 'default' : 'pointer', fontSize: 13, padding: '0 4px' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#b1453b')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#c0bdb4')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {menu && (
        <div
          style={{
            position: 'fixed', left: Math.min(menu.x, window.innerWidth - 190), top: menu.y,
            background: '#fff', border: '1px solid #e6e4dd', borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,.14)', padding: 4, zIndex: 1000, minWidth: 176,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onDeleteMove(menu.nodeId); setMenu(null) }}
            style={{
              width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
              padding: '7px 10px', borderRadius: 6, fontSize: 12, color: '#b1453b', cursor: 'pointer',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#fbeceb')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          >
            Delete {toFigurine(menu.san)} and later moves
          </button>
        </div>
      )}
    </section>
  )
}

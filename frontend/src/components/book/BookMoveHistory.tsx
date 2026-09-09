'use client'

import { useEffect, useState } from 'react'
import type { MoveNode } from '@/lib/chess/types'
import type { FenEval } from '@/lib/api/client'
import { toFigurine } from '@/lib/chess/figurine'

interface Props {
  moveTree: MoveNode
  currentNodeId: string
  busy: boolean
  evals: Record<string, FenEval>
  canSave: boolean
  saving: boolean
  saveNote: string | null
  hasSaved: boolean
  onGoto: (nodeId: string) => void
  onDeleteMove: (nodeId: string) => void
  onSaveLine: () => void
  onRestore: () => void
}

function fmtEval(e: FenEval | undefined): string {
  if (!e) return ''
  if (e.mate !== 0) return `#${e.mate}`
  const v = (Math.abs(e.score) / 100).toFixed(1)
  return e.score >= 0 ? `+${v}` : `−${v}`
}

export default function BookMoveHistory({
  moveTree, currentNodeId, busy, evals, canSave, saving, saveNote, hasSaved,
  onGoto, onDeleteMove, onSaveLine, onRestore,
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
          {hasSaved && (
            <button
              onClick={onRestore}
              disabled={busy}
              title="Reload the saved line onto the board"
              style={{ border: 'none', background: 'transparent', color: busy ? '#c8c5bd' : '#8a8780', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
            >
              ↺ Restore
            </button>
          )}
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
            {saving ? 'Saving…' : hasSaved ? 'Update line' : 'Save line'}
          </button>
        </div>
      </div>

      <div style={{ maxHeight: 280, overflow: 'auto', padding: hasMoves ? 6 : '10px 12px' }}>
        {hasMoves ? rows : <span style={{ color: '#a3a099', fontSize: 12 }}>No moves yet</span>}
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

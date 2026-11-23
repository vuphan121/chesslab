'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MoveNode } from '@/lib/chess/types'
import type { FenEval } from '@/lib/api/client'
import { toFigurine } from '@/lib/chess/figurine'
import { flatten } from '@/lib/chess/moveTree'

interface Props {
  moveTree: MoveNode
  currentNodeId: string
  busy: boolean
  evals: Record<string, FenEval>
  hasSaved: boolean
  onGoto: (nodeId: string) => void
  onDeleteMove: (nodeId: string) => void
  onPromoteMove: (nodeId: string) => void
  onRestore: () => void
}

function fmtEval(e: FenEval | undefined): string {
  if (!e) return ''
  if (e.mate !== 0) return `#${e.mate}`
  const v = (Math.abs(e.score) / 100).toFixed(1)
  return e.score >= 0 ? `+${v}` : `−${v}`
}

export default function BookMoveHistory({
  moveTree, currentNodeId, busy, evals, hasSaved,
  onGoto, onDeleteMove, onPromoteMove, onRestore,
}: Props) {
  const [menu, setMenu] = useState<{ nodeId: string; san: string; x: number; y: number; canPromote: boolean } | null>(null)

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

  const flat = useMemo(() => flatten(moveTree), [moveTree])

  const offMainline = (nodeId: string): boolean => {
    for (let entry = flat.get(nodeId); entry && entry.parentId !== null; entry = flat.get(entry.parentId)) {
      const parent = flat.get(entry.parentId)?.node
      if (parent && parent.children?.[0]?.id !== entry.node.id) return true
    }
    return false
  }

  const moveButton = (node: MoveNode, parent: MoveNode, forceNumber: boolean, sideline: boolean, hidePrefix = false): ReactNode => {
    const active = node.id === currentNodeId
    const fields = parent.fen.split(' ')
    const white = fields[1] === 'w'
    const number = fields[5] ?? '1'
    const prefix = hidePrefix ? '' : white ? `${number}.` : forceNumber ? `${number}…` : ''
    const evalText = fmtEval(evals[node.fen])
    return (
      <button
        key={`m${node.id}`}
        onClick={() => onGoto(node.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ nodeId: node.id, san: node.san, x: e.clientX, y: e.clientY, canPromote: offMainline(node.id) })
        }}
        disabled={busy}
        title="Right-click for options"
        style={{
          border: 'none', borderRadius: 5, padding: '2px 5px', margin: '0 1px',
          background: active ? '#dff0fb' : 'transparent', color: active ? '#1f6294' : sideline ? '#6a675f' : '#37352f',
          cursor: busy ? 'default' : 'pointer', fontSize: sideline ? 12 : 13,
        }}
      >
        {prefix && <span className="mono" style={{ color: '#b4b1a8', fontSize: 11, marginRight: 3 }}>{prefix}</span>}
        <span className="mono" style={{ fontWeight: active || !sideline ? 700 : 500 }}>{toFigurine(node.san)}</span>
        {evalText && <span className="mono" style={{ fontSize: 10, marginLeft: 4, color: active ? '#4b87ab' : '#a3a099' }}>{evalText}</span>}
      </button>
    )
  }

  type Entry = { node: MoveNode; parent: MoveNode }

  const renderLine = (start: Entry, depth: number): ReactNode => {
    const chain: Entry[] = []
    const subs: Entry[] = []
    for (let cur: Entry | null = start; cur; ) {
      chain.push(cur)
      const kids: MoveNode[] = cur.node.children ?? []
      for (const v of kids.slice(1)) subs.push({ node: v, parent: cur.node })
      cur = kids[0] ? { node: kids[0], parent: cur.node } : null
    }
    return (
      <div key={`l${start.node.id}`}>
        <div style={{ margin: `1px 0 3px ${28 + Math.min(depth, 2) * 10}px`, padding: '0 0 0 10px', borderLeft: '2px solid #e0ddd3', lineHeight: 1.7 }}>
          {chain.map((e, i) => moveButton(e.node, e.parent, i === 0, true))}
        </div>
        {subs.map((s) => renderLine(s, depth + 1))}
      </div>
    )
  }

  const renderMainline = (): ReactNode[] => {
    const entries: Entry[] = []
    for (let p = moveTree; p.children?.[0]; p = p.children[0]) entries.push({ node: p.children[0], parent: p })
    const rows: { number: string; white?: Entry; black?: Entry }[] = []
    for (const e of entries) {
      const fields = e.parent.fen.split(' ')
      const number = fields[5] ?? '1'
      const last = rows[rows.length - 1]
      if (fields[1] === 'w') rows.push({ number, white: e })
      else if (last && last.white && !last.black) last.black = e
      else rows.push({ number, black: e })
    }
    const out: ReactNode[] = []
    for (const row of rows) {
      out.push(
        <div key={`r${(row.white ?? row.black)!.node.id}`} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 1fr', alignItems: 'center' }}>
          <span className="mono" style={{ color: '#b4b1a8', fontSize: 11 }}>{row.number}.</span>
          <span>{row.white ? moveButton(row.white.node, row.white.parent, false, false, true) : <span className="mono" style={{ color: '#b4b1a8', fontSize: 11 }}>…</span>}</span>
          <span>{row.black && moveButton(row.black.node, row.black.parent, false, false, true)}</span>
        </div>,
      )
      for (const e of [row.white, row.black]) {
        if (!e) continue
        for (const v of (e.parent.children ?? []).slice(1)) out.push(renderLine({ node: v, parent: e.parent }, 0))
      }
    }
    return out
  }

  const hasMoves = (moveTree.children?.length ?? 0) > 0

  return (
    <section style={{ background: '#fff', borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: '1px solid #efeee9' }}>
        <span className="lbl" style={{ color: '#b4b1a8' }}>Moves</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {hasSaved && (
            <button
              onClick={onRestore}
              disabled={busy}
              title="Reload the saved lines onto the board"
              style={{ border: 'none', background: 'transparent', color: busy ? '#c8c5bd' : '#8a8780', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
            >
              ↺ Restore
            </button>
          )}
        </div>
      </div>

      <div style={{ maxHeight: 320, overflow: 'auto', padding: hasMoves ? '8px 10px' : '10px 12px', lineHeight: 1.8 }}>
        {hasMoves ? renderMainline() :<span style={{ color: '#a3a099', fontSize: 12 }}>Play a move on the board to start a line</span>}
      </div>

      {menu && (
        <div
          style={{
            position: 'fixed', left: Math.min(menu.x, window.innerWidth - 220), top: menu.y,
            background: '#fff', border: '1px solid #e6e4dd', borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,.14)', padding: 4, zIndex: 1000, minWidth: 200,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.canPromote && (
            <button
              onClick={() => { onPromoteMove(menu.nodeId); setMenu(null) }}
              style={menuItem('#37352f')}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f1f0ea')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
              Make {toFigurine(menu.san)} the main line
            </button>
          )}
          <button
            onClick={() => { onDeleteMove(menu.nodeId); setMenu(null) }}
            style={menuItem('#b1453b')}
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

function menuItem(color: string): React.CSSProperties {
  return { width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '7px 10px', borderRadius: 6, fontSize: 12, color, cursor: 'pointer', display: 'block' }
}

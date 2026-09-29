'use client'

import type { ExplorerMove } from '@/lib/api/client'

function formatGames(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

interface Props {
  moves: ExplorerMove[]
  loading: boolean
  height?: number
  onPlay: (uci: string) => void
}

function TreeRow({ m, isTop, onPlay }: { m: ExplorerMove; isTop: boolean; onPlay: () => void }) {
  return (
    <div
      onClick={onPlay}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '13px 20px',
        borderBottom: '1px solid #f6f5f0',
        background: isTop ? '#f5fafd' : undefined,
        cursor: 'pointer',
      }}
    >
      <div className="mono" style={{ width: 46, flexShrink: 0, fontWeight: 700, fontSize: 16 }}>
        {m.san}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: '#7a776f',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {m.openingName ?? 'Unnamed'} ·{' '}
            <span className="mono" style={{ fontSize: 11, color: '#a3a099' }}>
              {formatGames(m.games)}
            </span>
          </span>
          <span
            className="mono"
            style={{ fontSize: 14, fontWeight: 700, color: '#2f6db0', flexShrink: 0 }}
          >
            {m.sharePct.toFixed(0)}%
          </span>
        </div>
        <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
          <div style={{ width: `${m.whitePct}%`, background: '#e6e6e1' }} />
          <div style={{ width: `${m.drawPct}%`, background: '#b9b9b5' }} />
          <div style={{ width: `${m.blackPct}%`, background: '#44454a' }} />
        </div>
      </div>
    </div>
  )
}

export default function OpeningTree({ moves, loading, onPlay, height = 260 }: Props) {
  return (
    <div
      style={{
        width: '100%',
        height,
        flexShrink: 0,
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '17px 20px 14px', borderBottom: '1px solid #efeee9' }}>
        <span className="lbl" style={{ color: '#b4b1a8' }}>
          Opening Tree
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 20px',
          borderBottom: '1px solid #f4f3ee',
          fontSize: 10.5,
          color: '#b4b1a8',
          fontWeight: 600,
          letterSpacing: '0.3px',
        }}
      >
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, background: '#e6e6e1', borderRadius: 2 }} />
          White
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, background: '#b9b9b5', borderRadius: 2 }} />
          Draw
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, background: '#44454a', borderRadius: 2 }} />
          Black
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {moves.length === 0 && (
          <div style={{ padding: '16px 20px', fontSize: 12, color: '#bbb' }}>
            {loading ? 'Loading…' : 'No database moves for this position'}
          </div>
        )}
        {moves.map((m, i) => (
          <TreeRow key={m.uci} m={m} isTop={i === 0} onPlay={() => onPlay(m.uci)} />
        ))}
      </div>
    </div>
  )
}

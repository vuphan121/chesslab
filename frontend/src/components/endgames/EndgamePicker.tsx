'use client'

import { ENDGAME_GROUPS, ENDGAME_POSITIONS, type EndgamePosition } from '@/lib/endgame/positions'

interface Props {
  done: Set<string>
  onRandom: () => void
  onPick: (position: EndgamePosition) => void
}

export default function EndgamePicker({ done, onRandom, onPick }: Props) {
  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '24px auto 0', padding: '0 clamp(12px, 4vw, 24px)' }}>
      <h1 className="serif" style={{ fontSize: 24, fontWeight: 400, marginBottom: 14 }}>Endgames</h1>

      <button onClick={onRandom} className="tap" style={randomButton}>
        <span className="serif" style={{ fontSize: 20 }}>Random position</span>
      </button>

      {ENDGAME_GROUPS.map((group) => {
        const positions = ENDGAME_POSITIONS.filter((p) => p.group === group.key)
        if (positions.length === 0) return null
        return (
          <section key={group.key} style={{ margin: '22px 0 0' }}>
            <h2 className="lbl" style={{ color: '#a3a099', margin: '0 0 8px' }}>{group.label}</h2>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {positions.map((p) => (
                <button key={p.id} onClick={() => onPick(p)} className="tap" style={tile}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#37352f', textAlign: 'left' }}>
                    {p.name}
                    {done.has(p.id) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2e8b57" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="Done">
                        <polyline points="4 12 10 18 20 6" />
                      </svg>
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      padding: '2px 7px',
                      background: p.goal === 'win' ? '#e8f3fd' : '#eceae4',
                      color: p.goal === 'win' ? '#2f6db0' : '#6a675f',
                    }}
                  >
                    {p.goal === 'win' ? 'Win' : 'Draw'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

const randomButton: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  padding: '16px 20px',
  border: 'none',
  borderRadius: 10,
  background: '#4a90d9',
  color: '#fff',
  cursor: 'pointer',
  textAlign: 'left',
}

const tile: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '10px 12px',
  background: '#fbfaf7',
  border: '1px solid #eae8e2',
  borderRadius: 10,
  cursor: 'pointer',
}

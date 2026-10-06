'use client'

import { useState } from 'react'
import { OBJECTIVES } from '@/lib/endgame/custom'
import { groupsFor, type EndgamePosition } from '@/lib/endgame/positions'

interface Props {
  customs: EndgamePosition[]
  onNew: () => void
  onEdit: (position: EndgamePosition) => void
  onDelete: (id: string) => void
  onTry: (position: EndgamePosition) => void
  onBack: () => void
}

export default function EndgameManager({ customs, onNew, onEdit, onDelete, onTry, onBack }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const groupLabel = (key: string) => groupsFor(customs).find((g) => g.key === key)?.label ?? key
  const objectiveLabel = (p: EndgamePosition) => OBJECTIVES.find((o) => o.key === p.objective)?.label ?? ''

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '24px auto 0', padding: '0 clamp(12px, 4vw, 24px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button className="tap" onClick={onBack} aria-label="Back to endgames" style={backButton}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 1.5L2.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <h1 className="serif" style={{ fontSize: 24, fontWeight: 400, margin: 0 }}>Your positions</h1>
      </div>

      <button onClick={onNew} className="tap" style={newButton}>
        <span className="serif" style={{ fontSize: 20 }}>New position</span>
      </button>

      {customs.length === 0 ? (
        <p style={{ color: '#a3a099', fontSize: 14, marginTop: 18 }}>No custom positions yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
          {customs.map((p) => (
            <div key={p.id} style={row}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#37352f', overflowWrap: 'anywhere' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#6a675f' }}>{groupLabel(p.group)} · {objectiveLabel(p)}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="tap" onClick={() => onTry(p)} style={smallButton}>Try</button>
                <button className="tap" onClick={() => onEdit(p)} style={smallButton}>Edit</button>
                {confirming === p.id ? (
                  <>
                    <button className="tap" onClick={() => { setConfirming(null); onDelete(p.id) }} style={{ ...smallButton, color: '#b34343', borderColor: '#e8b4b4', background: '#fdecec' }}>
                      Confirm delete
                    </button>
                    <button className="tap" onClick={() => setConfirming(null)} style={smallButton}>Keep</button>
                  </>
                ) : (
                  <button className="tap" onClick={() => setConfirming(p.id)} style={smallButton}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const backButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  fontSize: 13,
  fontWeight: 600,
  color: '#6a675f',
  background: '#f0efe9',
  border: 'none',
  padding: '0 12px',
  borderRadius: 8,
  cursor: 'pointer',
}

const newButton: React.CSSProperties = {
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

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  padding: '10px 12px',
  background: '#fbfaf7',
  border: '1px solid #eae8e2',
  borderRadius: 10,
}

const smallButton: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #d9d6cf',
  background: '#fff',
  color: '#37352f',
  cursor: 'pointer',
}

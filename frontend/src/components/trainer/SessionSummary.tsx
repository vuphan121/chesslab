'use client'

import type { SessionSummary as Summary } from '@/lib/trainer/types'
import type { RepCard } from '@/lib/trainer/types'

interface Props {
  summary: Summary
  cardById: (id: string) => RepCard | undefined
  onDrillMistakes: () => void
  onSameAgain: () => void
  onChangeRepertoire: () => void
}

export default function SessionSummary({ summary, cardById, onDrillMistakes, onSameAgain, onChangeRepertoire }: Props) {
  const accuracy =
    summary.correct + summary.incorrect > 0
      ? Math.round((summary.correct / (summary.correct + summary.incorrect)) * 100)
      : 0

  return (
    <div
      style={{
        width: 'min(720px, calc(100vw - 32px))',
        margin: '24px auto',
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        padding: 'clamp(16px, 4vw, 28px)',
      }}
    >
      <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, marginBottom: 6 }}>
        You drilled {summary.cardsSeen} position{summary.cardsSeen === 1 ? '' : 's'} in {summary.steps} steps
      </h1>
      <p className="mono" style={{ fontSize: 28, fontWeight: 700, color: '#37352f', marginBottom: 20 }}>
        {accuracy}% <span style={{ fontSize: 13, fontWeight: 500, color: '#a3a099' }}>accuracy</span>
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <Stat label="Correct" value={summary.correct} color="oklch(0.48 0.11 155)" />
        <Stat label="Incorrect" value={summary.incorrect} color="oklch(0.5 0.16 25)" />
        <Stat label="Learned" value={summary.learned.length} color="#4a90d9" />
      </div>

      {summary.missed.length > 0 && (
        <>
          <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
            Needs work
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 24 }}>
            {summary.missed.slice(0, 6).map((m) => {
              const card = cardById(m.cardId)
              const primary = card?.answers.find((a) => a.primary) ?? card?.answers[0]
              return (
                <div key={m.cardId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span className="mono">{primary?.san ?? m.cardId}</span>
                  <span style={{ color: '#c0392b', fontSize: 12 }}>×{m.lapses}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button onClick={onChangeRepertoire} style={btnStyle(false)}>
          Change repertoire
        </button>
        <button onClick={onSameAgain} style={btnStyle(false)}>
          Same again
        </button>
        <button onClick={onDrillMistakes} disabled={summary.missed.length === 0} style={btnStyle(true)}>
          Drill mistakes
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: '1 1 90px', textAlign: 'center', padding: '10px 0', background: '#fbfaf7', borderRadius: 8 }}>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#a3a099', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: '9px 16px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid #eae8e2',
    background: primary ? '#4a90d9' : '#fff',
    color: primary ? '#fff' : '#37352f',
    cursor: 'pointer',
  }
}

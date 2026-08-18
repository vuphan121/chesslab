'use client'

import { useState } from 'react'
import { importRepertoire, refreshRepertoire } from '@/lib/api/client'
import type { RepertoireSummary } from '@/lib/trainer/types'

interface Props {
  repertoires: RepertoireSummary[]
  onClose: () => void
  onChanged: () => void
}

export default function RepertoireManagement({ repertoires, onClose, onChanged }: Props) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [name, setName] = useState('')
  const [side, setSide] = useState<'w' | 'b'>('w')
  const [description, setDescription] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const add = async () => {
    setBusyId('new')
    setError(null)
    setSuccess(null)
    try {
      const rep = await importRepertoire({ sourceUrl, name, side, description })
      setSourceUrl('')
      setName('')
      setDescription('')
      setSuccess(`${rep.name} was added with ${rep.cardCount} positions.`)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add repertoire.')
    } finally {
      setBusyId(null)
    }
  }

  const refresh = async (rep: RepertoireSummary) => {
    setBusyId(rep.id)
    setError(null)
    setSuccess(null)
    try {
      const updated = await refreshRepertoire(rep.id)
      setSuccess(`${updated.name} was refreshed: ${updated.chapters.length} chapters and ${updated.cardCount} positions.`)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh repertoire.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ width: 'min(720px, calc(100vw - 32px))', margin: '24px auto', background: '#fff', borderRadius: 11, boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)', padding: 'clamp(16px, 4vw, 28px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', marginBottom: 8 }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500 }}>Repertoire management</h1>
        <button onClick={onClose} style={quietButton}>Back to study</button>
      </div>
      <p style={{ fontSize: 13, color: '#6a675f', marginBottom: 22 }}>Add a Lichess study or refresh one after you add chapters. Every refresh downloads the complete study and rebuilds all lines from the start.</p>

      <section style={{ padding: 15, border: '1px solid #d8e8f7', background: '#f7fbff', borderRadius: 9, marginBottom: 24 }}>
        <div className="lbl" style={{ color: '#5c86ad', marginBottom: 12 }}>Add a repertoire</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://lichess.org/study/abcdefgh" style={fieldStyle} />
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Repertoire name" style={fieldStyle} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={side} onChange={(event) => setSide(event.target.value as 'w' | 'b')} style={{ ...fieldStyle, width: 100 }}>
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" style={{ ...fieldStyle, flex: 1, minWidth: 180 }} />
            <button onClick={add} disabled={busyId !== null} style={primaryButton}>{busyId === 'new' ? 'Adding…' : 'Add repertoire'}</button>
          </div>
        </div>
      </section>

      <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>Existing repertoires</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {repertoires.map((rep) => {
          const refreshable = rep.source.includes('lichess.org/study/')
          return (
            <div key={rep.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', border: '1px solid #eae8e2', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{rep.name}</div>
                <div style={{ fontSize: 11, color: '#a3a099', marginTop: 2 }}>{rep.chapters.length} chapters · {rep.cardCount} positions</div>
              </div>
              {refreshable ? <button onClick={() => refresh(rep)} disabled={busyId !== null} style={quietButton}>{busyId === rep.id ? 'Updating…' : 'Update'}</button> : <span style={{ fontSize: 11, color: '#a3a099' }}>No study source</span>}
            </div>
          )
        })}
      </div>
      {error && <p style={{ color: '#c0392b', fontSize: 12, marginTop: 14 }}>{error}</p>}
      {success && <p style={{ color: '#2f8a56', fontSize: 12, marginTop: 14 }}>{success}</p>}
    </div>
  )
}

const fieldStyle: React.CSSProperties = { fontSize: 13, padding: '8px 10px', borderRadius: 7, border: '1px solid #cfe0ee', background: '#fff', color: '#37352f' }
const primaryButton: React.CSSProperties = { fontSize: 12, fontWeight: 700, padding: '9px 13px', borderRadius: 7, border: 'none', background: '#4a90d9', color: '#fff', cursor: 'pointer' }
const quietButton: React.CSSProperties = { fontSize: 12, fontWeight: 700, padding: '7px 10px', borderRadius: 7, border: '1px solid #dbe8f4', background: '#fff', color: '#3974ad', cursor: 'pointer', whiteSpace: 'nowrap' }

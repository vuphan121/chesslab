'use client'

import { useMemo, useState } from 'react'
import type { PuzzleTheme } from '@/lib/api/client'
import { THEME_CATEGORIES, prettyTheme } from '@/lib/puzzle/themes'

interface Props {
  themes: PuzzleTheme[] | null
  error: string | null
  onMixed: () => void
  onTheme: (key: string) => void
  onRetry: () => void
}

export default function ThemePicker({ themes, error, onMixed, onTheme, onRetry }: Props) {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    return THEME_CATEGORIES.map((category) => ({
      ...category,
      themes: (themes ?? []).filter((t) => t.category === category.key && (!q || prettyTheme(t.key).toLowerCase().includes(q))),
    })).filter((section) => section.themes.length > 0)
  }, [themes, query])

  return (
    <div style={{ width: '100%', maxWidth: 980, margin: '24px auto 0', padding: '0 clamp(12px, 4vw, 24px)' }}>
      <h1 className="serif" style={{ fontSize: 24, fontWeight: 400, marginBottom: 14 }}>Puzzles</h1>

      {error && (
        <p role="alert" style={{ color: '#b34343', fontSize: 13, marginBottom: 12 }}>
          {error}{' '}
          <button onClick={onRetry} style={{ color: '#2f6db0', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button>
        </p>
      )}
      {!themes && !error && <p style={{ color: '#a3a099', fontSize: 14 }}>Loading themes…</p>}

      {themes && themes.length === 0 && (
        <div style={{ ...card, color: '#6a675f', fontSize: 14 }}>
          No puzzles are loaded yet. Import the Lichess puzzle database on the backend with <code>go run ./cmd/importpuzzles</code>.
        </div>
      )}

      {themes && themes.length > 0 && (
        <>
          <button onClick={onMixed} className="tap" style={mixedButton}>
            <span className="serif" style={{ fontSize: 20 }}>Mixed themes</span>
            <span style={{ fontSize: 13, opacity: 0.85 }}>A random theme each puzzle</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 10px' }}>
            <span className="lbl" style={{ color: '#a3a099' }}>Or choose a theme</span>
            <span style={{ flex: 1 }} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search themes"
              aria-label="Search themes"
              style={{ width: 200, maxWidth: '50%', border: '1px solid #d9d6cf', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: '#fbfaf7', color: '#37352f', outlineColor: '#4a90d9' }}
            />
          </div>

          {sections.map((section) => (
            <section key={section.key} style={{ marginBottom: 18 }}>
              <h2 className="lbl" style={{ color: '#a3a099', margin: '0 0 8px' }}>{section.label}</h2>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {section.themes.map((t) => (
                  <button key={t.key} onClick={() => onTheme(t.key)} className="tap" style={tile} title={t.played ? `${t.wins} of ${t.attempts} solved` : 'Not played yet'}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#37352f', textAlign: 'left' }}>{prettyTheme(t.key)}</span>
                    <span className="mono" style={{ fontSize: 14, color: t.played ? '#2f6db0' : '#a3a099' }}>{t.rating}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {sections.length === 0 && <p style={{ color: '#a3a099', fontSize: 13 }}>No theme matches that search.</p>}
        </>
      )}
    </div>
  )
}

const card: React.CSSProperties = { background: '#fbfaf7', border: '1px solid #eae8e2', borderRadius: 10, padding: '16px 18px' }

const mixedButton: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
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

'use client'

import { FormEvent, useEffect, useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import { deleteSavedPuzzle, listSavedPuzzles, savePuzzle, type SavedPuzzle } from '@/lib/api/client'

const PAGE_WIDTH = 840

function friendlyDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

export default function SavedPuzzlesPage() {
  const [puzzles, setPuzzles] = useState<SavedPuzzle[]>([])
  const [url, setURL] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removingID, setRemovingID] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listSavedPuzzles()
      .then(({ puzzles }) => setPuzzles(puzzles))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load saved puzzles.'))
      .finally(() => setLoading(false))
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!url.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await savePuzzle(url.trim())
      setPuzzles((current) => [saved, ...current.filter((puzzle) => puzzle.id !== saved.id)])
      setURL('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that puzzle.')
    } finally {
      setSaving(false)
    }
  }

  async function removePuzzle(id: number) {
    setRemovingID(id)
    setError(null)
    try {
      await deleteSavedPuzzle(id)
      setPuzzles((current) => current.filter((puzzle) => puzzle.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that puzzle.')
    } finally {
      setRemovingID(null)
    }
  }

  return (
    <main className="min-h-screen py-6 sm:py-10" style={{ background: 'linear-gradient(135deg, #f1f0e9 0%, #eef1f0 52%, #e9edef 100%)' }}>
      <div style={{ width: '100%', maxWidth: PAGE_WIDTH, margin: '0 auto', padding: '0 24px' }}>
        <TopBar right={<span />} />

        <section style={{ background: '#fff', borderRadius: 14, padding: 'clamp(22px, 5vw, 38px)', boxShadow: '0 1px 4px rgba(0,0,0,0.07), inset 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <div style={{ marginBottom: 26 }}>
            <div className="lbl" style={{ color: '#4a90d9', marginBottom: 7 }}>Puzzle collection</div>
          </div>

          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <label htmlFor="puzzle-url" className="sr-only">ChessTempo puzzle URL</label>
            <input
              id="puzzle-url"
              type="url"
              required
              value={url}
              onChange={(event) => setURL(event.target.value)}
              placeholder="https://chesstempo.com/chess-tactics/..."
              style={{ minWidth: 0, flex: 1, border: '1px solid #d9d6cf', borderRadius: 8, padding: '10px 12px', color: '#37352f', fontSize: 14, outlineColor: '#4a90d9' }}
            />
            <button type="submit" disabled={saving || !url.trim()} style={{ border: 'none', borderRadius: 8, padding: '0 17px', background: saving || !url.trim() ? '#a8c7e6' : '#4a90d9', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving || !url.trim() ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {saving ? 'Saving…' : 'Save puzzle'}
            </button>
          </form>

          {error && <p role="alert" style={{ color: '#b34343', fontSize: 13, marginTop: 12 }}>{error}</p>}

          <div style={{ marginTop: 30 }}>
            <div className="lbl" style={{ color: '#a3a099', marginBottom: 10 }}>Your saved links</div>
            {loading ? (
              <p style={{ color: '#a3a099', fontSize: 14 }}>Loading puzzles…</p>
            ) : puzzles.length === 0 ? (
              <div style={{ border: '1px dashed #d9d6cf', borderRadius: 10, padding: '22px 18px', color: '#85817a', fontSize: 14 }}>Nothing saved yet — your favorite ChessTempo puzzles will appear here.</div>
            ) : (
              <div style={{ borderTop: '1px solid #eceae5' }}>
                {puzzles.map((puzzle) => (
                  <div key={puzzle.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 4px', borderBottom: '1px solid #eceae5' }}>
                    <span aria-hidden="true" style={{ color: '#4a90d9', fontSize: 18 }}>♟</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <a href={puzzle.url} target="_blank" rel="noreferrer" style={{ display: 'block', overflow: 'hidden', color: '#2f6db0', fontSize: 14, fontWeight: 600, textDecoration: 'none', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{puzzle.url}</a>
                      <div style={{ color: '#a3a099', fontSize: 12, marginTop: 3 }}>Saved {friendlyDate(puzzle.createdAt)}</div>
                    </div>
                    <button onClick={() => removePuzzle(puzzle.id)} disabled={removingID === puzzle.id} style={{ border: 'none', background: 'transparent', color: '#9b625d', fontSize: 12, fontWeight: 600, cursor: removingID === puzzle.id ? 'default' : 'pointer', padding: '6px 4px' }}>
                      {removingID === puzzle.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

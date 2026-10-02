'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import { getStatistics, syncPuzzles, type StatisticsResponse } from '@/lib/api/client'
import { ActivityLanes, Card, RatingChart, RepertoireProgress, StatTile, ThemeRatings, TroubleSpots } from '@/components/statistics/charts'

type Mode = 'week' | 'month' | 'custom'
interface Range {
  mode: Mode
  from: string
  to: string
}

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'week', label: 'This week' },
  { mode: 'month', label: 'This month' },
  { mode: 'custom', label: 'Custom' },
]
const RANGE_KEY = 'chesslab.statistics.range'
const ISO = /^\d{4}-\d{2}-\d{2}$/

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function presetRange(mode: 'week' | 'month'): Range {
  const now = new Date()
  const start = mode === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  return { mode, from: iso(start), to: iso(now) }
}

function loadRange(): Range {
  try {
    const saved = JSON.parse(localStorage.getItem(RANGE_KEY) ?? 'null')
    if (saved?.mode === 'week' || saved?.mode === 'month') return presetRange(saved.mode)
    if (saved?.mode === 'custom' && ISO.test(saved.from) && ISO.test(saved.to) && saved.from <= saved.to) return saved
  } catch {}
  return presetRange('month')
}

function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

function ago(iso?: string): string {
  if (!iso) return 'never'
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h ago`
  return `${Math.round(mins / 1440)} days ago`
}

export default function StatisticsPage() {
  const [range, setRange] = useState<Range>(loadRange)
  const [stats, setStats] = useState<StatisticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const latestRequest = useRef(0)

  const load = useCallback((from: string, to: string) => {
    const id = ++latestRequest.current
    getStatistics(from, to)
      .then((r) => {
        if (id !== latestRequest.current) return
        setError(null)
        setStats(r)
      })
      .catch((err: unknown) => {
        if (id !== latestRequest.current) return
        setError(err instanceof Error ? err.message : 'Could not load statistics.')
      })
  }, [])

  useEffect(() => {
    load(range.from, range.to)
  }, [range.from, range.to, load])

  function applyRange(next: Range) {
    setRange(next)
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(next))
    } catch {}
  }

  function pickMode(mode: Mode) {
    applyRange(mode === 'custom' ? { mode, from: range.from, to: range.to } : presetRange(mode))
  }

  function pickDate(edge: 'from' | 'to', value: string) {
    if (!ISO.test(value)) return
    const next = { ...range, mode: 'custom' as const, [edge]: value }
    if (next.from > next.to) {
      if (edge === 'from') next.to = value
      else next.from = value
    }
    applyRange(next)
  }

  async function onSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      await syncPuzzles()
      load(range.from, range.to)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Could not sync puzzles.')
    } finally {
      setSyncing(false)
    }
  }

  const totals = stats?.totals

  return (
    <main className="min-h-screen pb-6 sm:pb-10" style={{ background: '#e8e8e6' }}>
      <TopBar right={<span />} />
      <div style={{ width: '100%', maxWidth: 980, margin: '24px auto 0', padding: '0 clamp(12px, 4vw, 24px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <h1 className="serif" style={{ fontSize: 24, fontWeight: 400 }}>Statistics</h1>
          <span style={{ flex: 1 }} />
          <div role="group" aria-label="Time range" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MODES.map(({ mode, label }) => {
              const active = range.mode === mode
              return (
                <button
                  key={mode}
                  onClick={() => pickMode(mode)}
                  aria-pressed={active}
                  className="tap"
                  style={{
                    fontSize: 12,
                    padding: '4px 12px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    border: `1px solid ${active ? '#4a90d9' : '#eae8e2'}`,
                    background: active ? '#4a90d9' : '#fbfaf7',
                    color: active ? '#fff' : '#37352f',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, fontSize: 12, color: '#6a675f' }}>
          {range.mode === 'custom' ? (
            <>
              <input type="date" aria-label="From date" value={range.from} max={range.to} onChange={(e) => pickDate('from', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #eae8e2', borderRadius: 6, background: '#fbfaf7' }} />
              <span>to</span>
              <input type="date" aria-label="To date" value={range.to} min={range.from} max={iso(new Date())} onChange={(e) => pickDate('to', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #eae8e2', borderRadius: 6, background: '#fbfaf7' }} />
            </>
          ) : (
            <span>{range.from === range.to ? shortDay(range.from) : `${shortDay(range.from)} – ${shortDay(range.to)}`}</span>
          )}
        </div>

        {error && <p role="alert" style={{ color: '#b34343', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        {!stats && !error && <p style={{ color: '#a3a099', fontSize: 14 }}>Loading statistics…</p>}

        {stats && totals && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <StatTile label="Lines drilled" value={String(totals.drills)} />
              <StatTile label="Puzzles" value={String(totals.puzzles)} />
              <StatTile label="Streak" value={`${stats.streak} d`} />
              <StatTile label="Puzzle rating" value={stats.rating.current === null ? '–' : String(stats.rating.current)} />
            </div>

            <Card title="Daily activity">
              <ActivityLanes stats={stats} />
            </Card>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))' }}>
              <Card title="Puzzle rating">
                <RatingChart stats={stats} />
              </Card>
              <Card title="Weakest and strongest themes">
                <ThemeRatings themes={stats.themeRatings} />
              </Card>
              <Card title="Trouble spots">
                <TroubleSpots spots={stats.troubleSpots} />
              </Card>
              <Card title="Repertoire progress">
                <RepertoireProgress progress={stats.progress} />
              </Card>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#6a675f', padding: '2px 2px 0' }}>
              {stats.puzzleSync.configured ? (
                <>
                  <span>
                    Lichess puzzles{stats.puzzleSync.lichessUsername ? ` for ${stats.puzzleSync.lichessUsername}` : ''} synced {ago(stats.puzzleSync.syncedAt)}.
                  </span>
                  <button
                    onClick={onSync}
                    disabled={syncing}
                    className="tap"
                    style={{ fontSize: 12, fontWeight: 600, color: '#2f6db0', background: 'transparent', border: 'none', cursor: syncing ? 'default' : 'pointer', padding: '4px 2px' }}
                  >
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                </>
              ) : null}
              {syncError && <span role="alert" style={{ color: '#b34343' }}>{syncError}</span>}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

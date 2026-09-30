'use client'

import { useCallback, useEffect, useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import { getStatistics, syncPuzzles, type StatisticsResponse } from '@/lib/api/client'
import { AccuracyChart, ActivityLanes, Card, CoverageRing, LeitnerBar, RatingChart, StatTile, ThemeBars } from '@/components/statistics/charts'

const RANGES = [7, 30, 90] as const
const RANGE_KEY = 'chesslab.statistics.days'

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : '–'
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
  const [days, setDays] = useState<number>(30)
  const [stats, setStats] = useState<StatisticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(RANGE_KEY))
      if ((RANGES as readonly number[]).includes(saved)) setDays(saved)
    } catch {}
  }, [])

  const load = useCallback((range: number) => {
    setError(null)
    getStatistics(range)
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load statistics.'))
  }, [])

  useEffect(() => {
    load(days)
  }, [days, load])

  function pickRange(range: number) {
    setDays(range)
    try {
      localStorage.setItem(RANGE_KEY, String(range))
    } catch {}
  }

  async function onSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      await syncPuzzles()
      load(days)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Could not sync puzzles.')
    } finally {
      setSyncing(false)
    }
  }

  const totals = stats?.totals
  const delta = stats?.rating.delta ?? null

  return (
    <main className="min-h-screen pb-6 sm:pb-10" style={{ background: '#e8e8e6' }}>
      <TopBar right={<span />} />
      <div style={{ width: '100%', maxWidth: 980, margin: '24px auto 0', padding: '0 clamp(12px, 4vw, 24px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <h1 className="serif" style={{ fontSize: 24, fontWeight: 400 }}>Statistics</h1>
          <span style={{ flex: 1 }} />
          <div role="group" aria-label="Time range" style={{ display: 'flex', gap: 6 }}>
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => pickRange(r)}
                aria-pressed={days === r}
                className="tap"
                style={{
                  fontSize: 12,
                  padding: '4px 12px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  border: `1px solid ${days === r ? '#4a90d9' : '#eae8e2'}`,
                  background: days === r ? '#4a90d9' : '#fbfaf7',
                  color: days === r ? '#fff' : '#37352f',
                }}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>

        {error && <p role="alert" style={{ color: '#b34343', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        {!stats && !error && <p style={{ color: '#a3a099', fontSize: 14 }}>Loading statistics…</p>}

        {stats && totals && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <StatTile label="Lines drilled" value={String(totals.drills)} sub={`${pct(totals.drills - totals.drillMistakes, totals.drills)} without a mistake`} />
              <StatTile label="Puzzles" value={String(totals.puzzles)} sub={`${pct(totals.puzzleWins, totals.puzzles)} solved first try`} />
              <StatTile label="Streak" value={`${stats.streak} d`} sub={`best ${stats.bestStreak}`} />
              <StatTile
                label="Puzzle rating"
                value={stats.rating.current === null ? '–' : String(stats.rating.current)}
                sub={delta === null ? undefined : `${delta >= 0 ? '+' : ''}${delta} in ${days}d`}
                subColor={delta === null ? undefined : delta >= 0 ? '#2f6db0' : '#c0392b'}
              />
            </div>

            <Card title="Daily activity">
              <ActivityLanes stats={stats} />
            </Card>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))' }}>
              <Card title="Puzzle rating">
                <RatingChart stats={stats} />
              </Card>
              <Card title="Solve rate by theme">
                <ThemeBars themes={stats.themes} />
              </Card>
              <Card title="Accuracy over time">
                <AccuracyChart weekly={stats.weekly} />
              </Card>
              <Card title="Repertoire progress">
                <LeitnerBar boxes={stats.boxes} />
                <div style={{ height: 14 }} />
                <CoverageRing coverage={stats.coverage} />
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

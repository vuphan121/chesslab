'use client'

import { useCallback, useEffect, useState } from 'react'
import TopBar from '@/components/layout/TopBar'
import WoodpeckerTrain from '@/components/woodpecker/WoodpeckerTrain'
import RunsTab from '@/components/woodpecker/RunsTab'
import AnalyticsTab from '@/components/woodpecker/AnalyticsTab'

type Tab = 'runs' | 'train' | 'analytics'

const TABS: { id: Tab; label: string }[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'train', label: 'Train' },
  { id: 'analytics', label: 'Analytics' },
]

export default function WoodpeckerPage() {
  const [tab, setTab] = useState<Tab | null>(null)

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    queueMicrotask(() => setTab(requested === 'train' || requested === 'analytics' ? requested : 'runs'))
  }, [])

  const go = useCallback((next: Tab, puzzle?: number) => {
    const params = new URLSearchParams()
    if (next !== 'runs') params.set('tab', next)
    if (puzzle) params.set('puzzle', String(puzzle))
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    setTab(next)
  }, [])

  const tabs = (
    <div style={{ display: 'flex', gap: 4 }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className="tap"
          onClick={() => go(t.id)}
          aria-pressed={tab === t.id}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 12px',
            borderRadius: 8,
            cursor: 'pointer',
            border: 'none',
            background: tab === t.id ? '#e8f3fd' : '#f0efe9',
            color: tab === t.id ? '#2f6db0' : '#6a675f',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  if (tab === 'train') return <WoodpeckerTrain topRight={tabs} />

  return (
    <main style={{ background: '#e8e8e6', minHeight: '100dvh' }}>
      <TopBar right={tabs} />
      {tab === 'runs' && <RunsTab onTrain={(puzzle) => go('train', puzzle)} />}
      {tab === 'analytics' && <AnalyticsTab onOpen={(puzzle) => go('train', puzzle)} />}
    </main>
  )
}

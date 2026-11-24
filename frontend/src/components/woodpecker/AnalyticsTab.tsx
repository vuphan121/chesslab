'use client'

import { useEffect, useMemo, useState } from 'react'
import { getWoodpeckerRunAttempts, listWoodpeckerRuns, type WoodpeckerRun, type WoodpeckerRunAttempt } from '@/lib/api/client'
import { cardStyle, formatDuration, runLabel, solveRate } from './format'

const BLOCK = 100
const COLORS = ['#b4b1a8', '#4a90d9']

export default function AnalyticsTab({ onOpen }: { onOpen: (puzzle: number) => void }) {
  const [runs, setRuns] = useState<WoodpeckerRun[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [attempts, setAttempts] = useState<Record<number, WoodpeckerRunAttempt[]>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listWoodpeckerRuns()
      .then((r) => {
        const withData = r.filter((x) => x.done > 0)
        setRuns(r)
        setPicked(withData.slice(0, 2).map((x) => x.cycle).reverse())
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load runs.'))
  }, [])

  useEffect(() => {
    for (const cycle of picked) {
      if (attempts[cycle]) continue
      getWoodpeckerRunAttempts(cycle)
        .then((a) => setAttempts((prev) => ({ ...prev, [cycle]: a })))
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the run.'))
    }
  }, [picked, attempts])

  const toggle = (cycle: number) =>
    setPicked((prev) => (prev.includes(cycle) ? prev.filter((c) => c !== cycle) : [...prev, cycle].sort((a, b) => a - b).slice(-2)))

  const chosen = useMemo(() => (runs ?? []).filter((r) => picked.includes(r.cycle)).sort((a, b) => a.cycle - b.cycle), [runs, picked])
  const [a, b] = chosen

  const blocks = useMemo(() => {
    if (chosen.length === 0) return []
    const total = chosen[0].total
    const out: { label: string; avg: (number | null)[] }[] = []
    for (let start = 1; start <= total; start += BLOCK) {
      const end = Math.min(start + BLOCK - 1, total)
      out.push({
        label: `${start}–${end}`,
        avg: chosen.map((run) => {
          const rows = (attempts[run.cycle] ?? []).filter((x) => x.puzzle >= start && x.puzzle <= end && x.outcome !== 'skipped')
          return rows.length ? rows.reduce((sum, x) => sum + x.durationMs, 0) / rows.length : null
        }),
      })
    }
    return out
  }, [chosen, attempts])

  const maxAvg = Math.max(1, ...blocks.flatMap((x) => x.avg.map((v) => v ?? 0)))

  const difficult = useMemo(() => {
    if (chosen.length === 0 || chosen.some((r) => !attempts[r.cycle])) return []
    const stats = new Map<number, { missed: number; ms: number; n: number }>()
    for (const run of chosen) {
      for (const x of attempts[run.cycle]) {
        if (x.outcome === 'skipped') continue
        const s = stats.get(x.puzzle) ?? { missed: 0, ms: 0, n: 0 }
        if (!x.solved) s.missed += 1
        s.ms += x.durationMs
        s.n += 1
        stats.set(x.puzzle, s)
      }
    }
    return [...stats.entries()]
      .filter(([, s]) => s.missed === chosen.length)
      .map(([puzzle, s]) => ({ puzzle, avgMs: s.ms / s.n }))
      .sort((x, y) => y.avgMs - x.avgMs)
      .slice(0, 10)
  }, [chosen, attempts])

  const delta = (current: number, previous: number, fmt: (v: number) => string, lowerBetter: boolean) => {
    const diff = current - previous
    if (diff === 0) return { text: 'No change', color: '#6a675f' }
    const good = lowerBetter ? diff < 0 : diff > 0
    return { text: `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`, color: good ? '#3f7a45' : '#b34343' }
  }

  const metrics =
    a && b
      ? [
          { label: 'Total time', value: formatDuration(b.totalMs), d: delta(b.totalMs, a.totalMs, formatDuration, true) },
          { label: 'Solved', value: `${solveRate(b)}%`, d: delta(solveRate(b), solveRate(a), (v) => `${v} pts`, false) },
          { label: 'Avg time', value: formatDuration(b.avgMs), d: delta(b.avgMs, a.avgMs, formatDuration, true) },
          { label: 'Gave up', value: String(b.gaveUp), d: delta(b.gaveUp, a.gaveUp, String, true) },
        ]
      : []

  return (
    <div style={{ width: 'min(760px, calc(100vw - 32px))', margin: '16px auto 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <p role="alert" style={{ color: '#b34343', fontSize: 13 }}>
          {error}
        </p>
      )}
      <div style={cardStyle}>
        <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
          Compare runs
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {runs?.filter((r) => r.done > 0).map((run) => {
            const on = picked.includes(run.cycle)
            return (
              <button
                key={run.cycle}
                className="tap"
                onClick={() => toggle(run.cycle)}
                aria-pressed={on}
                style={{
                  fontSize: 13,
                  padding: '6px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: on ? '1.5px solid #4a90d9' : '1px solid #d9d6cf',
                  background: on ? '#e8f3fd' : '#fbfaf7',
                  color: on ? '#2f6db0' : '#37352f',
                }}
              >
                {runLabel(run)}
              </button>
            )
          })}
        </div>
        {runs && runs.every((r) => r.done === 0) && <div style={{ fontSize: 13, color: '#6a675f', marginTop: 8 }}>No results yet</div>}
        {chosen.length === 1 && <div style={{ fontSize: 12, color: '#6a675f', marginTop: 8 }}>Pick a second run to compare</div>}
      </div>

      {a && b && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
            {runLabel(b)} vs {runLabel(a)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {metrics.map((m) => (
              <div key={m.label} style={{ background: '#f7f6f2', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: '#6a675f' }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{m.value}</div>
                <div style={{ fontSize: 12, color: m.d.color }}>{m.d.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {chosen.length > 0 && blocks.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Avg time per {BLOCK} puzzles</div>
          <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) 56px', gap: '6px 10px', alignItems: 'center', fontSize: 12 }}>
            {blocks.map((block) => (
              <Row key={block.label} label={block.label} values={block.avg} max={maxAvg} count={chosen.length} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12, color: '#6a675f' }}>
            {chosen.map((run, i) => (
              <span key={run.cycle} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 8, borderRadius: 2, background: COLORS[i + (2 - chosen.length)] }} />
                {runLabel(run)}
              </span>
            ))}
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Difficult puzzles</div>
          {difficult.length === 0 && <div style={{ fontSize: 13, color: '#6a675f' }}>None</div>}
          {difficult.map((d) => (
            <div key={d.puzzle} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 0', borderTop: '1px solid #f0efe9' }}>
              <span style={{ fontWeight: 600, width: 56 }}>#{d.puzzle}</span>
              <span style={{ flex: 1, color: '#6a675f' }}>avg {formatDuration(d.avgMs)}</span>
              <button
                className="tap"
                onClick={() => onOpen(d.puzzle)}
                style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: '1px solid #d9d6cf', background: '#fbfaf7', cursor: 'pointer' }}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, values, max, count }: { label: string; values: (number | null)[]; max: number; count: number }) {
  const last = values[values.length - 1]
  const first = values[0]
  const change = count === 2 && first != null && last != null ? Math.round((last - first) / 1000) : null
  return (
    <>
      <span>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {values.map((v, i) => (
          <div key={i} style={{ height: 8, borderRadius: 4, background: '#f0efe9', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${v ? (v / max) * 100 : 0}%`, background: COLORS[i + (2 - count)] }} />
          </div>
        ))}
      </div>
      <span style={{ color: change == null ? '#6a675f' : change <= 0 ? '#3f7a45' : '#b34343' }}>
        {change == null ? '' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)} s`}
      </span>
    </>
  )
}

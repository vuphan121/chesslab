'use client'

import { useEffect, useMemo, useState } from 'react'
import { getWoodpeckerRunAttempts, listWoodpeckerRuns, type WoodpeckerRun, type WoodpeckerRunAttempt } from '@/lib/api/client'
import { cardStyle, formatDuration, runLabel, solveRate } from './format'

const BLOCK = 100
const COLORS = ['#b4b1a8', '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#6250d6', '#e34948', '#e87ba4']

const points = (x: WoodpeckerRunAttempt) => (x.solved ? 1 : x.outcome === 'half' ? 0.5 : 0)

type Block = { start: number; end: number; time: (number | null)[]; acc: (number | null)[] }
type Tone = (diff: number, lowerBetter: boolean) => string
type Signed = (diff: number) => string

export default function AnalyticsTab({ onOpen }: { onOpen: (puzzle: number) => void }) {
  const [runs, setRuns] = useState<WoodpeckerRun[] | null>(null)
  const [off, setOff] = useState<number[]>([])
  const [attempts, setAttempts] = useState<Record<number, WoodpeckerRunAttempt[]>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listWoodpeckerRuns()
      .then((r) => setRuns(r.filter((x) => x.done > 0).sort((a, b) => a.cycle - b.cycle)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load runs.'))
  }, [])

  const chosen = useMemo(() => (runs ?? []).filter((r) => !off.includes(r.cycle)), [runs, off])

  useEffect(() => {
    for (const run of chosen) {
      if (attempts[run.cycle]) continue
      getWoodpeckerRunAttempts(run.cycle)
        .then((a) => setAttempts((prev) => ({ ...prev, [run.cycle]: a })))
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the run.'))
    }
  }, [chosen, attempts])

  const colorOf = (cycle: number) => COLORS[(runs ?? []).findIndex((r) => r.cycle === cycle) % COLORS.length]

  const toggle = (cycle: number) => setOff((prev) => (prev.includes(cycle) ? prev.filter((c) => c !== cycle) : [...prev, cycle]))

  const blocks = useMemo(() => {
    if (chosen.length === 0) return []
    const total = chosen[0].total
    const out: Block[] = []
    for (let start = 1; start <= total; start += BLOCK) {
      const end = Math.min(start + BLOCK - 1, total)
      const rowsOf = chosen.map((run) => (attempts[run.cycle] ?? []).filter((x) => x.puzzle >= start && x.puzzle <= end && x.outcome !== 'skipped'))
      out.push({
        start,
        end,
        time: rowsOf.map((rows) => (rows.length ? rows.reduce((sum, x) => sum + x.durationMs, 0) / rows.length / 1000 : null)),
        acc: rowsOf.map((rows) => (rows.length ? (rows.reduce((sum, x) => sum + points(x), 0) / rows.length) * 100 : null)),
      })
    }
    return out
  }, [chosen, attempts])

  const difficult = useMemo(() => {
    if (chosen.length === 0 || chosen.some((r) => !attempts[r.cycle])) return []
    const wrong = new Map<number, number>()
    for (const run of chosen) {
      for (const x of attempts[run.cycle]) {
        if (x.outcome === 'skipped' || x.solved) continue
        wrong.set(x.puzzle, (wrong.get(x.puzzle) ?? 0) + 1)
      }
    }
    return [...wrong.entries()]
      .map(([puzzle, count]) => ({ puzzle, count }))
      .sort((x, y) => y.count - x.count || x.puzzle - y.puzzle)
      .slice(0, 10)
  }, [chosen, attempts])

  const tone: Tone = (diff, lowerBetter) => (diff === 0 ? '#6a675f' : (lowerBetter ? diff < 0 : diff > 0) ? '#3f7a45' : '#b34343')
  const signed: Signed = (diff) => `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(Math.round(diff))}`

  return (
    <div style={{ width: 'min(760px, calc(100vw - 32px))', margin: '16px auto 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <p role="alert" style={{ color: '#b34343', fontSize: 13 }}>
          {error}
        </p>
      )}
      <div style={cardStyle}>
        <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
          Runs
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {runs?.map((run) => {
            const on = !off.includes(run.cycle)
            return (
              <button
                key={run.cycle}
                className="tap"
                onClick={() => toggle(run.cycle)}
                aria-pressed={on}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  padding: '8px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: on ? `1.5px solid ${colorOf(run.cycle)}` : '1px solid #d9d6cf',
                  background: on ? '#fff' : '#fbfaf7',
                  color: on ? '#37352f' : '#a3a099',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 2, background: on ? colorOf(run.cycle) : '#d9d6cf' }} />
                {runLabel(run)}
              </button>
            )
          })}
        </div>
        {runs && runs.length === 0 && <div style={{ fontSize: 13, color: '#6a675f' }}>No results yet</div>}
        {chosen.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#a3a099', padding: '0 0 4px 20px' }}>
              <span style={{ flex: 1 }} />
              <span>Avg time</span>
              <span style={{ width: 84, textAlign: 'right' }}>Accuracy</span>
            </div>
            {chosen.map((run, i) => {
              const prev = chosen[i - 1]
              const timeDiff = prev ? (run.avgMs - prev.avgMs) / 1000 : null
              const accDiff = prev ? solveRate(run) - solveRate(prev) : null
              return (
                <div key={run.cycle} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 0', borderTop: '1px solid #f0efe9' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: colorOf(run.cycle), flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{runLabel(run)}</span>
                  <span style={{ textAlign: 'right' }}>
                    <span style={{ fontWeight: 600 }}>{formatDuration(run.avgMs)}</span>
                    {timeDiff != null && <span style={{ fontSize: 12, marginLeft: 6, color: tone(timeDiff, true) }}>{signed(timeDiff)} s</span>}
                  </span>
                  <span style={{ width: 84, textAlign: 'right' }}>
                    <span style={{ fontWeight: 600 }}>{solveRate(run)}%</span>
                    {accDiff != null && <span style={{ fontSize: 12, marginLeft: 6, color: tone(accDiff, false) }}>{signed(accDiff)}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {chosen.length > 0 && blocks.length > 0 && (
        <>
          <Chart
            title={`Avg time per ${BLOCK}`}
            blocks={blocks}
            metric="time"
            chosen={chosen}
            colorOf={colorOf}
            max={Math.max(1, ...blocks.flatMap((b) => b.time.map((v) => v ?? 0)))}
            lowerBetter
            tone={tone}
            signed={signed}
          />
          <Chart title={`Accuracy per ${BLOCK}`} blocks={blocks} metric="acc" chosen={chosen} colorOf={colorOf} max={100} lowerBetter={false} tone={tone} signed={signed} />
        </>
      )}

      {chosen.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Difficult puzzles</div>
          {difficult.length === 0 && <div style={{ fontSize: 13, color: '#6a675f' }}>None</div>}
          {difficult.map((d) => (
            <div key={d.puzzle} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 0', borderTop: '1px solid #f0efe9' }}>
              <span style={{ fontWeight: 600, width: 56 }}>#{d.puzzle}</span>
              <span style={{ flex: 1, color: '#6a675f' }}>Wrong {d.count}×</span>
              <button
                className="tap"
                onClick={() => onOpen(d.puzzle)}
                style={{ fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 8, border: '1px solid #d9d6cf', background: '#fbfaf7', cursor: 'pointer' }}
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

function Chart({
  title,
  blocks,
  metric,
  chosen,
  colorOf,
  max,
  lowerBetter,
  tone,
  signed,
}: {
  title: string
  blocks: Block[]
  metric: 'time' | 'acc'
  chosen: WoodpeckerRun[]
  colorOf: (cycle: number) => string
  max: number
  lowerBetter: boolean
  tone: Tone
  signed: Signed
}) {
  const n = chosen.length
  const [hot, setHot] = useState<string | null>(null)
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))`, gap: 4, alignItems: 'end' }}>
        {blocks.map((block) => {
          const values = block[metric]
          const last = values[n - 1]
          const before = values[n - 2]
          const diff = n >= 2 && last != null && before != null ? last - before : null
          return (
            <div key={block.start} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }}>
              <div style={{ height: 110, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 1 }}>
                {values.map((v, i) => {
                  const key = `${block.start}:${chosen[i].cycle}`
                  const label = v == null ? '' : metric === 'time' ? `${Math.round(v)} s` : `${Math.round(v)}%`
                  return (
                    <div
                      key={chosen[i].cycle}
                      onMouseEnter={() => setHot(key)}
                      onMouseLeave={() => setHot((k) => (k === key ? null : k))}
                      onClick={() => setHot((k) => (k === key ? null : key))}
                      style={{ position: 'relative', flex: 1, maxWidth: 14, height: `${v ? Math.max(2, (v / max) * 100) : 0}%`, background: colorOf(chosen[i].cycle), borderRadius: '3px 3px 0 0', cursor: 'default' }}
                    >
                      {hot === key && label && (
                        <span
                          style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translate(-50%, -4px)',
                            zIndex: 5,
                            padding: '2px 6px',
                            borderRadius: 6,
                            background: '#37352f',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            pointerEvents: 'none',
                          }}
                        >
                          {label}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, lineHeight: 1, minHeight: 10, color: diff == null ? 'transparent' : tone(diff, lowerBetter) }}>
                {diff == null ? '.' : signed(diff)}
              </span>
              <span style={{ fontSize: 10, color: '#a3a099', lineHeight: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap' }}>
                {block.start}–{block.end}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

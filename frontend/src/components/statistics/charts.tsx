import type { ReactNode } from 'react'
import type { StatisticsResponse, StatsTheme } from '@/lib/api/client'
import { prettyTheme } from '@/lib/puzzle/themes'

export const CARD_STYLE = { background: '#fbfaf7', border: '1px solid #eae8e2', borderRadius: 10, padding: '12px 14px' } as const

const BOX_COLORS = ['#c0392b', '#b4b1a8', '#85b3e3', '#4a90d9', '#2f6db0', '#1c3f6b']

export function Card({ title, note, children, style }: { title: string; note?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section style={{ ...CARD_STYLE, ...style }}>
      <div className="lbl" style={{ color: '#a3a099', marginBottom: 10 }}>{title}</div>
      {children}
      {note && <div style={{ fontSize: 12, color: '#6a675f', marginTop: 8 }}>{note}</div>}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, color: '#a3a099', padding: '18px 0' }}>{children}</div>
}

export function StatTile({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div style={CARD_STYLE}>
      <div className="lbl" style={{ color: '#a3a099' }}>{label}</div>
      <div className="serif" style={{ fontSize: 26, lineHeight: 1.15, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: subColor ?? '#6a675f', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

function dateRange(endDate: string, days: number): string[] {
  const [y, m, d] = endDate.split('-').map(Number)
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(y, m - 1, d - i)
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`)
  }
  return out
}

function intensity(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0
  const r = n / max
  return r > 0.75 ? 1 : r > 0.4 ? 0.6 : 0.3
}

export function ActivityLanes({ stats }: { stats: StatisticsResponse }) {
  const dates = dateRange(stats.endDate, stats.days)
  const byDate = new Map(stats.daily.map((d) => [d.date, d]))
  const maxDrills = Math.max(0, ...stats.daily.map((d) => d.drills))
  const maxPuzzles = Math.max(0, ...stats.daily.map((d) => d.puzzles))
  const lanes = [
    { key: 'drills' as const, label: 'Drills', rgb: '74,144,217', max: maxDrills },
    { key: 'puzzles' as const, label: 'Puzzles', rgb: '55,53,47', max: maxPuzzles },
  ]
  return (
    <div>
      {lanes.map((lane) => (
        <div key={lane.key} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
          <span style={{ width: 52, fontSize: 11, color: '#a3a099', flexShrink: 0 }}>{lane.label}</span>
          <div style={{ display: 'flex', gap: dates.length > 60 ? 2 : 3, flex: 1, minWidth: 0 }}>
            {dates.map((date) => {
              const n = byDate.get(date)?.[lane.key] ?? 0
              const a = intensity(n, lane.max)
              return (
                <i
                  key={date}
                  title={`${shortDate(date)}: ${n} ${lane.key}`}
                  style={{ flex: 1, minWidth: 0, height: 16, borderRadius: 2, background: a ? `rgba(${lane.rgb},${a})` : '#eae8e2' }}
                />
              )
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: 60, marginTop: 4, fontSize: 11, color: '#a3a099' }}>
        <span>{shortDate(dates[0])}</span>
        <span>{shortDate(dates[dates.length - 1])}</span>
      </div>
    </div>
  )
}

export function RatingChart({ stats }: { stats: StatisticsResponse }) {
  const pts = stats.rating.points
  if (pts.length === 0) return <Empty>No puzzle rating yet. Sync your Lichess puzzles to see it here.</Empty>
  const W = 440
  const H = 130
  const padX = 8
  const chartH = 96
  const dates = dateRange(stats.endDate, stats.days)
  const xOf = (date: string) => {
    const i = dates.indexOf(date)
    return padX + ((i < 0 ? 0 : i) / Math.max(1, dates.length - 1)) * (W - 2 * padX)
  }
  const ratings = pts.map((p) => p.rating)
  const lo = Math.min(...ratings) - 10
  const hi = Math.max(...ratings) + 10
  const yOf = (r: number) => 8 + (1 - (r - lo) / Math.max(1, hi - lo)) * (chartH - 16)
  const maxVol = Math.max(1, ...stats.daily.map((d) => d.puzzles))
  const barW = Math.max(2, Math.min(8, ((W - 2 * padX) / dates.length) * 0.7))
  const line = pts.map((p) => `${xOf(p.date).toFixed(1)},${yOf(p.rating).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Puzzle rating over time with puzzles solved per day as bars" style={{ display: 'block' }}>
      {stats.daily.map((d) => {
        if (!d.puzzles) return null
        const h = (d.puzzles / maxVol) * 42
        return <rect key={d.date} x={xOf(d.date) - barW / 2} y={chartH - h} width={barW} height={h} fill="#eae8e2" />
      })}
      <polyline fill="none" stroke="#4a90d9" strokeWidth={2} strokeLinejoin="round" points={line} />
      <circle cx={xOf(last.date)} cy={yOf(last.rating)} r={3.5} fill="#4a90d9" />
      <text x={padX} y={H - 6} fontSize={10} fill="#a3a099">{shortDate(dates[0])}</text>
      <text x={W - padX} y={H - 6} fontSize={10} fill="#a3a099" textAnchor="end">{shortDate(dates[dates.length - 1])}</text>
      <text x={padX} y={10} fontSize={10} fill="#a3a099">{Math.round(hi)}</text>
      <text x={padX} y={chartH - 2} fontSize={10} fill="#a3a099" style={{ display: 'none' }}>{Math.round(lo)}</text>
    </svg>
  )
}

export function ThemeBars({ themes }: { themes: StatsTheme[] }) {
  const rows = themes
    .filter((t) => t.nb >= 5)
    .slice(0, 8)
    .map((t) => ({ ...t, rate: Math.round((100 * t.wins) / t.nb) }))
    .sort((a, b) => a.rate - b.rate)
  if (rows.length === 0) return <Empty>Solve at least five puzzles in a theme to see its solve rate.</Empty>
  return (
    <div>
      {rows.map((t) => (
        <div key={t.theme} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '6px 0' }} title={`${t.wins} of ${t.nb} solved first try`}>
          <span style={{ width: 96, color: '#37352f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prettyTheme(t.theme)}</span>
          <div style={{ flex: 1, height: 6, background: '#eae8e2', borderRadius: 3, overflow: 'hidden' }}>
            <i style={{ display: 'block', height: '100%', width: `${t.rate}%`, background: t.rate < 65 ? '#c0392b' : '#4a90d9' }} />
          </div>
          <span className="mono" style={{ width: 34, textAlign: 'right', color: '#6a675f' }}>{t.rate}%</span>
        </div>
      ))}
    </div>
  )
}

export function LeitnerBar({ boxes }: { boxes: number[] }) {
  const total = boxes.reduce((a, b) => a + b, 0)
  if (total === 0) return <Empty>Drill a few lines and your cards will show up here.</Empty>
  return (
    <div>
      <div style={{ display: 'flex', height: 26, borderRadius: 4, overflow: 'hidden', gap: 1 }} role="img" aria-label={`Cards per box: ${boxes.join(', ')}`}>
        {boxes.map((n, i) =>
          n > 0 ? <div key={i} title={`Box ${i + 1}: ${n} cards`} style={{ flex: n, background: BOX_COLORS[i], opacity: i === 0 ? 0.75 : 1 }} /> : null,
        )}
      </div>
      <div style={{ display: 'flex', marginTop: 6 }}>
        {boxes.map((n, i) => (
          <div key={i} style={{ flex: 1, fontSize: 11, color: '#a3a099', textAlign: 'center' }}>
            <div className="mono" style={{ color: '#37352f', fontSize: 12 }}>{n}</div>
            Box {i + 1}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CoverageRing({ coverage }: { coverage: StatisticsResponse['coverage'] }) {
  const total = coverage.learned + coverage.shaky + coverage.untouched
  if (total === 0) return <Empty>No repertoire loaded yet.</Empty>
  const r = 34
  const c = 2 * Math.PI * r
  const parts = [
    { label: 'Learned', n: coverage.learned, color: '#4a90d9' },
    { label: 'Shaky', n: coverage.shaky, color: '#85b3e3' },
    { label: 'Untouched', n: coverage.untouched, color: '#eae8e2' },
  ]
  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width={100} height={100} viewBox="0 0 100 100" role="img" aria-label={`${Math.round((100 * coverage.learned) / total)} percent of cards learned`}>
        <g transform="rotate(-90 50 50)">
          {parts.map((p) => {
            const len = (p.n / total) * c
            const el = <circle key={p.label} cx={50} cy={50} r={r} fill="none" stroke={p.color} strokeWidth={10} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
            offset += len
            return el
          })}
        </g>
        <text x={50} y={55} textAnchor="middle" fontSize={16} fontFamily="var(--font-serif), Georgia, serif" fill="#1c1b18">
          {Math.round((100 * coverage.learned) / total)}%
        </text>
      </svg>
      <div style={{ fontSize: 13 }}>
        {parts.map((p) => (
          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '3px 0' }}>
            <i style={{ width: 9, height: 9, borderRadius: 2, background: p.color, border: p.color === '#eae8e2' ? '1px solid #d9d6cf' : 'none' }} />
            <span style={{ color: '#37352f' }}>{p.label}</span>
            <span className="mono" style={{ color: '#a3a099' }}>{p.n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AccuracyChart({ weekly }: { weekly: StatisticsResponse['weekly'] }) {
  const has = weekly.some((w) => w.drillAccuracy !== null || w.puzzleAccuracy !== null)
  if (!has) return <Empty>Weekly accuracy appears once you have a week of activity.</Empty>
  const W = 440
  const H = 130
  const padL = 26
  const padR = 8
  const top = 8
  const bottom = 22
  const vals = weekly.flatMap((w) => [w.drillAccuracy, w.puzzleAccuracy]).filter((v): v is number => v !== null)
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 10) / 10) * 10)
  const xOf = (i: number) => padL + (weekly.length === 1 ? (W - padL - padR) / 2 : (i / (weekly.length - 1)) * (W - padL - padR))
  const yOf = (v: number) => top + (1 - (v - lo) / (100 - lo)) * (H - top - bottom)
  const series = [
    { key: 'drillAccuracy' as const, color: '#4a90d9', dash: undefined },
    { key: 'puzzleAccuracy' as const, color: '#37352f', dash: '4 3' },
  ]
  const ticks = [lo, Math.round((lo + 100) / 2 / 5) * 5, 100]
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly accuracy for line drills and puzzles" style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} stroke="#eae8e2" />
            <text x={0} y={yOf(t) + 3} fontSize={10} fill="#a3a099">{t}%</text>
          </g>
        ))}
        {series.map((s) => {
          const segs: string[][] = [[]]
          weekly.forEach((w, i) => {
            const v = w[s.key]
            if (v === null) segs.push([])
            else segs[segs.length - 1].push(`${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
          })
          return (
            <g key={s.key}>
              {segs.filter((p) => p.length > 1).map((p, i) => (
                <polyline key={i} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" points={p.join(' ')} />
              ))}
              {weekly.map((w, i) => (w[s.key] === null ? null : <circle key={i} cx={xOf(i)} cy={yOf(w[s.key] as number)} r={2.5} fill={s.color} />))}
            </g>
          )
        })}
        {weekly.map((w, i) =>
          i === 0 || i === weekly.length - 1 ? (
            <text key={w.weekStart} x={xOf(i)} y={H - 6} fontSize={10} fill="#a3a099" textAnchor={i === 0 ? 'start' : 'end'}>{shortDate(w.weekStart)}</text>
          ) : null,
        )}
      </svg>
      <div style={{ fontSize: 12, color: '#6a675f', marginTop: 4 }}>
        <span style={{ color: '#4a90d9' }}>━</span> line drills without a mistake &nbsp;
        <span style={{ color: '#37352f' }}>╍</span> puzzles solved first try
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import type { StatisticsResponse } from '@/lib/api/client'
import { prettyTheme } from '@/lib/puzzle/themes'

export const CARD_STYLE = { background: '#fbfaf7', border: '1px solid #eae8e2', borderRadius: 10, padding: '12px 14px' } as const


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

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={CARD_STYLE}>
      <div className="lbl" style={{ color: '#a3a099' }}>{label}</div>
      <div className="serif" style={{ fontSize: 26, lineHeight: 1.15, marginTop: 4 }}>{value}</div>
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

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}

export function RatingChart({ stats }: { stats: StatisticsResponse }) {
  const pts = stats.rating.points
  if (pts.length === 0) return <Empty>No puzzle rating yet. Sync your Lichess puzzles to see it here.</Empty>
  const W = 440
  const H = 250
  const padL = 34
  const padR = 10
  const top = 10
  const chartH = 214
  const firstDay = Math.min(dayNumber(pts[0].date), ...stats.daily.filter((d) => d.puzzles > 0).map((d) => dayNumber(d.date)))
  const span = Math.min(stats.days, Math.max(3, dayNumber(stats.endDate) - firstDay + 2))
  const dates = dateRange(stats.endDate, span)
  const xOf = (date: string) => {
    const i = dates.indexOf(date)
    return padL + ((i < 0 ? 0 : i) / Math.max(1, dates.length - 1)) * (W - padL - padR)
  }
  const ratings = pts.map((p) => p.rating)
  const rawLo = Math.min(...ratings)
  const rawHi = Math.max(...ratings)
  const pad = Math.max(8, Math.round((rawHi - rawLo) * 0.25))
  const lo = rawLo - pad
  const hi = rawHi + pad
  const yOf = (r: number) => top + (1 - (r - lo) / Math.max(1, hi - lo)) * (chartH - top - 4)
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v))
  const maxVol = Math.max(1, ...stats.daily.map((d) => d.puzzlesSolved))
  const barW = Math.max(3, Math.min(14, ((W - padL - padR) / dates.length) * 0.6))
  const line = pts.map((p) => `${xOf(p.date).toFixed(1)},${yOf(p.rating).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  const lastX = xOf(last.date)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Puzzle rating over time with puzzles solved per day as bars" style={{ display: 'block' }}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={yOf(v)} y2={yOf(v)} stroke="#eae8e2" />
          <text x={0} y={yOf(v) + 3} fontSize={10} fill="#a3a099">{v}</text>
        </g>
      ))}
      {stats.daily.map((d) => {
        if (!d.puzzlesSolved) return null
        const h = (d.puzzlesSolved / maxVol) * 70
        return (
          <rect key={d.date} x={xOf(d.date) - barW / 2} y={chartH - h} width={barW} height={h} fill="#e1dfd8">
            <title>{`${shortDate(d.date)}: ${d.puzzlesSolved} solved`}</title>
          </rect>
        )
      })}
      <polyline fill="none" stroke="#4a90d9" strokeWidth={2} strokeLinejoin="round" points={line} />
      {pts.map((p) => (
        <circle key={p.date} cx={xOf(p.date)} cy={yOf(p.rating)} r={2.5} fill="#4a90d9" />
      ))}
      <circle cx={lastX} cy={yOf(last.rating)} r={4} fill="#4a90d9" />
      <text x={Math.min(lastX, W - padR)} y={yOf(last.rating) - 9} fontSize={11} fontWeight={600} fill="#2f6db0" textAnchor="end">{last.rating}</text>
      <text x={padL} y={H - 6} fontSize={10} fill="#a3a099">{shortDate(dates[0])}</text>
      <text x={W - padR} y={H - 6} fontSize={10} fill="#a3a099" textAnchor="end">{shortDate(dates[dates.length - 1])}</text>
    </svg>
  )
}

function RatingRow({ label, value, shown, color, title }: { label: string; value: number; shown: string; color: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '6px 0' }} title={title}>
      <span style={{ width: 118, color: '#37352f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: '#eae8e2', borderRadius: 3, overflow: 'hidden' }}>
        <i style={{ display: 'block', height: '100%', width: `${value}%`, background: color }} />
      </div>
      <span className="mono" style={{ width: 42, textAlign: 'right', color: '#6a675f' }}>{shown}</span>
    </div>
  )
}

export function ThemeRatings({ themes }: { themes: StatisticsResponse['themeRatings'] }) {
  if (themes.length === 0) return <Empty>No puzzles played in this period.</Empty>
  const k = themes.length > 5 ? Math.min(5, Math.floor(themes.length / 2)) : 0
  const weakest = k > 0 ? themes.slice(0, k) : []
  const strongest = k > 0 ? themes.slice(themes.length - k).reverse() : [...themes].reverse()
  const row = (t: StatisticsResponse['themeRatings'][number]) => {
    const pct = t.recent > 0 ? Math.round((100 * t.wins) / t.recent) : null
    return (
      <div
        key={t.theme}
        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '6px 0' }}
        title={pct === null ? `Rating ${t.rating}, no puzzles in this period` : `Rating ${t.rating}. ${t.wins} of ${t.recent} solved first try in this period`}
      >
        <span style={{ width: 118, color: '#37352f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prettyTheme(t.theme)}</span>
        <div style={{ flex: 1, height: 6, background: '#eae8e2', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
          {pct !== null && (
            <>
              <i style={{ display: 'block', height: '100%', width: `${pct}%`, background: '#2e8b57' }} />
              <i style={{ display: 'block', height: '100%', width: `${100 - pct}%`, background: '#c4443b' }} />
            </>
          )}
        </div>
        <span className="mono" style={{ width: 34, textAlign: 'right', color: '#6a675f' }}>{pct === null ? '–' : `${pct}%`}</span>
        <span className="mono" style={{ width: 38, textAlign: 'right', color: '#37352f' }}>{t.rating}</span>
      </div>
    )
  }
  const group = (title: string, rows: typeof themes) => (
    <div>
      <div style={{ fontSize: 11, color: '#a3a099', margin: '2px 0 0' }}>{title}</div>
      {rows.map(row)}
    </div>
  )
  return (
    <div>
      {weakest.length > 0 ? (
        <>
          {group('Strongest', strongest)}
          <div style={{ height: 8 }} />
          {group('Weakest', weakest)}
        </>
      ) : (
        group('Your themes', strongest)
      )}
    </div>
  )
}

export function TroubleSpots({ spots }: { spots: StatisticsResponse['troubleSpots'] }) {
  if (spots.length === 0) return <Empty>No chapters with repeated mistakes in this period.</Empty>
  return (
    <div>
      {spots.map((s) => {
        const rate = Math.round((100 * s.mistakes) / s.drills)
        return (
          <RatingRow
            key={`${s.repertoireId}/${s.chapterId}`}
            label={`${s.repertoireName} · ${s.chapterName}`}
            value={rate}
            shown={`${rate}%`}
            color="#c0392b"
            title={`${s.mistakes} of ${s.drills} drills had a mistake`}
          />
        )
      })}
    </div>
  )
}

export function RepertoireProgress({ progress }: { progress: StatisticsResponse['progress'] }) {
  const total = progress.learned + progress.gettingThere + progress.needsWork + progress.notStarted
  if (total === 0) return <Empty>No repertoire loaded yet.</Empty>
  const parts = [
    { label: 'Learned', n: progress.learned, color: '#2f6db0' },
    { label: 'Getting there', n: progress.gettingThere, color: '#85b3e3' },
    { label: 'Needs work', n: progress.needsWork, color: '#e6a29a' },
    { label: 'Not started', n: progress.notStarted, color: '#eae8e2' },
  ]
  const pct = Math.round((100 * progress.learned) / total)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>{pct}%</span>
        <span style={{ fontSize: 12, color: '#6a675f' }}>learned</span>
      </div>
      <div style={{ fontSize: 12, color: '#6a675f', margin: '2px 0 12px' }}>{progress.learned} of {total} lines</div>
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 }} role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(', ')}>
        {parts.map((p) => (p.n > 0 ? <div key={p.label} title={`${p.label}: ${p.n}`} style={{ flex: p.n, background: p.color }} /> : null))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10, fontSize: 12, color: '#6a675f' }}>
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 5, background: p.color, border: p.color === '#eae8e2' ? '1px solid #d9d6cf' : 'none' }} />
            {p.label} {p.n}
          </span>
        ))}
      </div>
    </div>
  )
}

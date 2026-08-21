'use client'

import { useEffect, useRef, useState } from 'react'
import { listRepertoires, getRepertoire, getTodayTraining } from '@/lib/api/client'
import type { TodayTrainingResponse } from '@/lib/api/client'
import { toFigurine } from '@/lib/chess/figurine'
import RepertoireManagement from '@/components/trainer/RepertoireManagement'
import type { RepertoireSummary, Repertoire, RepNode } from '@/lib/trainer/types'
import type { SessionOptions } from '@/lib/trainer/types'





interface ChapterLine {
  sans: string[]
  hasExcluded: boolean
}

function enumerateLines(node: RepNode, sans: string[] = [], hasExcluded = false): ChapterLine[] {
  const children = node.children ?? []
  if (children.length === 0) {
    return sans.length > 0 ? [{ sans, hasExcluded }] : []
  }
  const lines: ChapterLine[] = []
  for (const child of children) {
    lines.push(...enumerateLines(child, [...sans, child.san], hasExcluded || child.excluded))
  }
  return lines
}



function formatLine(sans: string[]): string {
  return sans
    .map((san, i) => {
      const ply = i + 1
      const num = Math.ceil(ply / 2)
      const isWhite = ply % 2 === 1
      const label = isWhite ? `${num}.` : i === 0 ? `${num}…` : ''
      return `${label}${toFigurine(san)}`
    })
    .join(' ')
}

interface Props {
  onStart: (repertoireId: string, chapterIds: string[], opts: SessionOptions) => void
  onStartToday: (repertoireIds: string[], linesPerDay: number) => void
  onResumeToday: () => void
  starting: boolean
  startError: string | null
}

export default function RepertoirePicker({ onStart, onStartToday, onResumeToday, starting, startError }: Props) {
  const [reps, setReps] = useState<RepertoireSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [fullRep, setFullRep] = useState<Repertoire | null>(null)
  const [fullRepLoading, setFullRepLoading] = useState(false)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())




  const [today, setToday] = useState<TodayTrainingResponse | null>(null)
  const [todayRepertoireIds, setTodayRepertoireIds] = useState<Set<string>>(new Set())
  const [todayLineCountInput, setTodayLineCountInput] = useState('10')
  const [managing, setManaging] = useState(false)

  const fullRepReqId = useRef(0)









  function selectRepertoire(id: string, chapterIds: string[]) {
    setSelectedId(id)
    setSelectedChapters(new Set(chapterIds))
    setFullRep(null)
    setExpandedChapters(new Set())

    const reqId = ++fullRepReqId.current
    setFullRepLoading(true)
    getRepertoire(id)
      .then((rep) => {
        if (reqId === fullRepReqId.current) setFullRep(rep)
      })
      .catch(() => {

      })
      .finally(() => {
        if (reqId === fullRepReqId.current) setFullRepLoading(false)
      })
  }

  useEffect(() => {
    Promise.all([listRepertoires(), getTodayTraining().catch(() => null)])
      .then(([list, queue]) => {
        setReps(list)
        if (list.length > 0) selectRepertoire(list[0].id, list[0].chapters.map((c) => c.id))
        const settings = queue?.settings
        setToday(queue)
        setTodayRepertoireIds(new Set(settings?.repertoireIds.length ? settings.repertoireIds : list.map((rep) => rep.id)))
        if (settings) setTodayLineCountInput(String(settings.linesPerDay))
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to reach the backend.'))
  }, [])

  const selected = reps?.find((r) => r.id === selectedId) ?? null

  const refreshCatalog = () => {
    listRepertoires()
      .then((list) => {
        setReps(list)
        if (!selectedId && list.length > 0) selectRepertoire(list[0].id, list[0].chapters.map((chapter) => chapter.id))
      })
      .catch(() => {})
  }

  const toggleExpanded = (chapterId: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(chapterId)) next.delete(chapterId)
      else next.add(chapterId)
      return next
    })
  }

  const toggleChapter = (id: string) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleStart = () => {
    if (!selectedId || selectedChapters.size === 0) return
    onStart(selectedId, [...selectedChapters], { sessionLength: null, mode: 'mixed' })
  }

  const toggleTodayRepertoire = (id: string) => {
    setTodayRepertoireIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const todayLineCount = Number(todayLineCountInput)
  const validTodayLineCount = Number.isInteger(todayLineCount) && todayLineCount >= 1 && todayLineCount <= 100
  const savedSettingsMatch =
    today?.settings?.linesPerDay === todayLineCount &&
    today?.settings.repertoireIds.length === todayRepertoireIds.size &&
    today?.settings.repertoireIds.every((id) => todayRepertoireIds.has(id))

  const panelStyle: React.CSSProperties = {
    width: 'min(720px, calc(100vw - 32px))',
    margin: '24px auto',
    background: '#fff',
    borderRadius: 11,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
    padding: 'clamp(16px, 4vw, 28px)',
  }

  if (listError) {
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 14, color: '#37352f', marginBottom: 10 }}>Can&rsquo;t reach the backend.</p>
        <pre className="mono" style={{ fontSize: 12, background: '#fbfaf7', padding: 10, borderRadius: 6 }}>
          cd backend{'\n'}go run ./cmd/server/
        </pre>
      </div>
    )
  }

  if (!reps) {
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 13, color: '#a3a099' }}>Loading repertoires…</p>
      </div>
    )
  }

  if (reps.length === 0) {
    if (managing) {
      return <RepertoireManagement repertoires={reps} onClose={() => setManaging(false)} onChanged={refreshCatalog} />
    }
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 14, color: '#37352f', marginBottom: 10 }}>No repertoires loaded.</p>
        <p style={{ fontSize: 12, color: '#a3a099', marginBottom: 14 }}>Add your first Lichess study to build its complete drill tree.</p>
        <button onClick={() => setManaging(true)} style={{ fontSize: 12, fontWeight: 700, padding: '8px 12px', borderRadius: 7, border: 'none', background: '#4a90d9', color: '#fff', cursor: 'pointer' }}>Manage repertoires</button>
      </div>
    )
  }

  if (managing) {
    return <RepertoireManagement repertoires={reps} onClose={() => setManaging(false)} onChanged={refreshCatalog} />
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
        <h1 className="serif" style={{ fontSize: 22, fontWeight: 500 }}>Opening Study</h1>
        <button onClick={() => setManaging(true)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 10px', borderRadius: 7, border: '1px solid #dbe8f4', background: '#fff', color: '#3974ad', cursor: 'pointer' }}>Manage</button>
      </div>

      <div
        style={{
          marginBottom: 24,
          padding: '16px',
          background: '#f7fbff',
          border: '1px solid #d8e8f7',
          borderRadius: 9,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 13 }}>
          <h2 className="serif" style={{ fontSize: 18, fontWeight: 500 }}>Today&rsquo;s training</h2>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            marginBottom: 14,
          }}
        >
          {reps.map((rep) => (
            <label key={rep.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#37352f', cursor: 'pointer' }}>
              <input type="checkbox" checked={todayRepertoireIds.has(rep.id)} onChange={() => toggleTodayRepertoire(rep.id)} />
              {rep.name}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6a675f' }}>
            Lines
            <input
              type="number"
              min={1}
              max={100}
              value={todayLineCountInput}
              onChange={(event) => setTodayLineCountInput(event.target.value)}
              style={{ width: 58, border: '1px solid #cfe0ee', borderRadius: 6, padding: '5px 7px', color: '#37352f' }}
            />
          </label>
          <button
            onClick={() => validTodayLineCount && onStartToday([...todayRepertoireIds], todayLineCount)}
            disabled={starting || todayRepertoireIds.size === 0 || !validTodayLineCount || savedSettingsMatch}
            style={{ fontSize: 12, fontWeight: 700, padding: '8px 11px', borderRadius: 7, border: '1px solid #c5dcef', background: '#fff', color: '#3974ad', cursor: starting ? 'default' : 'pointer' }}
          >
            Update queue
          </button>
          <button
            onClick={() => {
              if ((today?.entries.length ?? 0) > 0) onResumeToday()
              else onStartToday([...todayRepertoireIds], todayLineCount)
            }}
            disabled={starting || todayRepertoireIds.size === 0 || !validTodayLineCount}
            style={{ fontSize: 12, fontWeight: 700, padding: '8px 13px', borderRadius: 7, border: 'none', background: starting ? '#a9c9e8' : '#4a90d9', color: '#fff', cursor: starting ? 'default' : 'pointer' }}
          >
            {starting ? 'Starting…' : (today?.entries.length ?? 0) > 0 ? 'Resume today' : 'Build today’s queue'}
          </button>
        </div>
      </div>

      <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
        Choose a repertoire
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {reps.map((r) => {
          const active = r.id === selectedId
          return (
            <div
              key={r.id}
              onClick={() => selectRepertoire(r.id, r.chapters.map((c) => c.id))}
              style={{
                cursor: 'pointer',
                padding: '12px 14px',
                borderRadius: 8,
                border: active ? '1px solid #4a90d9' : '1px solid #eae8e2',
                background: active ? '#f2f8fd' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: '#2f6db0', background: '#ecf3fb', padding: '1px 7px', borderRadius: 5 }}
                >
                  {r.side === 'w' ? 'White' : 'Black'}
                </span>
                <span style={{ fontSize: 11, color: '#a3a099' }}>{r.cardCount} positions</span>
              </div>
              <div style={{ fontSize: 11, color: '#b4b1a8', marginTop: 2, overflowWrap: 'anywhere' }}>
                {r.chapters.length} chapters
                {r.source && (
                  <>
                    {' · '}
                    <span className="mono">{r.source}</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <>
          <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
            Chapters
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
            {selected.chapters.map((ch) => {
              const isExpanded = expandedChapters.has(ch.id)
              const chapterTree =
                fullRep?.id === selectedId ? fullRep.chapters.find((c) => c.id === ch.id)?.tree : undefined




              const lines = chapterTree ? enumerateLines(chapterTree).filter((l) => !l.hasExcluded) : []
              return (
                <div key={ch.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={selectedChapters.has(ch.id)}
                        onChange={() => toggleChapter(ch.id)}
                      />
                      {ch.name}
                      {chapterTree && (
                        <span style={{ fontSize: 11, color: '#a3a099' }}>
                          {lines.length} line{lines.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </label>
                    <button
                      onClick={() => toggleExpanded(ch.id)}
                      title={isExpanded ? 'Hide lines' : 'Show lines'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#6a675f',
                        background: '#f0efe9',
                        border: 'none',
                        borderRadius: 6,
                        padding: '4px 9px',
                        cursor: 'pointer',
                      }}
                    >
                      Lines
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 10 10"
                        fill="none"
                        style={{ transform: isExpanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.1s' }}
                      >
                        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>

                  {isExpanded && (
                    <div
                      style={{
                        marginTop: 6,
                        marginLeft: 22,
                        padding: '8px 12px',
                        background: '#fbfaf7',
                        border: '1px solid #eae8e2',
                        borderRadius: 7,
                        maxHeight: 180,
                        overflow: 'auto',
                      }}
                    >
                      {fullRepLoading && !fullRep ? (
                        <p style={{ fontSize: 12, color: '#a3a099' }}>Loading lines…</p>
                      ) : lines.length === 0 ? (
                        <p style={{ fontSize: 12, color: '#a3a099' }}>No lines to show.</p>
                      ) : (
                        lines.map((line, i) => (
                          <p key={i} className="mono" style={{ fontSize: 12, lineHeight: 1.7, color: '#4a4740' }}>
                            {formatLine(line.sans)}
                          </p>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {startError && <p style={{ fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{startError}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleStart}
          disabled={starting || !selectedId || selectedChapters.size === 0}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: '9px 20px',
            borderRadius: 8,
            border: 'none',
            background: starting ? '#a9c9e8' : '#4a90d9',
            color: '#fff',
            cursor: starting ? 'default' : 'pointer',
          }}
        >
          {starting ? 'Starting…' : 'Start session'}
        </button>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listRepertoires, getRepertoire, getTodayTraining } from '@/lib/api/client'
import type { TodayTrainingResponse } from '@/lib/api/client'
import RepertoireManagement from '@/components/trainer/RepertoireManagement'
import LineList from '@/components/trainer/LineList'
import { enumerateLines } from '@/lib/trainer/lineQueue'
import type { ChapterLine } from '@/lib/trainer/lineQueue'
import type { RepertoireSummary, Repertoire } from '@/lib/trainer/types'
import type { SessionOptions } from '@/lib/trainer/types'

interface Props {
  onStart: (repertoireId: string, chapterIds: string[], opts: SessionOptions) => void
  onResumeToday: () => void
  starting: boolean
  startError: string | null
}

export default function RepertoirePicker({ onStart, onResumeToday, starting, startError }: Props) {
  const [reps, setReps] = useState<RepertoireSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [fullRep, setFullRep] = useState<Repertoire | null>(null)
  const [fullRepLoading, setFullRepLoading] = useState(false)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'repertoire' | 'mixed'>('repertoire')
  const [search, setSearch] = useState('')

  const [today, setToday] = useState<TodayTrainingResponse | null>(null)
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
        // degrade gracefully — chapter line previews just stay unavailable
      })
      .finally(() => {
        if (reqId === fullRepReqId.current) setFullRepLoading(false)
      })
  }

  const loadTodayTraining = useCallback(() => {
    getTodayTraining()
      .then((queue) => setToday(queue))
      .catch(() => setToday(null))
  }, [])

  useEffect(() => {
    listRepertoires()
      .then((list) => {
        setReps(list)
        if (list.length > 0) selectRepertoire(list[0].id, list[0].chapters.map((c) => c.id))
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to reach the backend.'))
    loadTodayTraining()
  }, [loadTodayTraining])

  const selected = reps?.find((r) => r.id === selectedId) ?? null

  // Walking every chapter's full move tree is real recursive work; without
  // memoizing it, it reran for every chapter on every render of this
  // component — including one caused by toggling a different chapter's
  // checkbox or expanding a different chapter's "Lines" panel.
  const chapterLinesById = useMemo(() => {
    const map: Record<string, ChapterLine[]> = {}
    if (fullRep?.id !== selectedId) return map
    for (const chapter of fullRep.chapters) {
      map[chapter.id] = enumerateLines(chapter.tree).filter((l) => !l.hasExcluded)
    }
    return map
  }, [fullRep, selectedId])

  const refreshCatalog = (changedId?: string) => {
    listRepertoires()
      .then((list) => {
        setReps(list)
        // A refresh is a full rebuild (see backend CLAUDE.md's "Repertoire
        // management"), so when the CHANGED repertoire is the one currently
        // selected, its chapter ids can no longer match what's already in
        // `selectedChapters`/`fullRep` — re-select it against the fresh list
        // rather than leaving the panel showing stale chapter ids and a line
        // preview built from the pre-refresh tree. An unrelated repertoire
        // changing (import, or refreshing a different row) must NOT reset
        // this one's selection.
        const changed = changedId ? list.find((r) => r.id === changedId) : undefined
        if (changed && changed.id === selectedId) {
          selectRepertoire(changed.id, changed.chapters.map((chapter) => chapter.id))
        } else if (!selectedId && list.length > 0) {
          selectRepertoire(list[0].id, list[0].chapters.map((chapter) => chapter.id))
        }
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

  const panelStyle: React.CSSProperties = {
    width: 'min(900px, calc(100vw - 32px))',
    margin: '32px auto',
    padding: '0 4px',
  }

  if (listError) {
    return (
      <div style={{ ...panelStyle, width: 'min(560px, calc(100vw - 32px))' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(28,27,24,0.04), 0 8px 24px rgba(28,27,24,0.05)' }}>
          <p style={{ fontSize: 14, color: '#37352f', marginBottom: 10 }}>Can&rsquo;t reach the backend.</p>
          <pre className="mono" style={{ fontSize: 12, background: '#fbfaf7', padding: 10, borderRadius: 6 }}>
            cd backend{'\n'}go run ./cmd/server/
          </pre>
        </div>
      </div>
    )
  }

  if (!reps) {
    return (
      <div style={{ ...panelStyle, width: 'min(560px, calc(100vw - 32px))' }}>
        <p style={{ fontSize: 13, color: '#a3a099' }}>Loading repertoires…</p>
      </div>
    )
  }

  if (reps.length === 0) {
    if (managing) {
      return <RepertoireManagement repertoires={reps} onClose={() => { setManaging(false); loadTodayTraining() }} onChanged={refreshCatalog} />
    }
    return (
      <div style={{ ...panelStyle, width: 'min(560px, calc(100vw - 32px))' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(28,27,24,0.04), 0 8px 24px rgba(28,27,24,0.05)' }}>
          <p style={{ fontSize: 14, color: '#37352f', marginBottom: 10 }}>No repertoires loaded.</p>
          <p style={{ fontSize: 12, color: '#a3a099', marginBottom: 14 }}>Add your first Lichess study to build its complete drill tree.</p>
          <button onClick={() => setManaging(true)} style={primaryPillStyle}>Manage repertoires</button>
        </div>
      </div>
    )
  }

  if (managing) {
    return <RepertoireManagement repertoires={reps} onClose={() => { setManaging(false); loadTodayTraining() }} onChanged={refreshCatalog} />
  }

  const todayReady = today?.settings ? today.entries.length : 0
  const filteredReps = search.trim()
    ? reps.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    : reps

  const selectedChapterCount = selectedChapters.size

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <div style={modeSegStyle}>
          <button
            onClick={() => setMode('repertoire')}
            style={{ ...modeTabStyle, ...(mode === 'repertoire' ? modeTabOnStyle : {}) }}
          >
            By repertoire
          </button>
          <button
            onClick={() => setMode('mixed')}
            style={{ ...modeTabStyle, ...(mode === 'mixed' ? modeTabOnStyle : {}) }}
          >
            Mixed training
          </button>
        </div>
        <button onClick={() => setManaging(true)} style={ghostPillStyle}>Manage</button>
      </div>

      {mode === 'mixed' ? (
        <div style={{ background: '#fff', borderRadius: 20, padding: 40, boxShadow: '0 1px 2px rgba(28,27,24,0.04), 0 12px 32px rgba(28,27,24,0.06)', textAlign: 'center' }}>
          <h1 className="serif" style={{ margin: '0 0 8px', fontSize: 32, fontWeight: 500 }}>Mixed training</h1>
          <p style={{ fontSize: 14, color: '#6a675f', margin: '0 0 26px' }}>
            A shuffled queue across every repertoire you&rsquo;re due for.
          </p>
          <button
            onClick={onResumeToday}
            disabled={starting || !today?.settings || todayReady === 0}
            style={{ ...darkPillStyle, opacity: starting || todayReady === 0 ? 0.5 : 1, cursor: starting || todayReady === 0 ? 'default' : 'pointer' }}
          >
            {starting ? 'Starting…' : 'Start mixed training'}
          </button>
        </div>
      ) : (
        <>
          {selected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
              <h1 className="serif" style={{ margin: 0, fontSize: 40, fontWeight: 500, letterSpacing: '-0.5px' }}>
                {selected.name}
              </h1>
              <span
                className="mono"
                style={{ fontSize: 11, fontWeight: 700, color: '#2f6db0', background: '#ecf3fb', padding: '4px 10px', borderRadius: 6 }}
              >
                {selected.side === 'w' ? 'WHITE' : 'BLACK'}
              </span>
            </div>
          )}

          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="lbl" style={{ color: '#b4b1a8' }}>Repertoire</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, background: '#f5f4ef', width: 180 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="5" cy="5" r="3.6" stroke="#b4b1a8" strokeWidth="1.3" />
                  <path d="M7.7 7.7L10.5 10.5" stroke="#b4b1a8" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: '#37352f', width: '100%' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {filteredReps.map((r) => {
                const isSel = r.id === selectedId
                const isWhite = r.side === 'w'
                return (
                  <button
                    key={r.id}
                    onClick={() => selectRepertoire(r.id, r.chapters.map((c) => c.id))}
                    style={{ ...pillStyle, ...(isSel ? pillOnStyle : {}) }}
                  >
                    <span
                      title={isWhite ? 'White' : 'Black'}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: isWhite ? '#fff' : '#1c1b18',
                        boxShadow: isWhite ? 'inset 0 0 0 1.5px #c9c6bc' : 'inset 0 0 0 1.5px #1c1b18',
                        flexShrink: 0,
                      }}
                    />
                    {r.name}
                    <span style={{ fontSize: 11, color: isSel ? '#3974ad' : '#a3a099' }}>
                      {r.chapters.length} chapter{r.chapters.length === 1 ? '' : 's'}
                    </span>
                  </button>
                )
              })}
              {filteredReps.length === 0 && (
                <span style={{ fontSize: 13, color: '#a3a099', padding: '8px 4px' }}>No repertoires match &ldquo;{search}&rdquo;.</span>
              )}
            </div>
          </div>

          {selected && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="lbl" style={{ color: '#b4b1a8' }}>Chapters</div>
                <span style={{ fontSize: 12, color: '#a3a099' }}>{selectedChapterCount} of {selected.chapters.length} selected</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {selected.chapters.map((ch) => {
                  const isOn = selectedChapters.has(ch.id)
                  const lines = chapterLinesById[ch.id] ?? []
                  const isExpanded = expandedChapters.has(ch.id)
                  return (
                    <div key={ch.id} style={{ ...chipStyle, ...(isOn ? chipOnStyle : {}) }}>
                      <button
                        onClick={() => toggleChapter(ch.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                      >
                        {isOn && (
                          <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="#2f6db0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        {ch.name}
                        <span style={{ color: isOn ? '#6a675f' : '#a3a099' }}>
                          &middot; {fullRep?.id === selectedId ? lines.length : '…'}
                        </span>
                      </button>
                      <button
                        onClick={() => toggleExpanded(ch.id)}
                        title={isExpanded ? 'Hide lines' : 'Show lines'}
                        style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: '0 0 0 4px', cursor: 'pointer', color: '#a3a099' }}
                      >
                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ transform: isExpanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.1s' }}>
                          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>

              {[...expandedChapters].map((chapterId) => {
                const ch = selected.chapters.find((c) => c.id === chapterId)
                if (!ch) return null
                return (
                  <div
                    key={chapterId}
                    style={{
                      marginTop: 10,
                      padding: 6,
                      background: '#fbfaf7',
                      border: '1px solid #eae8e2',
                      borderRadius: 12,
                      maxHeight: 220,
                      overflow: 'auto',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#a3a099', padding: '6px 8px 2px' }}>{ch.name}</div>
                    <LineList lines={chapterLinesById[chapterId] ?? []} loading={fullRepLoading && !fullRep} />
                  </div>
                )
              })}
            </div>
          )}

          {startError && <p style={{ fontSize: 12, color: '#c0392b', marginBottom: 12 }}>{startError}</p>}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingTop: 8 }}>
            <button
              onClick={handleStart}
              disabled={starting || !selectedId || selectedChapterCount === 0}
              style={{ ...darkPillStyle, opacity: starting || !selectedId || selectedChapterCount === 0 ? 0.5 : 1, cursor: starting || !selectedId || selectedChapterCount === 0 ? 'default' : 'pointer' }}
            >
              {starting ? 'Starting…' : 'Start session'}
              {!starting && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const modeSegStyle: React.CSSProperties = {
  display: 'inline-flex',
  background: '#f0efe9',
  borderRadius: 999,
  padding: 4,
  gap: 2,
}

const modeTabStyle: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  color: '#6a675f',
  display: 'flex',
  alignItems: 'center',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
}

const modeTabOnStyle: React.CSSProperties = {
  background: '#4a90d9',
  color: '#fff',
  boxShadow: '0 4px 12px rgba(74,144,217,0.35)',
}

const ghostPillStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: '#3974ad',
  background: '#f2f8fd',
  border: 'none',
  borderRadius: 10,
  padding: '9px 15px',
  cursor: 'pointer',
}

const primaryPillStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  background: '#4a90d9',
  color: '#fff',
  cursor: 'pointer',
}

const darkPillStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#fff',
  background: '#1c1b18',
  border: 'none',
  borderRadius: 999,
  padding: '15px 28px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  boxShadow: '0 12px 26px rgba(28,27,24,0.18)',
}

const pillStyle: React.CSSProperties = {
  border: '1.5px solid #e3e0d6',
  borderRadius: 999,
  padding: '8px 16px 8px 12px',
  fontSize: 13,
  fontWeight: 500,
  color: '#37352f',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: '#fff',
  cursor: 'pointer',
}

const pillOnStyle: React.CSSProperties = {
  border: '1.5px solid #4a90d9',
  background: '#eef6fd',
}

const chipStyle: React.CSSProperties = {
  border: '1.5px solid #e3e0d6',
  borderRadius: 999,
  padding: '9px 14px',
  fontSize: 13.5,
  color: '#a3a099',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const chipOnStyle: React.CSSProperties = {
  border: '1.5px solid #4a90d9',
  background: '#eef6fd',
  color: '#1c1b18',
}

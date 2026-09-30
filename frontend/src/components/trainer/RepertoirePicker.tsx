'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listRepertoires, getRepertoire, getTodayTraining } from '@/lib/api/client'
import type { TodayTrainingResponse } from '@/lib/api/client'
import RepertoireManagement from '@/components/trainer/RepertoireManagement'
import LineList from '@/components/trainer/LineList'
import { useIsPhoneLike } from '@/hooks/useViewportWidth'
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
  const { compact, short } = useIsPhoneLike()
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
  const railRef = useRef<HTMLDivElement | null>(null)
  const [railMore, setRailMore] = useState(false)
  const updateRailMore = useCallback(() => {
    const rail = railRef.current
    setRailMore(!!rail && rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const rail = railRef.current
    const pill = rail?.querySelector<HTMLElement>(`[data-rep-id="${selectedId}"]`)
    if (!rail || !pill) return
    rail.scrollTo({ left: pill.offsetLeft - (rail.clientWidth - pill.offsetWidth) / 2, behavior: 'smooth' })
  }, [selectedId, compact, reps])

  useEffect(() => {
    updateRailMore()
  }, [compact, reps, updateRailMore])

  function selectRepertoire(id: string, chapterIds: string[], fresh = false) {
    setSelectedId(id)
    setSelectedChapters(new Set(chapterIds))
    setFullRep(null)
    setExpandedChapters(new Set())

    const reqId = ++fullRepReqId.current
    setFullRepLoading(true)
    getRepertoire(id, {
      fresh,
      onUpdate: (rep) => {
        if (reqId === fullRepReqId.current) setFullRep(rep)
      },
    })
      .then((rep) => {
        if (reqId === fullRepReqId.current) setFullRep(rep)
      })
      .catch(() => {
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
    listRepertoires({ onUpdate: (list) => setReps(list) })
      .then((list) => {
        setReps(list)
        if (list.length > 0) selectRepertoire(list[0].id, list[0].chapters.map((c) => c.id))
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to reach the backend.'))
    loadTodayTraining()
  }, [loadTodayTraining])

  const selected = reps?.find((r) => r.id === selectedId) ?? null

  const chapterLinesById = useMemo(() => {
    const map: Record<string, ChapterLine[]> = {}
    if (fullRep?.id !== selectedId) return map
    for (const chapter of fullRep.chapters) {
      map[chapter.id] = enumerateLines(chapter.tree).filter((l) => !l.hasExcluded)
    }
    return map
  }, [fullRep, selectedId])

  const refreshCatalog = (changedId?: string) => {
    listRepertoires({ fresh: true })
      .then((list) => {
        setReps(list)
        const changed = changedId ? list.find((r) => r.id === changedId) : undefined
        if (changed && changed.id === selectedId) {
          selectRepertoire(changed.id, changed.chapters.map((chapter) => chapter.id), true)
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

  const toggleAllChapters = (ids: string[]) => {
    setSelectedChapters((prev) => (prev.size > 0 ? new Set() : new Set(ids)))
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
    margin: compact ? '16px auto' : '32px auto',
    padding: '0 4px',
  }

  if (listError) {
    return (
      <div style={{ ...panelStyle, width: 'min(560px, calc(100vw - 32px))' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 'clamp(16px, 5vw, 24px)', boxShadow: '0 1px 2px rgba(28,27,24,0.04), 0 8px 24px rgba(28,27,24,0.05)' }}>
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
        <div style={{ background: '#fff', borderRadius: 16, padding: 'clamp(16px, 5vw, 24px)', boxShadow: '0 1px 2px rgba(28,27,24,0.04), 0 8px 24px rgba(28,27,24,0.05)' }}>
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

  const todayReady = today?.settings ? today.entryCount : 0
  const filteredReps = search.trim()
    ? reps.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    : reps

  const selectedChapterCount = selectedChapters.size
  const totalLines = Object.values(chapterLinesById).reduce((n, l) => n + l.length, 0)
  const selectedLines = [...selectedChapters].reduce((n, id) => n + (chapterLinesById[id]?.length ?? 0), 0)

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: compact ? 14 : 22 }}>
        <div style={compact ? { ...modeSegStyle, flex: 1 } : modeSegStyle}>
          <button
            onClick={() => setMode('repertoire')}
            style={{ ...modeTabStyle, ...(compact ? modeTabCompactStyle : {}), ...(mode === 'repertoire' ? (compact ? modeTabCompactOnStyle : modeTabOnStyle) : {}) }}
          >
            By repertoire
          </button>
          <button
            onClick={() => setMode('mixed')}
            style={{ ...modeTabStyle, ...(compact ? modeTabCompactStyle : {}), ...(mode === 'mixed' ? (compact ? modeTabCompactOnStyle : modeTabOnStyle) : {}) }}
          >
            Mixed training
          </button>
        </div>
        {compact ? (
          <button onClick={() => setManaging(true)} title="Manage repertoires" aria-label="Manage repertoires" style={gearBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 4.3a1.7 1.7 0 0 1 3.4 0 1.7 1.7 0 0 0 2.6 1.1 1.7 1.7 0 0 1 2.4 2.4 1.7 1.7 0 0 0 1.1 2.6 1.7 1.7 0 0 1 0 3.4 1.7 1.7 0 0 0-1.1 2.6 1.7 1.7 0 0 1-2.4 2.4 1.7 1.7 0 0 0-2.6 1.1 1.7 1.7 0 0 1-3.4 0 1.7 1.7 0 0 0-2.6-1.1 1.7 1.7 0 0 1-2.4-2.4 1.7 1.7 0 0 0-1.1-2.6 1.7 1.7 0 0 1 0-3.4 1.7 1.7 0 0 0 1.1-2.6 1.7 1.7 0 0 1 2.4-2.4 1.7 1.7 0 0 0 2.6-1.1z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        ) : (
          <button onClick={() => setManaging(true)} style={ghostPillStyle}>Manage</button>
        )}
      </div>

      {mode === 'mixed' ? (
        <div style={{ background: '#fff', borderRadius: 20, padding: 'clamp(20px, 6vw, 40px)', boxShadow: '0 1px 2px rgba(28,27,24,0.04), 0 12px 32px rgba(28,27,24,0.06)', textAlign: 'center' }}>
          <h1 className="serif" style={{ margin: '0 0 8px', fontSize: 'clamp(24px, 7vw, 32px)', fontWeight: 500 }}>Mixed training</h1>
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
      ) : compact ? (
        <div style={{ paddingBottom: short ? 64 : 92 }}>
          {selected && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h1 className="serif" style={{ margin: 0, fontSize: 27, fontWeight: 500, letterSpacing: '-0.5px', lineHeight: 1.1 }}>{selected.name}</h1>
                <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: '#2f6db0', background: '#dfeaf7', padding: '3px 7px', borderRadius: 5, letterSpacing: 0.4 }}>
                  {selected.side === 'w' ? 'WHITE' : 'BLACK'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#8a877e', marginTop: 3 }}>
                {selected.chapters.length} chapters{fullRep?.id === selectedId ? ` \u00b7 ${totalLines} line${totalLines === 1 ? '' : 's'}` : ''}
              </div>
            </>
          )}

          <div className="lbl" style={{ color: '#a3a099', marginTop: 16 }}>Repertoire</div>
          <div
            ref={railRef}
            onScroll={updateRailMore}
            style={{
              display: 'flex', gap: 6, overflowX: 'auto', margin: '8px -4px 0', padding: '0 4px 2px', scrollbarWidth: 'none',
              ...(railMore ? { WebkitMaskImage: 'linear-gradient(90deg, #000 88%, transparent)', maskImage: 'linear-gradient(90deg, #000 88%, transparent)' } : {}),
            }}
          >
            {reps.map((r) => {
              const isSel = r.id === selectedId
              const isWhite = r.side === 'w'
              return (
                <button
                  key={r.id}
                  data-rep-id={r.id}
                  onClick={() => selectRepertoire(r.id, r.chapters.map((c) => c.id))}
                  style={{ ...pillStyle, ...pillCompactStyle, flex: 'none', whiteSpace: 'nowrap', ...(isSel ? pillDarkOnStyle : {}) }}
                >
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: isWhite ? '#fff' : isSel ? '#fff' : '#1c1b18',
                      boxShadow: isWhite ? 'inset 0 0 0 1.5px #b9b6ab' : isSel ? 'none' : 'inset 0 0 0 1.5px #1c1b18',
                    }}
                  />
                  {r.name}
                </button>
              )
            })}
          </div>

          {selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <span className="lbl" style={{ color: '#a3a099' }}>Chapters &middot; {selectedChapterCount} of {selected.chapters.length}</span>
                <button
                  onClick={() => toggleAllChapters(selected.chapters.map((c) => c.id))}
                  style={{ background: 'none', border: 'none', padding: '10px 0 10px 12px', margin: '-10px 0', fontSize: 12, fontWeight: 600, color: '#3974ad', cursor: 'pointer' }}
                >
                  {selectedChapterCount > 0 ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div style={{ background: '#fff', borderRadius: 14, marginTop: 6, overflow: 'hidden', boxShadow: '0 1px 2px rgba(28,27,24,0.04)' }}>
                {selected.chapters.map((ch, i) => {
                  const isOn = selectedChapters.has(ch.id)
                  const isExpanded = expandedChapters.has(ch.id)
                  return (
                    <div key={ch.id} style={{ borderTop: i === 0 ? 'none' : '0.5px solid #eeece6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', minHeight: 44 }}>
                        <button
                          onClick={() => toggleChapter(ch.id)}
                          aria-pressed={isOn}
                          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: '0 4px 0 12px', height: 44, cursor: 'pointer', font: 'inherit', fontSize: 13, textAlign: 'left', color: isOn ? '#1c1b18' : '#a3a099' }}
                        >
                          <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: isOn ? '1.5px solid #4a90d9' : '1.5px solid #cfccc2', background: isOn ? '#4a90d9' : 'transparent' }}>
                            {isOn && (
                              <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                          <span style={{ fontSize: 12, color: '#a3a099', fontVariantNumeric: 'tabular-nums' }}>
                            {fullRep?.id === selectedId ? (chapterLinesById[ch.id]?.length ?? 0) : '\u2026'}
                          </span>
                        </button>
                        <button
                          onClick={() => toggleExpanded(ch.id)}
                          title={isExpanded ? 'Hide lines' : 'Show lines'}
                          aria-label={isExpanded ? 'Hide lines' : 'Show lines'}
                          style={{ width: 40, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#b4b1a8' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" style={{ transform: isExpanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.1s' }}>
                            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                      {isExpanded && (
                        <div style={{ background: '#fbfaf7', borderTop: '0.5px solid #eeece6', padding: '2px 6px 6px', maxHeight: 220, overflow: 'auto' }}>
                          <LineList lines={chapterLinesById[ch.id] ?? []} loading={fullRepLoading && !fullRep} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {startError && <p style={{ fontSize: 12, color: '#c0392b', margin: '12px 0 0' }}>{startError}</p>}

          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: short ? '14px 16px calc(8px + env(safe-area-inset-bottom))' : '22px 16px calc(14px + env(safe-area-inset-bottom))', background: 'linear-gradient(rgba(232,232,230,0), #e8e8e6 38%)', zIndex: 20, pointerEvents: 'none' }}>
            <button
              onClick={handleStart}
              disabled={starting || !selectedId || selectedChapterCount === 0}
              style={{ width: '100%', maxWidth: 480, margin: '0 auto', height: short ? 40 : 48, border: 'none', borderRadius: 999, background: '#1c1b18', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: short ? '0 5px 0 18px' : '0 8px 0 20px', fontSize: 14, fontWeight: 700, opacity: starting || selectedChapterCount === 0 ? 0.55 : 1, cursor: starting || selectedChapterCount === 0 ? 'default' : 'pointer', boxShadow: '0 10px 22px rgba(28,27,24,0.18)', pointerEvents: 'auto' }}
            >
              <span style={{ textAlign: 'left' }}>
                {starting ? 'Starting\u2026' : 'Start session'}
                <span style={{ display: short ? 'inline' : 'block', marginLeft: short ? 10 : 0, fontSize: 11.5, fontWeight: 400, color: '#b9b6ab', lineHeight: 1.2 }}>
                  {selectedChapterCount} chapter{selectedChapterCount === 1 ? '' : 's'}{fullRep?.id === selectedId ? ` \u00b7 ${selectedLines} line${selectedLines === 1 ? '' : 's'}` : ''}
                </span>
              </span>
              <span style={{ width: short ? 30 : 34, height: short ? 30 : 34, borderRadius: '50%', background: '#4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {selected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12, marginBottom: compact ? 14 : 28 }}>
              <h1 className="serif" style={{ margin: 0, fontSize: 'clamp(22px, 6.5vw, 40px)', fontWeight: 500, letterSpacing: '-0.5px' }}>
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

          <div style={{ marginBottom: compact ? 16 : 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 8 : 12 }}>
              <div className="lbl" style={{ color: '#b4b1a8' }}>Repertoire</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '5px 10px' : '7px 12px', borderRadius: 999, background: '#f5f4ef', width: 'min(180px, 45vw)' }}>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 6 : 8 }}>
              {filteredReps.map((r) => {
                const isSel = r.id === selectedId
                const isWhite = r.side === 'w'
                return (
                  <button
                    key={r.id}
                    onClick={() => selectRepertoire(r.id, r.chapters.map((c) => c.id))}
                    style={{ ...pillStyle, ...(compact ? pillCompactStyle : {}), ...(isSel ? pillOnStyle : {}) }}
                  >
                    <span
                      title={isWhite ? 'White' : 'Black'}
                      style={{
                        width: compact ? 8 : 10,
                        height: compact ? 8 : 10,
                        borderRadius: '50%',
                        background: isWhite ? '#fff' : '#1c1b18',
                        boxShadow: isWhite ? 'inset 0 0 0 1.5px #c9c6bc' : 'inset 0 0 0 1.5px #1c1b18',
                        flexShrink: 0,
                      }}
                    />
                    {r.name}
                    <span style={{ fontSize: compact ? 10.5 : 11, color: isSel ? '#3974ad' : '#a3a099' }}>
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
            <div style={{ marginBottom: compact ? 16 : 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div className="lbl" style={{ color: '#b4b1a8' }}>Chapters</div>
                <button
                  onClick={() => toggleAllChapters(selected.chapters.map((c) => c.id))}
                  style={{ ...ghostPillStyle, fontSize: 12, padding: compact ? '5px 10px' : '7px 12px' }}
                >
                  {selectedChapterCount > 0 ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#a3a099', marginBottom: compact ? 8 : 10 }}>{selectedChapterCount} of {selected.chapters.length} selected</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 6 : 8 }}>
                {selected.chapters.map((ch) => {
                  const isOn = selectedChapters.has(ch.id)
                  const lines = chapterLinesById[ch.id] ?? []
                  const isExpanded = expandedChapters.has(ch.id)
                  return (
                    <div key={ch.id} style={{ ...chipStyle, ...(compact ? chipCompactStyle : {}), ...(isOn ? chipOnStyle : {}) }}>
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

const pillCompactStyle: React.CSSProperties = {
  padding: '9px 13px 9px 11px',
  fontSize: 12.5,
  gap: 6,
}

const chipCompactStyle: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 12,
  gap: 4,
}

const modeTabCompactStyle: React.CSSProperties = {
  flex: 1,
  justifyContent: 'center',
  padding: '10px 0',
  fontSize: 12.5,
  fontWeight: 500,
}

const modeTabCompactOnStyle: React.CSSProperties = {
  background: '#fff',
  color: '#1c1b18',
  boxShadow: '0 1px 3px rgba(28,27,24,0.12)',
}

const gearBtnStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: '50%',
  border: 'none',
  background: '#f0efe9',
  color: '#6a675f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

const pillDarkOnStyle: React.CSSProperties = {
  background: '#1c1b18',
  border: '1.5px solid #1c1b18',
  color: '#fff',
}

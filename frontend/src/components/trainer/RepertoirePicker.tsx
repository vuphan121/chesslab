'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Listbox } from '@headlessui/react'
import { listRepertoires, getRepertoire, getTodayTraining } from '@/lib/api/client'
import type { TodayTrainingResponse } from '@/lib/api/client'
import RepertoireManagement from '@/components/trainer/RepertoireManagement'
import LineList from '@/components/trainer/LineList'
import { enumerateLines } from '@/lib/trainer/lineQueue'
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
      return <RepertoireManagement repertoires={reps} onClose={() => { setManaging(false); loadTodayTraining() }} onChanged={refreshCatalog} />
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
    return <RepertoireManagement repertoires={reps} onClose={() => { setManaging(false); loadTodayTraining() }} onChanged={refreshCatalog} />
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
          <h2 className="serif" style={{ fontSize: 18, fontWeight: 500 }}>Mixed training</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          {today?.settings && (
            <span style={{ fontSize: 12, color: '#6a675f' }}>
              {today.entries.length} line{today.entries.length === 1 ? '' : 's'} ready
            </span>
          )}
          <button
            onClick={onResumeToday}
            disabled={starting || !today?.settings || (today.entries.length ?? 0) === 0}
            style={{ fontSize: 12, fontWeight: 700, padding: '8px 13px', borderRadius: 7, border: 'none', background: starting ? '#a9c9e8' : '#4a90d9', color: '#fff', cursor: starting ? 'default' : 'pointer', marginLeft: 'auto' }}
          >
            {starting ? 'Starting…' : 'Start mixed training'}
          </button>
        </div>
      </div>

      <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
        Choose a repertoire
      </div>
      <Listbox
        value={selectedId}
        onChange={(id) => {
          const r = reps.find((x) => x.id === id)
          if (r) selectRepertoire(r.id, r.chapters.map((c) => c.id))
        }}
      >
        <div style={{ position: 'relative', marginBottom: 22 }}>
          <Listbox.Button
            style={{
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid #4a90d9',
              background: '#f2f8fd',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            {selected ? (
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{selected.name}</span>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: '#2f6db0', background: '#ecf3fb', padding: '1px 7px', borderRadius: 5 }}
                  >
                    {selected.side === 'w' ? 'White' : 'Black'}
                  </span>
                  <span style={{ fontSize: 11, color: '#a3a099' }}>
                    {selected.lineCount} line{selected.lineCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#b4b1a8', marginTop: 2, overflowWrap: 'anywhere' }}>
                  {selected.chapters.length} chapters
                  {selected.source && (
                    <>
                      {' · '}
                      <span className="mono">{selected.source}</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <span style={{ fontSize: 13, color: '#a3a099' }}>Select a repertoire…</span>
            )}
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, color: '#3974ad' }}>
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Listbox.Button>
          <Listbox.Options
            style={{
              position: 'absolute',
              zIndex: 20,
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              maxHeight: 320,
              overflowY: 'auto',
              background: '#fff',
              border: '1px solid #eae8e2',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
              padding: 6,
              margin: 0,
              listStyle: 'none',
            }}
          >
            {reps.map((r) => (
                <Listbox.Option key={r.id} value={r.id} as={Fragment}>
                  {({ active, selected: isSel }) => (
                    <li
                      style={{
                        cursor: 'pointer',
                        padding: '10px 12px',
                        borderRadius: 7,
                        background: isSel ? '#f2f8fd' : active ? '#fbfaf7' : 'transparent',
                        border: isSel ? '1px solid #4a90d9' : '1px solid transparent',
                        marginBottom: 2,
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
                        <span style={{ fontSize: 11, color: '#a3a099' }}>{r.lineCount} line{r.lineCount === 1 ? '' : 's'}</span>
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
                    </li>
                  )}
                </Listbox.Option>
              ))}
          </Listbox.Options>
        </div>
      </Listbox>

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
                        padding: '4px',
                        background: '#fbfaf7',
                        border: '1px solid #eae8e2',
                        borderRadius: 7,
                        maxHeight: 260,
                        overflow: 'auto',
                      }}
                    >
                      <LineList lines={lines} loading={fullRepLoading && !fullRep} />
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

'use client'

import { useEffect, useRef, useState } from 'react'
import { listRepertoires, getRepertoire } from '@/lib/api/client'
import { toFigurine } from '@/lib/chess/figurine'
import type { RepertoireSummary, Repertoire, RepNode } from '@/lib/trainer/types'
import type { SessionOptions } from '@/lib/trainer/types'

// enumerateLines walks every path from a chapter's root to a leaf (mainline
// and every variation, at any nesting depth) and returns each as one line —
// a plain preview of everything the chapter contains, not just the
// repertoire's own accepted answers.
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

// formatLine renders a line's SAN list as "1.O-O b5 2.Ne5 ..." — figurine
// notation, move-numbered from the chapter root (ply 0).
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
  starting: boolean
  startError: string | null
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 7,
              border: active ? 'none' : '1px solid #eae8e2',
              background: active ? '#4a90d9' : '#fff',
              color: active ? '#fff' : '#6a675f',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function RepertoirePicker({ onStart, starting, startError }: Props) {
  const [reps, setReps] = useState<RepertoireSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set())
  const [sessionLength, setSessionLength] = useState<number | null>(40)
  const [newLimit, setNewLimit] = useState(8)
  const [mode, setMode] = useState<SessionOptions['mode']>('mixed')

  // Full repertoire (chapters + trees) — only needed to preview a chapter's
  // lines, so it's fetched lazily once a repertoire is selected rather than
  // upfront for every repertoire in the list.
  const [fullRep, setFullRep] = useState<Repertoire | null>(null)
  const [fullRepLoading, setFullRepLoading] = useState(false)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())

  const fullRepReqId = useRef(0)

  // selectRepertoire is the single place a repertoire gets selected — from
  // the initial-load callback or a row click, never from an effect reacting
  // to state. It resets whatever was expanded/loaded for the *previous*
  // selection and kicks off the fetch of the full tree data (needed for the
  // line previews) directly, the same way data fetches elsewhere in this
  // app are triggered by the action that needs them rather than by watching
  // state change. reqId guards against a slow, now-superseded fetch
  // clobbering a later selection if they resolve out of order.
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
        // preview just won't be available; chapter selection still works off the summary list
      })
      .finally(() => {
        if (reqId === fullRepReqId.current) setFullRepLoading(false)
      })
  }

  useEffect(() => {
    listRepertoires()
      .then((list) => {
        setReps(list)
        if (list.length > 0) selectRepertoire(list[0].id, list[0].chapters.map((c) => c.id))
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to reach the backend.'))
  }, [])

  const selected = reps?.find((r) => r.id === selectedId) ?? null

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
    onStart(selectedId, [...selectedChapters], { sessionLength, newLimit, mode })
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
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 14, color: '#37352f', marginBottom: 10 }}>No repertoires loaded.</p>
        <p style={{ fontSize: 12, color: '#a3a099', marginBottom: 10 }}>
          Drop a study PGN + config into <code>backend/data/repertoires/</code>, e.g.:
        </p>
        <pre className="mono" style={{ fontSize: 12, background: '#fbfaf7', padding: 10, borderRadius: 6 }}>
          curl -sL https://lichess.org/api/study/&lt;id&gt;.pgn -o backend/data/repertoires/name.pgn
        </pre>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, marginBottom: 18 }}>
        Opening Study
      </h1>

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
              <div style={{ fontSize: 12, color: '#7a776f', marginTop: 4 }}>{r.description}</div>
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
              const lines = chapterTree ? enumerateLines(chapterTree) : []
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
                      <span style={{ fontSize: 11, color: '#a3a099' }}>{ch.cardCount} positions</span>
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
                          <p
                            key={i}
                            className="mono"
                            style={{
                              fontSize: 12,
                              lineHeight: 1.7,
                              color: line.hasExcluded ? '#c0392b' : '#4a4740',
                              opacity: line.hasExcluded ? 0.75 : 1,
                              textDecoration: line.hasExcluded ? 'line-through' : undefined,
                            }}
                          >
                            {formatLine(line.sans)}
                            {line.hasExcluded && (
                              <span
                                className="sans-serif"
                                style={{ marginLeft: 6, textDecoration: 'none', fontSize: 11, color: '#c0392b' }}
                              >
                                (not part of the repertoire)
                              </span>
                            )}
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

      <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
        Session
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#6a675f', width: 80 }}>Length</span>
          <Segmented
            options={[
              { label: '20', value: 20 },
              { label: '40', value: 40 },
              { label: '80', value: 80 },
              { label: 'Until done', value: -1 },
            ]}
            value={sessionLength ?? -1}
            onChange={(v) => setSessionLength(v === -1 ? null : v)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#6a675f', width: 80 }}>New cards</span>
          <Segmented
            options={[
              { label: '4', value: 4 },
              { label: '8', value: 8 },
              { label: '16', value: 16 },
              { label: 'None', value: 0 },
            ]}
            value={newLimit}
            onChange={setNewLimit}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#6a675f', width: 80 }}>Mode</span>
          <Segmented
            options={[
              { label: 'Mixed', value: 'mixed' as const },
              { label: 'Review only', value: 'review-only' as const },
              { label: 'Mistakes', value: 'mistakes' as const },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      </div>

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

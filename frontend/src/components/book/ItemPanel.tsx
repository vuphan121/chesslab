'use client'

import type { FlatItem, BookFeedback } from '@/hooks/useBookStudySession'

const SOLVED_COLORS = { fg: 'oklch(0.45 0.13 152)', bg: 'oklch(0.95 0.045 152)' }

interface Props {
  current: FlatItem
  index: number
  total: number
  feedback: BookFeedback | null
  lessonStarted: boolean
  completed: boolean
  busy: boolean
  onPrev: () => void
  onNext: () => void
  onStartLesson: () => void
  onRevealSolution: () => void
}

export default function ItemPanel({
  current,
  index,
  total,
  feedback,
  lessonStarted,
  completed,
  busy,
  onPrev,
  onNext,
  onStartLesson,
  onRevealSolution,
}: Props) {
  const { item } = current
  const isPuzzle = item.type === 'puzzle'
  const lessonIdle = !isPuzzle && !lessonStarted
  // Puzzle notes describe the tactical idea, so they'd spoil an unsolved
  // puzzle — only show once this session's solve/reveal fired, or it was
  // already completed in an earlier session (per the persisted checkmark).
  const showNote = item.note && (isPuzzle ? feedback?.kind === 'solved' || completed : !lessonIdle)

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #efeee9' }}>
        <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>Chapter {current.chapterNumber}</span>
          <span>
            {index + 1} / {total}
          </span>
        </div>
        <div className="serif" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.3 }}>
          {current.chapterName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <span
            className="mono"
            style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 600,
              color: isPuzzle ? '#8a5a1c' : '#2f6db0',
              background: isPuzzle ? '#fdf3e4' : '#ecf3fb',
              padding: '2px 8px',
              borderRadius: 5,
            }}
          >
            {isPuzzle ? 'Puzzle' : 'Lesson'}
          </span>
          {completed && (
            <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 700 }} title="Completed">
              ✓
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 16px' }}>
        <p style={{ fontSize: 14, color: '#37352f', lineHeight: 1.5 }}>{item.prompt}</p>

        {showNote && (
          <p className="serif" style={{ fontSize: 13, color: '#4a4740', lineHeight: 1.5, marginTop: 12 }}>
            {item.note}
          </p>
        )}

        {lessonIdle && (
          <button
            onClick={onStartLesson}
            disabled={busy}
            style={{
              marginTop: 14,
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: '#4a90d9',
              border: 'none',
              borderRadius: 8,
              padding: '9px 16px',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Start lesson
          </button>
        )}

        {isPuzzle && item.solution && item.solution.length > 0 && (
          <button
            onClick={onRevealSolution}
            disabled={busy}
            style={{
              marginTop: 14,
              fontSize: 12,
              fontWeight: 600,
              color: '#6a675f',
              background: '#f0efe9',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Show solution
          </button>
        )}
      </div>

      <div
        aria-live="polite"
        style={{
          height: 40,
          flexShrink: 0,
          margin: '0 16px',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          fontSize: 12,
          color: feedback ? SOLVED_COLORS.fg : 'transparent',
          background: feedback ? SOLVED_COLORS.bg : 'transparent',
          transition: 'background 0.18s, color 0.18s',
        }}
      >
        {feedback?.kind === 'solved' && 'Solved!'}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 16px' }}>
        <button
          onClick={onPrev}
          disabled={index === 0 || busy}
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            padding: '9px 0',
            borderRadius: 8,
            border: '1px solid #eae8e2',
            background: '#fff',
            color: index === 0 ? '#d6d3ca' : '#37352f',
            cursor: index === 0 || busy ? 'default' : 'pointer',
          }}
        >
          ⟨ Previous
        </button>
        <button
          onClick={onNext}
          disabled={busy}
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            padding: '9px 0',
            borderRadius: 8,
            border: 'none',
            background: '#4a90d9',
            color: '#fff',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Next ⟩
        </button>
      </div>
    </div>
  )
}

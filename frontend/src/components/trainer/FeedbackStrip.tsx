'use client'

import type { Feedback } from '@/hooks/useTrainerSession'

interface Props {
  feedback: Feedback | null
}

const COLORS = {
  correct: { fg: 'oklch(0.42 0.13 152)', bg: 'oklch(0.94 0.055 152)', dot: 'oklch(0.62 0.16 152)' },
  incorrect: { fg: 'oklch(0.48 0.16 25)', bg: 'oklch(0.945 0.05 25)', dot: 'oklch(0.62 0.19 25)' },
}

export default function FeedbackStrip({ feedback }: Props) {
  if (!feedback) return <span aria-live="polite" />
  const isCorrect = feedback.kind === 'correct' || feedback.kind === 'correct-alt'
  const colors = isCorrect ? COLORS.correct : COLORS.incorrect
  const label = feedback.kind === 'error' ? 'Move failed — try again' : isCorrect ? 'Correct' : 'Incorrect'

  return (
    <span
      aria-live="polite"
      title={feedback.reason}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginLeft: 'auto',
        height: 22,
        padding: '0 10px 0 4px',
        borderRadius: 11,
        background: colors.bg,
        color: colors.fg,
        fontSize: 12.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 16, height: 16, borderRadius: '50%', background: colors.dot, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        {isCorrect ? (
          <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="7" height="7" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </span>
      {label}
    </span>
  )
}

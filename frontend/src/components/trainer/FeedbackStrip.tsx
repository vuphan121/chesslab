'use client'

import type { Feedback } from '@/hooks/useTrainerSession'

interface Props {
  feedback: Feedback | null
  compact?: boolean
}

const COLORS = {
  correct: { fg: 'oklch(0.45 0.13 152)', bg: 'oklch(0.95 0.045 152)' },
  incorrect: { fg: 'oklch(0.5 0.16 25)', bg: 'oklch(0.955 0.04 25)' },
}

export default function FeedbackStrip({ feedback, compact = false }: Props) {
  const isCorrect = feedback?.kind === 'correct' || feedback?.kind === 'correct-alt'
  const colors = isCorrect ? COLORS.correct : COLORS.incorrect
  const label = feedback?.kind === 'error' ? 'Move failed — try again' : isCorrect ? 'Correct' : 'Incorrect'

  return (
    <div
      aria-live="polite"
      style={{
        minHeight: compact ? 44 : 96,
        width: compact ? '100%' : undefined,
        flexShrink: 0,
        borderRadius: compact ? 10 : 14,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? '6px 10px' : '18px 14px',
        color: feedback ? colors.fg : 'transparent',
        background: feedback ? colors.bg : 'transparent',
        transition: 'background 0.18s, color 0.18s',
      }}
    >
      {feedback && (
        <span title={feedback.reason} style={{ fontSize: compact ? 15 : 18, fontWeight: 700, textAlign: 'center' }}>{label}</span>
      )}
    </div>
  )
}

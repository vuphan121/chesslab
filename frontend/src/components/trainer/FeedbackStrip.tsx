'use client'

import type { Feedback } from '@/hooks/useTrainerSession'

interface Props {
  feedback: Feedback | null
}

const COLORS = {
  correct: { fg: 'oklch(0.45 0.13 152)', bg: 'oklch(0.95 0.045 152)' },
  incorrect: { fg: 'oklch(0.5 0.16 25)', bg: 'oklch(0.955 0.04 25)' },
  excluded: { fg: 'oklch(0.55 0.11 75)', bg: 'oklch(0.96 0.05 75)' },
}

export default function FeedbackStrip({ feedback }: Props) {
  let content: React.ReactNode = null
  let colors = COLORS.correct

  if (feedback) {
    switch (feedback.kind) {
      case 'correct':
        colors = COLORS.correct
        content = (
          <>
            <strong>✓ Correct</strong> — {feedback.playedSan}
          </>
        )
        break
      case 'correct-alt':
        colors = COLORS.correct
        content = (
          <>
            <strong>✓ Also in your repertoire</strong> — {feedback.playedSan}
          </>
        )
        break
      case 'incorrect':
        colors = COLORS.incorrect
        content = (
          <>
            <strong>✗ Not your move</strong> — you played {feedback.playedSan}, the line is{' '}
            <strong>{feedback.expectedSan}</strong>. Try again.
          </>
        )
        break
      case 'excluded':
        colors = COLORS.excluded
        content = (
          <>
            <strong>! Not part of the repertoire</strong> — {feedback.playedSan} is in the study but marked
            out. Play <strong>{feedback.expectedSan}</strong> instead.
            {feedback.reason && (
              <span style={{ display: 'block', fontSize: 11, marginTop: 2, opacity: 0.85 }}>{feedback.reason}</span>
            )}
          </>
        )
        break
    }
  }

  return (
    <div
      aria-live="polite"
      style={{
        height: 48,
        flexShrink: 0,
        borderRadius: 9,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        fontSize: 13,
        color: feedback ? colors.fg : 'transparent',
        background: feedback ? colors.bg : 'transparent',
        transition: 'background 0.18s, color 0.18s',
      }}
    >
      {content}
      {feedback?.comment && (
        <span className="serif" style={{ marginLeft: 10, fontSize: 12, opacity: 0.85 }}>
          “{feedback.comment}”
        </span>
      )}
    </div>
  )
}

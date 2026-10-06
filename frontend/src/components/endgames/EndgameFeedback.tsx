'use client'

import type { EndgameFeedback } from '@/hooks/useEndgameSession'

const TONES = {
  good: '#2f6db0',
  bad: '#b34343',
  info: '#37352f',
}

export default function EndgameFeedbackLine({ feedback }: { feedback: EndgameFeedback | null }) {
  return (
    <span aria-live="polite" style={{ fontSize: 13, fontWeight: 600, color: feedback ? TONES[feedback.tone] : undefined }}>
      {feedback?.text ?? ''}
    </span>
  )
}

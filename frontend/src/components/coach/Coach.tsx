'use client'

import { useState, useRef, useEffect } from 'react'
import type { ChatTurn } from '@/lib/api/client'

interface CoachProps {
  // Path 1 — per-move explanation of the current position. Manually
  // triggered (see onAskCoach) rather than automatic, so scrubbing through a
  // game doesn't queue up a slow local-LLM call for every position passed
  // through — see useChessGame's askCoach.
  explanation: string | null
  explaining: boolean
  explainError: string | null
  // Fetches the explanation for whatever position is currently on the board.
  onAskCoach: () => void
  // False at the root (no move yet to explain) — disables the ask button.
  canAsk: boolean
  // Path 2 — freeform chat. Resolves to the coach's reply, or throws with a
  // user-facing message.
  onSendChat: (message: string, history: ChatTurn[]) => Promise<string>
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
  error?: boolean
}

// A three-dot "thinking" indicator — local model inference takes a few seconds.
function Thinking() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#c4c2ba',
            animation: 'coachPulse 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
      <style>{`@keyframes coachPulse { 0%, 60%, 100% { opacity: 0.3 } 30% { opacity: 1 } }`}</style>
    </div>
  )
}

// AskCoachButton is reused both for the empty-state prompt and the "ask
// again" link shown once an explanation is already pinned (e.g. after
// flipping the board, which clears the old one since it was framed for the
// other side).
function AskCoachButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void
  disabled: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        alignSelf: 'flex-start',
        border: 'none',
        borderRadius: 8,
        background: disabled ? '#f0efe9' : '#1c1b18',
        color: disabled ? '#a3a099' : '#fff',
        fontSize: 13,
        fontWeight: 600,
        padding: '8px 14px',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

export default function Coach({
  explanation,
  explaining,
  explainError,
  onAskCoach,
  canAsk,
  onSendChat,
}: CoachProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Keep the newest content in view as the explanation updates or chat grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, explanation, explaining])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return

    // History sent to the backend is the committed conversation so far (only
    // real user/assistant turns — no pending/error placeholders).
    const history: ChatTurn[] = messages
      .filter((m) => !m.pending && !m.error)
      .map((m) => ({ role: m.role, content: m.text }))

    setMessages((prev) => [
      ...prev,
      { role: 'user', text },
      { role: 'assistant', text: '', pending: true },
    ])
    setInput('')
    setSending(true)

    try {
      const reply = await onSendChat(text, history)
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', text: reply }
        return next
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Coach is unavailable right now.'
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', text: msg, error: true }
        return next
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #efeee9',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Coach</div>
          <div style={{ fontSize: 11, color: '#a3a099' }}>
            {explaining ? 'Thinking…' : 'Ask about the current move'}
          </div>
        </div>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Path 1 — explanation of the current position, pinned at top. Manually
            triggered, so idle (no explanation/error/in-flight request) shows a
            prompt to ask instead of firing automatically. */}
        {explainError ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: '#b06a56' }}>{explainError}</div>
            <AskCoachButton onClick={onAskCoach} disabled={!canAsk || explaining} label="Try again" />
          </div>
        ) : explaining && !explanation ? (
          <Thinking />
        ) : explanation ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              className="serif"
              style={{ maxWidth: '90%', fontSize: 15, lineHeight: 1.6, color: '#37352f' }}
            >
              {explanation}
            </div>
            <AskCoachButton onClick={onAskCoach} disabled={!canAsk || explaining} label="Ask again" />
          </div>
        ) : canAsk ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: '#a3a099' }}>
              Want the coach to explain this move?
            </div>
            <AskCoachButton onClick={onAskCoach} disabled={explaining} label="Ask Coach" />
          </div>
        ) : null}

        {/* Path 2 — freeform chat thread */}
        {messages.map((m, i) =>
          m.role === 'assistant' ? (
            m.pending ? (
              <Thinking key={i} />
            ) : (
              <div
                key={i}
                className="serif"
                style={{
                  maxWidth: '90%',
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: m.error ? '#b06a56' : '#37352f',
                }}
              >
                {m.text}
              </div>
            )
          ) : (
            <div
              key={i}
              style={{
                alignSelf: 'flex-end',
                maxWidth: '84%',
                background: '#f0efe9',
                color: '#37352f',
                fontSize: 14,
                lineHeight: 1.5,
                padding: '11px 14px',
                borderRadius: '14px 14px 5px 14px',
              }}
            >
              {m.text}
            </div>
          ),
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: '14px 16px', borderTop: '1px solid #efeee9' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#f4f3ee',
            borderRadius: 12,
            padding: '8px 8px 8px 16px',
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
            disabled={sending}
            placeholder={sending ? 'Coach is thinking…' : 'Ask about this position…'}
            className="coach-input"
            style={{
              flex: 1,
              // 16px minimum — iOS Safari auto-zooms the page on focusing any
              // text input with a smaller computed font-size.
              fontSize: 16,
              color: '#37352f',
              background: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            style={{
              width: 34,
              height: 34,
              border: 'none',
              borderRadius: 9,
              background: '#1c1b18',
              color: '#fff',
              fontSize: 16,
              cursor: sending || !input.trim() ? 'default' : 'pointer',
              opacity: sending || !input.trim() ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}

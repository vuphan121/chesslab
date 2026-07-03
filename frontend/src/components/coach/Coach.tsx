'use client'

import { useState } from 'react'

interface Message {
  role: 'coach' | 'user'
  text: string
}

// Placeholder demo conversation — replace once the AI coach backend is wired up.
const SEED_MESSAGES: Message[] = [
  {
    role: 'coach',
    text: 'This is the Ruy López — after 3.Bb5 White pins pressure on the c6-knight that guards e5. It’s the most respected try for a lasting opening edge.',
  },
  { role: 'user', text: 'Why not just take on c6 and win the e5 pawn?' },
  {
    role: 'coach',
    text: 'After 4.Bxc6 dxc6 5.Nxe5 Black plays 5…Qd4!, forking e5 and e4 to regain the pawn with a fine game. The pressure is positional — not a free pawn.',
  },
  { role: 'user', text: "So what's the main move for Black?" },
  {
    role: 'coach',
    text: '3…a6 (the Morphy) is most flexible — it puts the question to the bishop. Prefer solid, symmetrical endgames? 3…Nf6 (the Berlin) is rock-solid.',
  },
]

export default function Coach() {
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES)
  const [input, setInput] = useState('')

  const send = () => {
    const text = input.trim()
    if (!text) return
    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
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
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: '#1c1b18',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#7ecae8',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ♞
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Coach</div>
          <div style={{ fontSize: 11, color: '#a3a099' }}>Explaining this position</div>
        </div>
      </div>

      {/* Message list */}
      <div
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
        {messages.map((m, i) =>
          m.role === 'coach' ? (
            <div
              key={i}
              className="serif"
              style={{ maxWidth: '90%', fontSize: 15, lineHeight: 1.6, color: '#37352f' }}
            >
              {m.text}
            </div>
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
            placeholder="Ask about this position…"
            className="coach-input"
            style={{
              flex: 1,
              fontSize: 14,
              color: '#37352f',
              background: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <button
            onClick={send}
            style={{
              width: 34,
              height: 34,
              border: 'none',
              borderRadius: 9,
              background: '#1c1b18',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
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

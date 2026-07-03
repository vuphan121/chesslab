'use client'

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import MiniBoard from './MiniBoard'
import type { Analysis } from '@/lib/api/client'

interface Props {
  analysis: Analysis | null
  analyzing: boolean
  turn: 'w' | 'b'
  fullMove: number
  height: number
}

function scoreStr(score: number, mate: number): string {
  if (mate !== 0) return mate > 0 ? `#${mate}` : `#${mate}`
  const v = (Math.abs(score) / 100).toFixed(1)
  return score >= 0 ? `+${v}` : `-${v}`
}

function scoreColor(score: number, mate: number): string {
  if (mate !== 0) return mate > 0 ? '#4a90d9' : '#b71c1c'
  if (score > 20) return '#4a90d9'
  if (score < -20) return '#b71c1c'
  return '#555'
}

type Token = { text: string; fenIdx: number | null }

function buildTokens(moves: string[], turn: 'w' | 'b', fullMove: number): Token[] {
  const tokens: Token[] = []
  let isWhite = turn === 'w'
  let num = fullMove

  for (let i = 0; i < Math.min(moves.length, 10); i++) {
    if (isWhite) {
      tokens.push({ text: `${num}. `, fenIdx: null })
    } else if (i === 0) {
      tokens.push({ text: `${num}... `, fenIdx: null })
    }
    tokens.push({ text: moves[i], fenIdx: i })
    if (i < Math.min(moves.length, 10) - 1) {
      tokens.push({ text: ' ', fenIdx: null })
    }
    if (!isWhite) num++
    isWhite = !isWhite
  }
  return tokens
}

const MINI_SQUARE = 44
const MINI_SIZE = MINI_SQUARE * 8

export default function TopLines({ analysis, analyzing, turn, fullMove, height }: Props) {
  const score = analysis?.score ?? 0
  const mate = analysis?.mate ?? 0
  const depth = analysis?.depth ?? 0
  const lines = analysis?.lines ?? []
  const engineName = analysis?.engineName ?? 'Stockfish'

  const panelRef = useRef<HTMLDivElement>(null)
  const [popup, setPopup] = useState<{ fen: string; y: number } | null>(null)

  const handleEnter = (fen: string, e: React.MouseEvent) => {
    const panelRect = panelRef.current?.getBoundingClientRect()
    if (!panelRect) return
    const clampedY = Math.min(
      Math.max(e.clientY - MINI_SIZE / 2, 8),
      window.innerHeight - MINI_SIZE - 8,
    )
    setPopup({ fen, y: clampedY })
  }

  const handleLeave = () => setPopup(null)

  return (
    <>
      <div
        ref={panelRef}
        style={{
          width: 440,
          height,
          backgroundColor: '#fff',
          borderRadius: 4,
          boxShadow:
            '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.07), inset 0 0 0 1px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #ebebeb' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: '-1px',
                color: scoreColor(score, mate),
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {scoreStr(score, mate)}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                fontWeight: 500,
                color: analyzing ? '#7ecae8' : '#aaa',
                letterSpacing: '0.3px',
              }}
            >
              {analyzing ? 'analyzing…' : depth > 0 ? `depth ${depth}` : ''}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#bbb', fontWeight: 500, letterSpacing: '0.2px' }}>
            {engineName}
          </div>
        </div>

        {/* Lines */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {lines.map((line, i) => {
            const tokens = buildTokens(line.moves, turn, fullMove)
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '10px 18px',
                  borderBottom: i < lines.length - 1 ? '1px solid #f0f0f0' : undefined,
                  alignItems: 'center',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: scoreColor(line.score, line.mate),
                    minWidth: 44,
                    flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {scoreStr(line.score, line.mate)}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: '#444',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {tokens.map((tok, ti) =>
                    tok.fenIdx !== null && Array.isArray(line.fens) && line.fens[tok.fenIdx] ? (
                      <span
                        key={ti}
                        onMouseEnter={(e) => handleEnter(line.fens[tok.fenIdx!], e)}
                        onMouseLeave={handleLeave}
                        style={{
                          cursor: 'default',
                          borderRadius: 2,
                          padding: '0 1px',
                          transition: 'background 0.1s',
                        }}
                        onMouseOver={(e) =>
                          ((e.currentTarget as HTMLElement).style.background = '#f0f4ff')
                        }
                        onMouseOut={(e) =>
                          ((e.currentTarget as HTMLElement).style.background = '')
                        }
                      >
                        {tok.text}
                      </span>
                    ) : (
                      <span key={ti} style={{ color: '#aaa' }}>
                        {tok.text}
                      </span>
                    ),
                  )}
                </span>
              </div>
            )
          })}

          {lines.length === 0 && (
            <div style={{ padding: '16px 18px', fontSize: 12, color: '#bbb' }}>
              {analyzing ? 'Calculating…' : analysis === null ? 'Engine not available' : 'No moves'}
            </div>
          )}
        </div>
      </div>

      {popup &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left:
                (panelRef.current?.getBoundingClientRect()?.left ?? 0) - MINI_SIZE - 16,
              top: popup.y,
              zIndex: 1000,
              pointerEvents: 'none',
            }}
          >
            <MiniBoard fen={popup.fen} squareSize={MINI_SQUARE} />
          </div>,
          document.body,
        )}
    </>
  )
}

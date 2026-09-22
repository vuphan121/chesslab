'use client'

import { Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import MiniBoard from '@/components/analysis/MiniBoard'
import { toFigurine } from '@/lib/chess/figurine'
import type { ChapterLine } from '@/lib/trainer/lineQueue'

const MINI_SQUARE = 40
const MINI_SIZE = MINI_SQUARE * 8

interface Props {
  lines: ChapterLine[]
  loading: boolean
}

export default function LineList({ lines, loading }: Props) {
  const [popup, setPopup] = useState<{ fen: string; from: string; to: string; x: number; y: number } | null>(
    null,
  )
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const handleEnter = (fen: string, uci: string, e: React.MouseEvent) => {
    const clampedX = Math.min(Math.max(e.clientX - MINI_SIZE / 2, 8), window.innerWidth - MINI_SIZE - 8)
    const below = e.clientY + 18 + MINI_SIZE <= window.innerHeight
    const y = below ? e.clientY + 18 : e.clientY - MINI_SIZE - 18
    setPopup({ fen, from: uci.slice(0, 2), to: uci.slice(2, 4), x: clampedX, y })
  }

  const handleLeave = () => setPopup(null)

  const toggleLine = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  if (loading) return <p style={{ fontSize: 12, color: '#a3a099' }}>Loading lines…</p>
  if (lines.length === 0) return <p style={{ fontSize: 12, color: '#a3a099' }}>No lines to show.</p>

  return (
    <>
      <div>
        {lines.map((line, li) => {
          const isOpen = expanded.has(li)
          return (
            <div
              key={li}
              style={{
                display: 'flex',
                alignItems: isOpen ? 'flex-start' : 'center',
                gap: 4,
                padding: '6px 6px 6px 10px',
                borderBottom: li < lines.length - 1 ? '1px solid #eeece4' : 'none',
              }}
            >
              <div
                style={
                  isOpen
                    ? { flex: 1, minWidth: 0, paddingLeft: 16, textIndent: -16, lineHeight: 1.9 }
                    : { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.6 }
                }
              >
                {line.sans.map((san, i) => {
                  const ply = i + 1
                  const num = Math.ceil(ply / 2)
                  const isWhite = ply % 2 === 1
                  const showNum = isWhite || i === 0
                  const fen = line.positionKeys[i + 1]
                  const uci = line.ucis[i]
                  return (
                    <Fragment key={i}>
                      <span style={{ whiteSpace: 'nowrap' }}>
                        {showNum && (
                          <span
                            className="mono"
                            style={{ fontSize: 11, color: '#b4b1a8', userSelect: 'none' }}
                          >
                            {num}
                            {isWhite ? '.' : '…'}
                            {' '}
                          </span>
                        )}
                        <span
                          className="mono"
                          onMouseEnter={(e) => handleEnter(fen, uci, e)}
                          onMouseLeave={handleLeave}
                          style={{
                            fontSize: 13.5,
                            fontWeight: 500,
                            color: '#37352f',
                            cursor: 'default',
                            borderRadius: 4,
                            padding: '2px 4px',
                            transition: 'background 0.1s',
                          }}
                          onMouseOver={(e) => {
                            ;(e.currentTarget as HTMLElement).style.background = '#e3f0fc'
                          }}
                          onMouseOut={(e) => {
                            ;(e.currentTarget as HTMLElement).style.background = ''
                          }}
                        >
                          {toFigurine(san)}
                        </span>
                      </span>
                      {' '}
                    </Fragment>
                  )
                })}
              </div>
              <button
                onClick={() => toggleLine(li)}
                title={isOpen ? 'Collapse line' : 'Expand line'}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  marginTop: isOpen ? 3 : 0,
                  border: 'none',
                  background: 'none',
                  color: '#b4b1a8',
                  cursor: 'pointer',
                }}
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 10 10"
                  fill="none"
                  style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.1s' }}
                >
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      {popup &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: popup.x,
              top: popup.y,
              zIndex: 1000,
              pointerEvents: 'none',
            }}
          >
            <MiniBoard fen={popup.fen} squareSize={MINI_SQUARE} lastMove={{ from: popup.from, to: popup.to }} />
          </div>,
          document.body,
        )}
    </>
  )
}

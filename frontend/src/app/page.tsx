'use client'

import Board from '@/components/board/Board'
import EvalBar from '@/components/analysis/EvalBar'
import MoveHistory from '@/components/history/MoveHistory'
import TopBar from '@/components/layout/TopBar'
import OpeningTree from '@/components/tree/OpeningTree'
import Coach from '@/components/coach/Coach'
import { useChessGame } from '@/hooks/useChessGame'
import { useState, useEffect } from 'react'

const SQUARE_SIZE = 72
const BOARD_SIZE = SQUARE_SIZE * 8 // 576

export default function Home() {
  const {
    boardState,
    selectSquare,
    move,
    legalMovesFor,
    gotoNode,
    navStart,
    navPrev,
    navNext,
    navEnd,
    reset,
    analysis,
    explorer,
    explorerLoading,
    coachExplanation,
    coachExplaining,
    coachError,
    sendCoachChat,
  } = useChessGame()
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navPrev, navNext])

  if (!boardState) return null

  const atStart = boardState.currentNodeId === boardState.moveTree.id
  const openingName =
    explorer?.openingName ?? (atStart ? 'Starting Position' : 'Custom Line')
  const isBookMove = (explorer?.totalGames ?? 0) > 0

  const playContinuation = (uci: string) => move(uci.slice(0, 2), uci.slice(2, 4))

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#e8e8e6] py-10">
      <div
        style={{
          width: 1432,
          background: '#e4e3df',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 10px 50px rgba(40,55,70,0.15), inset 0 0 0 1px rgba(0,0,0,0.05)',
        }}
      >
        <TopBar turn={boardState.turn} isBookMove={isBookMove} />

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <OpeningTree
            moves={explorer?.moves ?? []}
            totalGames={explorer?.totalGames ?? 0}
            loading={explorerLoading}
            onPlay={playContinuation}
          />

          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                padding: '0 2px 2px',
                width: BOARD_SIZE + 11 + 15,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
                <span
                  className="serif"
                  style={{ fontSize: 27, fontWeight: 500, letterSpacing: '-0.3px', lineHeight: 1 }}
                >
                  {openingName}
                </span>
                {explorer?.openingEco && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#2f6db0',
                      background: '#ecf3fb',
                      padding: '3px 8px',
                      borderRadius: 5,
                    }}
                  >
                    {explorer.openingEco}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {!!analysis?.depth && (
                  <span className="mono" style={{ fontSize: 12, color: '#a3a099' }}>
                    {analysis.engineName} · depth {analysis.depth}
                  </span>
                )}
                <button
                  onClick={() => setFlipped((f) => !f)}
                  title="Flip board"
                  style={{
                    width: 26,
                    height: 26,
                    border: '1px solid #eae8e2',
                    background: '#fff',
                    borderRadius: 6,
                    color: '#9a978f',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M1.5 4.5H11M11 4.5L8 1.5M11 4.5L8 7.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12.5 9.5H3M3 9.5L6 6.5M3 9.5L6 12.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <Board
                boardState={boardState}
                onSquareClick={selectSquare}
                onMove={move}
                legalMovesFor={legalMovesFor}
                squareSize={SQUARE_SIZE}
                flipped={flipped}
              />
              <EvalBar score={analysis?.score ?? 0} mate={analysis?.mate ?? 0} height={BOARD_SIZE} />
            </div>
          </div>

          <div style={{ width: 388, flexShrink: 0, height: 620, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <MoveHistory
              moveTree={boardState.moveTree}
              currentNodeId={boardState.currentNodeId}
              onGotoNode={gotoNode}
              onNavStart={navStart}
              onNavPrev={navPrev}
              onNavNext={navNext}
              onNavEnd={navEnd}
              onReset={reset}
            />
            <Coach
              explanation={coachExplanation}
              explaining={coachExplaining}
              explainError={coachError}
              onSendChat={sendCoachChat}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

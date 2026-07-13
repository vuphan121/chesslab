'use client'

import Board from '@/components/board/Board'
import EvalBar from '@/components/analysis/EvalBar'
import MoveHistory from '@/components/history/MoveHistory'
import TopBar from '@/components/layout/TopBar'
import OpeningTree from '@/components/tree/OpeningTree'
import Coach from '@/components/coach/Coach'
import { useChessGame } from '@/hooks/useChessGame'
import { useEffect } from 'react'

const SQUARE_SIZE = 72
const BOARD_SIZE = SQUARE_SIZE * 8 // 576
const SIDE_WIDTH = 371
// The board sits below a caption row (opening name / engine / flip button) in
// the center column. Offset the side panels by the same amount so their tops
// and bottoms line up with the board, not the caption above it.
const CAPTION_ROW_HEIGHT = 30
const COLUMN_GAP = 14
const BOARD_TOP_OFFSET = CAPTION_ROW_HEIGHT + COLUMN_GAP // 45

// formatEval renders the white-relative engine score as a signed pawn value
// (e.g. +0.3, -1.2) or mate (#3 / #-2), for the caption readout.
function formatEval(score: number, mate: number): string {
  if (mate !== 0) return `#${mate}`
  const v = (Math.abs(score) / 100).toFixed(1)
  return score >= 0 ? `+${v}` : `-${v}`
}

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
    loadPgn,
    analysis,
    explorer,
    explorerLoading,
    coachExplanation,
    coachExplaining,
    coachError,
    sendCoachChat,
    flipped,
    toggleFlipped,
  } = useChessGame()

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
          background: '#e8e8e6',
          borderRadius: 16,
          padding: 24,
        }}
      >
        <TopBar turn={boardState.turn} isBookMove={isBookMove} />

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div
            style={{
              width: SIDE_WIDTH,
              height: BOARD_SIZE,
              marginTop: BOARD_TOP_OFFSET,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Coach
              explanation={coachExplanation}
              explaining={coachExplaining}
              explainError={coachError}
              onSendChat={sendCoachChat}
            />
          </div>

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
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {!!analysis?.depth && (
                  <span className="mono" style={{ fontSize: 12, color: '#a3a099' }}>
                    {analysis.engineName} · depth {analysis.depth} ·{' '}
                    <span style={{ fontWeight: 700, color: '#37352f' }}>
                      {formatEval(analysis.score, analysis.mate)}
                    </span>
                  </span>
                )}
                <button
                  onClick={toggleFlipped}
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

            <OpeningTree
              moves={explorer?.moves ?? []}
              totalGames={explorer?.totalGames ?? 0}
              loading={explorerLoading}
              onPlay={playContinuation}
            />
          </div>

          <div
            style={{
              width: SIDE_WIDTH,
              height: BOARD_SIZE,
              marginTop: BOARD_TOP_OFFSET,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <MoveHistory
              openingName={openingName}
              openingEco={explorer?.openingEco}
              moveTree={boardState.moveTree}
              currentNodeId={boardState.currentNodeId}
              onGotoNode={gotoNode}
              onNavStart={navStart}
              onNavPrev={navPrev}
              onNavNext={navNext}
              onNavEnd={navEnd}
              onReset={reset}
              onLoadPgn={loadPgn}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

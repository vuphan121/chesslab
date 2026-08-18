'use client'

import { useEffect } from 'react'
import Board from '@/components/board/Board'
import TopBar from '@/components/layout/TopBar'
import RepertoirePicker from '@/components/trainer/RepertoirePicker'
import LinePanel from '@/components/trainer/LinePanel'
import FeedbackStrip from '@/components/trainer/FeedbackStrip'
import SessionSummary from '@/components/trainer/SessionSummary'
import { useTrainerSession } from '@/hooks/useTrainerSession'
import { useViewportWidth, clamp } from '@/hooks/useViewportWidth'

const DESKTOP_SQUARE_SIZE = 72
const SIDE_WIDTH = 371
const NARROW_BREAKPOINT = 1040
const OUTER_PADDING_DESKTOP = 24
const OUTER_PADDING_NARROW = 14
const CAPTION_ROW_HEIGHT = 30
const COLUMN_GAP = 14
const BOARD_TOP_OFFSET = CAPTION_ROW_HEIGHT + COLUMN_GAP
const ROW_GAP_DESKTOP = 20





const FULL_CONTAINER_WIDTH =
  DESKTOP_SQUARE_SIZE * 8 + SIDE_WIDTH * 2 + ROW_GAP_DESKTOP * 2 + OUTER_PADDING_DESKTOP * 2
const MIN_DESKTOP_SCALE = 0.45

export default function OpeningStudyPage() {
  const {
    phase,
    repertoire,
    loadError,
    loading,
    boardState,
    busy,
    flipped,
    toggleFlipped,
    currentCard,
    runStartCard,
    feedback,
    hintUci,
    runHadMistake,
    runMoves,
    leadingMoves,
    summary,
    viewIndex,
    isViewingHistory,
    navBack,
    navForward,
    gotoPly,
    startSession,
    selectSquare,
    move,
    legalMovesFor,
    redoLine,
    nextLine,
    analyzeLine,
    sameAgain,
    drillMistakes,
    changeRepertoire,
    cardById,
  } = useTrainerSession()

  const viewportWidth = useViewportWidth()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const outerPadding = isNarrow ? OUTER_PADDING_NARROW : OUTER_PADDING_DESKTOP
  const desktopScale = isNarrow
    ? 1
    : clamp((viewportWidth ?? FULL_CONTAINER_WIDTH) / FULL_CONTAINER_WIDTH, MIN_DESKTOP_SCALE, 1)
  const squareSize = isNarrow
    ? clamp(Math.floor(((viewportWidth ?? NARROW_BREAKPOINT) - outerPadding * 2) / 8), 30, DESKTOP_SQUARE_SIZE)
    : clamp(Math.floor(DESKTOP_SQUARE_SIZE * desktopScale), 30, DESKTOP_SQUARE_SIZE)
  const boardSize = squareSize * 8
  const sideWidth = isNarrow ? SIDE_WIDTH : Math.floor(SIDE_WIDTH * desktopScale)
  const rowGap = isNarrow ? 16 : Math.max(12, Math.floor(ROW_GAP_DESKTOP * desktopScale))
  const containerWidth = boardSize + sideWidth * 2 + rowGap * 2 + outerPadding * 2

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navBack()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navForward()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navBack, navForward])

  const outerWrapStyle: React.CSSProperties = {
    width: isNarrow ? '100%' : containerWidth,
    maxWidth: '100vw',
    flexShrink: 0,
    margin: '0 auto',
    padding: isNarrow ? `0 ${OUTER_PADDING_NARROW}px` : '0 24px',
  }

  if (phase === 'setup') {
    return (
      <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10">
        <div style={outerWrapStyle}>
          <TopBar right={<span />} />
        </div>
        <RepertoirePicker onStart={startSession} starting={loading} startError={loadError} />
      </main>
    )
  }

  if (phase === 'summary' && summary) {
    return (
      <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10">
        <div style={outerWrapStyle}>
          <TopBar right={<span />} />
        </div>
        <SessionSummary
          summary={summary}
          cardById={cardById}
          onDrillMistakes={drillMistakes}
          onSameAgain={sameAgain}
          onChangeRepertoire={changeRepertoire}
        />
      </main>
    )
  }

  if (!boardState || !repertoire || !currentCard || !runStartCard) {
    return (
      <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10">
        <div style={outerWrapStyle}>
          <TopBar right={<span />} />
        </div>
      </main>
    )
  }

  const lineComplete = phase === 'line-complete'

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#e8e8e6] py-6 sm:py-10">
      <div style={{ width: isNarrow ? '100%' : containerWidth, maxWidth: '100vw', flexShrink: 0, background: '#e8e8e6', borderRadius: 16, padding: outerPadding }}>
        <TopBar
          right={
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#6a675f',
                background: '#f0efe9',
                padding: '6px 13px',
                borderRadius: 8,
              }}
            >
              {repertoire.name}
            </span>
          }
        />

        <div
          style={{
            display: 'flex',
            flexDirection: isNarrow ? 'column' : 'row',
            gap: isNarrow ? 16 : rowGap,
            alignItems: isNarrow ? 'stretch' : 'flex-start',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              order: isNarrow ? 1 : 0,
              alignItems: isNarrow ? 'center' : undefined,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                padding: '0 2px 2px',
                width: boardSize,
              }}
            >
              {isViewingHistory ? (
                <span style={{ fontSize: 14, color: '#a3a099' }}>
                  <strong style={{ color: '#37352f' }}>Reviewing</strong> — use ⟨ ⟩ or click a move to return
                </span>
              ) : (
                <span style={{ fontSize: 14, color: '#37352f' }}>
                  <strong>Your move as {boardState.turn === 'w' ? 'White' : 'Black'}</strong> — find the repertoire
                  continuation
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={toggleFlipped}
                  title="Flip board"
                  style={{
                    width: 30,
                    height: 30,
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
                    <path d="M1.5 4.5H11M11 4.5L8 1.5M11 4.5L8 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12.5 9.5H3M3 9.5L6 6.5M3 9.5L6 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            <Board
              boardState={boardState}
              onSquareClick={selectSquare}
              onMove={move}
              legalMovesFor={legalMovesFor}
              squareSize={squareSize}
              flipped={flipped}
              bestMove={isViewingHistory ? undefined : (hintUci ?? undefined)}
            />

            <div style={{ width: boardSize }}>
              <FeedbackStrip feedback={feedback} />
            </div>

            {lineComplete && (
              <div
                style={{
                  width: boardSize,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '10px 4px 0',
                }}
              >
                <span style={{ fontSize: 13, color: runHadMistake ? '#c0392b' : '#2e7d32', fontWeight: 600 }}>
                  {runHadMistake ? 'You made a mistake in this line — let’s do it again.' : 'Clean line — nice work.'}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={analyzeLine} disabled={busy} style={endBtn(false)}>
                    Analyze
                  </button>
                  <button onClick={redoLine} disabled={busy} style={endBtn(runHadMistake)}>
                    Do it again
                  </button>
                  <button onClick={nextLine} disabled={busy} style={endBtn(!runHadMistake)}>
                    Next line
                  </button>
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              width: isNarrow ? '100%' : sideWidth,
              height: isNarrow ? 320 : boardSize,
              marginTop: isNarrow ? 0 : BOARD_TOP_OFFSET,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              order: isNarrow ? 2 : 0,
            }}
          >
            <LinePanel
              repertoire={repertoire}
              runStartCard={runStartCard}
              runMoves={runMoves}
              leadingMoves={leadingMoves}
              answerComment={feedback?.kind === 'correct' || feedback?.kind === 'correct-alt' ? feedback.comment : undefined}
              viewIndex={viewIndex}
              onGotoPly={gotoPly}
              onNavBack={navBack}
              onNavForward={navForward}
            />
          </div>

          {!isNarrow && <div style={{ width: sideWidth, marginTop: BOARD_TOP_OFFSET, flexShrink: 0 }} />}
        </div>
      </div>
    </main>
  )
}

function endBtn(primary: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 16px',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid #eae8e2',
    background: primary ? '#4a90d9' : '#fff',
    color: primary ? '#fff' : '#37352f',
    cursor: 'pointer',
  }
}

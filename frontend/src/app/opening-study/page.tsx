'use client'

import { useEffect } from 'react'
import Board from '@/components/board/Board'
import TopBar from '@/components/layout/TopBar'
import RepertoirePicker from '@/components/trainer/RepertoirePicker'
import LinePanel from '@/components/trainer/LinePanel'
import FeedbackStrip from '@/components/trainer/FeedbackStrip'
import SessionSummary from '@/components/trainer/SessionSummary'
import { useTrainerSession } from '@/hooks/useTrainerSession'
import { useViewportWidth, useViewportHeight, clamp } from '@/hooks/useViewportWidth'

const DESKTOP_SQUARE_SIZE = 110
const SIDE_WIDTH = 371
const BUTTON_COL_WIDTH = 170
const NARROW_BREAKPOINT = 1040
const OUTER_PADDING_DESKTOP = 24
const OUTER_PADDING_NARROW = 14
const ROW_GAP_DESKTOP = 20
const STUDY_BACKGROUND = 'linear-gradient(135deg, #f1f0e9 0%, #eef1f0 52%, #e9edef 100%)'





// The gaps (LinePanel↔board, board↔button column) and outer side padding
// don't shrink with the board — only board/sideWidth/buttonColWidth do — so
// they're subtracted out before scaling and added back after. Otherwise this
// fixed overhead doesn't scale down at narrower desktop widths and the
// scaled content can overflow its grid track by a few px, which is exactly
// the kind of overlap this layout must never produce.
const FIXED_OVERHEAD = ROW_GAP_DESKTOP * 2 + OUTER_PADDING_DESKTOP * 2
const SCALABLE_WIDTH = DESKTOP_SQUARE_SIZE * 8 + SIDE_WIDTH + BUTTON_COL_WIDTH
const FULL_CONTAINER_WIDTH = SCALABLE_WIDTH + FIXED_OVERHEAD
const MIN_DESKTOP_SCALE = 0.45
// TopBar + Back row + vertical padding above the board, plus the page's own
// bottom padding below it — kept in sync with the JSX below so the board
// height calc can reserve exactly this much and never force a page scroll.
const RESERVED_VERTICAL = 150

export default function OpeningStudyPage() {
  const {
    phase,
    repertoire,
    isTodayTraining,
    loadError,
    loading,
    boardState,
    busy,
    animateLastMove,
    flipped,
    currentCard,
    runStartCard,
    runChapterId,
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
    resumeTodayTraining,
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
  const viewportHeight = useViewportHeight()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const outerPadding = isNarrow ? OUTER_PADDING_NARROW : OUTER_PADDING_DESKTOP
  const desktopScale = isNarrow
    ? 1
    : clamp(((viewportWidth ?? FULL_CONTAINER_WIDTH) - FIXED_OVERHEAD) / SCALABLE_WIDTH, MIN_DESKTOP_SCALE, 1)
  const heightSquareSize = viewportHeight
    ? clamp(Math.floor((viewportHeight - RESERVED_VERTICAL) / 8), 30, DESKTOP_SQUARE_SIZE)
    : DESKTOP_SQUARE_SIZE
  const squareSize = isNarrow
    ? clamp(Math.floor(((viewportWidth ?? NARROW_BREAKPOINT) - outerPadding * 2) / 8), 30, DESKTOP_SQUARE_SIZE)
    : Math.min(clamp(Math.floor(DESKTOP_SQUARE_SIZE * desktopScale), 30, DESKTOP_SQUARE_SIZE), heightSquareSize)
  const boardSize = squareSize * 8
  const sideWidth = isNarrow ? SIDE_WIDTH : Math.floor(SIDE_WIDTH * desktopScale)
  const buttonColWidth = isNarrow ? SIDE_WIDTH : Math.floor(BUTTON_COL_WIDTH * desktopScale)
  const rowGap = 20
  // The move panel is pinned to the left edge; the board itself (not the
  // board+buttons group — the button column's own width would skew it) is
  // centered in the true available width whenever there's room for that
  // without touching the panel, and otherwise clamped to sit just to its
  // right — so the board is as close to dead-center as possible without
  // ever overlapping the panel. The button column just trails the board.
  const contentWidth = (viewportWidth ?? FULL_CONTAINER_WIDTH) - outerPadding * 2
  const idealBoardLeft = (contentWidth - boardSize) / 2
  const minBoardLeft = sideWidth + rowGap
  const boardLeft = isNarrow ? 0 : Math.max(idealBoardLeft, minBoardLeft)

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

  if (phase === 'setup') {
    return (
      <main className="min-h-screen pb-6 sm:pb-10" style={{ background: STUDY_BACKGROUND }}>
        <TopBar right={<span />} />
        <RepertoirePicker onStart={startSession} onResumeToday={resumeTodayTraining} starting={loading} startError={loadError} />
      </main>
    )
  }

  if (phase === 'summary' && summary) {
    return (
      <main className="min-h-screen pb-6 sm:pb-10" style={{ background: STUDY_BACKGROUND }}>
        <TopBar right={<span />} />
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
      <main className="min-h-screen pb-6 sm:pb-10" style={{ background: STUDY_BACKGROUND }}>
        <TopBar right={<span />} />
      </main>
    )
  }

  const lineComplete = phase === 'line-complete'

  return (
    <main className="min-h-screen pb-6 sm:pb-10" style={{ background: STUDY_BACKGROUND }}>
      <TopBar right={<span />} />

      <div style={{ padding: '8px 24px 0' }}>
        <button
          onClick={changeRepertoire}
          title="Back to line picker"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: '#6a675f',
            background: '#f0efe9',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 1.5L2.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
      </div>

      <div style={{ padding: `${isNarrow ? 8 : 10}px ${outerPadding}px 0` }}>
        {isNarrow ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <div style={{ position: 'relative', width: boardSize }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, pointerEvents: 'none' }}>
                  <FeedbackStrip feedback={feedback} />
                </div>
                <Board
                  boardState={boardState}
                  onSquareClick={selectSquare}
                  onMove={move}
                  legalMovesFor={legalMovesFor}
                  squareSize={squareSize}
                  flipped={flipped}
                  animateLastMove={animateLastMove}
                  bestMove={isViewingHistory ? undefined : (hintUci ?? undefined)}
                />
              </div>

              <div
                style={{
                  width: boardSize,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 8,
                  padding: '10px 4px 0',
                }}
              >
                {lineComplete && (
                  <>
                    <button onClick={analyzeLine} disabled={busy} style={endBtn(false)}>
                      Analyze
                    </button>
                    <button onClick={redoLine} disabled={busy} style={endBtn(runHadMistake)}>
                      Do it again
                    </button>
                  </>
                )}
                <button onClick={nextLine} disabled={busy} style={endBtn(lineComplete && !runHadMistake)}>
                  Next line
                </button>
              </div>
            </div>

            <div style={{ width: '100%', height: 320, display: 'flex', flexDirection: 'column' }}>
              <LinePanel
                repertoire={repertoire}
                runStartCard={runStartCard}
                runChapterId={runChapterId}
                runMoves={runMoves}
                leadingMoves={leadingMoves}
                isTodayTraining={isTodayTraining}
                answerComment={feedback?.kind === 'correct' || feedback?.kind === 'correct-alt' ? feedback.comment : undefined}
                viewIndex={viewIndex}
                onGotoPly={gotoPly}
                onNavBack={navBack}
                onNavForward={navForward}
              />
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', height: boardSize }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: sideWidth, height: boardSize, display: 'flex', flexDirection: 'column' }}>
              <LinePanel
                repertoire={repertoire}
                runStartCard={runStartCard}
                runChapterId={runChapterId}
                runMoves={runMoves}
                leadingMoves={leadingMoves}
                isTodayTraining={isTodayTraining}
                answerComment={feedback?.kind === 'correct' || feedback?.kind === 'correct-alt' ? feedback.comment : undefined}
                viewIndex={viewIndex}
                onGotoPly={gotoPly}
                onNavBack={navBack}
                onNavForward={navForward}
              />
            </div>

            <div style={{ position: 'absolute', left: boardLeft, top: 0, display: 'flex', alignItems: 'flex-start', gap: rowGap }}>
              <Board
                boardState={boardState}
                onSquareClick={selectSquare}
                onMove={move}
                legalMovesFor={legalMovesFor}
                squareSize={squareSize}
                flipped={flipped}
                animateLastMove={animateLastMove}
                bestMove={isViewingHistory ? undefined : (hintUci ?? undefined)}
              />

              <div style={{ width: buttonColWidth, height: boardSize, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                <button onClick={nextLine} disabled={busy} style={endBtn(lineComplete && !runHadMistake)}>
                  Next line
                </button>
                {lineComplete && (
                  <>
                    <button onClick={redoLine} disabled={busy} style={endBtn(runHadMistake)}>
                      Do it again
                    </button>
                    <button onClick={analyzeLine} disabled={busy} style={endBtn(false)}>
                      Analyze
                    </button>
                  </>
                )}
                <div style={{ width: '100%', marginTop: 'auto' }}>
                  <FeedbackStrip feedback={feedback} />
                </div>
              </div>
            </div>
          </div>
        )}
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

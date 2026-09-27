'use client'

import { useEffect, useState } from 'react'
import Board from '@/components/board/Board'
import { MaterialRow, computeMaterialRows } from '@/components/board/MaterialCorners'
import EvalBar from '@/components/analysis/EvalBar'
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

// Space reserved next to the board for the precomputed-eval bar (see
// backend internal/evalprecompute) — reserved unconditionally (not just
// while the bar is actually showing) so the button column never shifts
// depending on the toggle state below, only once relative to the pre-eval-bar
// layout.
const EVAL_BAR_WIDTH = 22

// Captured-material display sits above/below the board (Lichess-style),
// not beside it — reserved at a fixed height regardless of whether either
// side is actually ahead in material, same "reserve the slot, not just the
// content" reasoning as EVAL_BAR_WIDTH above, so the board never shifts as
// captures happen mid-line.
const MATERIAL_STRIP_HEIGHT = 22

type EvalDisplay = 'off' | 'eval' | 'eval-moves'
const EVAL_DISPLAY_STORAGE_KEY = 'chesslab.trainer.evalDisplay'
const EVAL_DISPLAY_CYCLE: EvalDisplay[] = ['off', 'eval', 'eval-moves']
const EVAL_DISPLAY_LABEL: Record<EvalDisplay, string> = {
  off: 'Eval: Off',
  eval: 'Eval: Bar',
  'eval-moves': 'Eval: Bar + Moves',
}
// Rank-based arrow weighting for the top 5 precomputed candidate moves,
// biggest/clearest for the engine's best move down to faintest for the
// 5th — same pattern book-study/page.tsx already uses for its 3-line live
// analysis arrows, just extended to 5 ranks for the deeper MultiPV data
// this table stores.
const SUGGESTION_ARROW_SCALES = [1, 0.82, 0.66, 0.52, 0.4]





// The gaps (LinePanel↔board, board↔eval bar, eval bar↔button column) and
// outer side padding don't shrink with the board — only
// board/sideWidth/buttonColWidth do — so they're subtracted out before
// scaling and added back after. Otherwise this fixed overhead doesn't
// scale down at narrower desktop widths and the scaled content can overflow
// its grid track by a few px, which is exactly the kind of overlap this
// layout must never produce. The eval bar's reserved slot is likewise
// fixed-width (shrinking it further would make it illegible), so it's in
// the fixed overhead too, not the scalable budget. The material strips
// above/below the board are fixed-*height*, not width, so they affect
// vertical sizing (see heightSquareSize) instead of this horizontal sum.
const FIXED_OVERHEAD = ROW_GAP_DESKTOP * 3 + OUTER_PADDING_DESKTOP * 2 + EVAL_BAR_WIDTH
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
    evalByFen,
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
    sameAgain,
    drillMistakes,
    changeRepertoire,
    cardById,
  } = useTrainerSession()

  const [evalDisplay, setEvalDisplay] = useState<EvalDisplay>('off')
  useEffect(() => {
    try {
      const stored = localStorage.getItem(EVAL_DISPLAY_STORAGE_KEY)
      if (stored === 'off' || stored === 'eval' || stored === 'eval-moves') setEvalDisplay(stored)
    } catch {
      // localStorage unavailable (private window, blocked site data) — just
      // keep the default, same "degrade, don't block" stance as everywhere
      // else in this app.
    }
  }, [])
  const cycleEvalDisplay = () => {
    setEvalDisplay((current) => {
      const next = EVAL_DISPLAY_CYCLE[(EVAL_DISPLAY_CYCLE.indexOf(current) + 1) % EVAL_DISPLAY_CYCLE.length]
      try {
        localStorage.setItem(EVAL_DISPLAY_STORAGE_KEY, next)
      } catch {
        // ignore — see above
      }
      return next
    })
  }

  const viewportWidth = useViewportWidth()
  const viewportHeight = useViewportHeight()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const outerPadding = isNarrow ? OUTER_PADDING_NARROW : OUTER_PADDING_DESKTOP
  const desktopScale = isNarrow
    ? 1
    : clamp(((viewportWidth ?? FULL_CONTAINER_WIDTH) - FIXED_OVERHEAD) / SCALABLE_WIDTH, MIN_DESKTOP_SCALE, 1)
  const heightSquareSize = viewportHeight
    ? clamp(Math.floor((viewportHeight - RESERVED_VERTICAL - MATERIAL_STRIP_HEIGHT * 2) / 8), 30, DESKTOP_SQUARE_SIZE)
    : DESKTOP_SQUARE_SIZE
  const squareSize = isNarrow
    ? clamp(
        Math.floor(((viewportWidth ?? NARROW_BREAKPOINT) - outerPadding * 2 - 8 - EVAL_BAR_WIDTH) / 8),
        30,
        DESKTOP_SQUARE_SIZE,
      )
    : Math.min(clamp(Math.floor(DESKTOP_SQUARE_SIZE * desktopScale), 30, DESKTOP_SQUARE_SIZE), heightSquareSize)
  const boardSize = squareSize * 8
  const groupHeight = boardSize + MATERIAL_STRIP_HEIGHT * 2
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
  const viewEval = boardState ? evalByFen[boardState.fen] : undefined
  const showEvalBar = lineComplete && evalDisplay !== 'off'
  const suggestionArrows =
    lineComplete && evalDisplay === 'eval-moves' && viewEval?.bestMoves
      ? viewEval.bestMoves.slice(0, 5).map((m, i) => ({ uci: m.uci, scale: SUGGESTION_ARROW_SCALES[i] ?? 0.35 }))
      : []
  const materialRows = computeMaterialRows(boardState.pieces, flipped)

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
              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <MaterialRow cornerColor={materialRows.top.color} surplus={materialRows.top.surplus} pointsAhead={materialRows.top.pointsAhead} />
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
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
                    analysisMoves={suggestionArrows}
                  />
                </div>
                <div style={{ width: EVAL_BAR_WIDTH, height: boardSize, flexShrink: 0 }}>
                  {showEvalBar && (
                    <EvalBar score={viewEval?.score ?? 0} mate={viewEval?.mate ?? 0} height={boardSize} hasEval={!!viewEval} />
                  )}
                </div>
              </div>

              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <MaterialRow cornerColor={materialRows.bottom.color} surplus={materialRows.bottom.surplus} pointsAhead={materialRows.bottom.pointsAhead} />
              </div>

              <div
                style={{
                  width: boardSize + 8 + EVAL_BAR_WIDTH,
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
                    <button
                      onClick={cycleEvalDisplay}
                      disabled={busy}
                      title={EVAL_DISPLAY_LABEL[evalDisplay]}
                      aria-label={EVAL_DISPLAY_LABEL[evalDisplay]}
                      style={iconBtn(false)}
                    >
                      <EvalIcon state={evalDisplay} />
                    </button>
                    <button onClick={redoLine} disabled={busy} title="Do it again" aria-label="Do it again" style={iconBtn(runHadMistake)}>
                      <RedoIcon />
                    </button>
                  </>
                )}
                <button
                  onClick={nextLine}
                  disabled={busy}
                  title="Next line"
                  aria-label="Next line"
                  style={iconBtn(lineComplete && !runHadMistake)}
                >
                  <NextLineIcon />
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
          <div style={{ position: 'relative', width: '100%', height: groupHeight }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: sideWidth, height: groupHeight, display: 'flex', flexDirection: 'column' }}>
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

            <div style={{ position: 'absolute', left: boardLeft, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <MaterialRow cornerColor={materialRows.top.color} surplus={materialRows.top.surplus} pointsAhead={materialRows.top.pointsAhead} />
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: rowGap }}>
                <Board
                  boardState={boardState}
                  onSquareClick={selectSquare}
                  onMove={move}
                  legalMovesFor={legalMovesFor}
                  squareSize={squareSize}
                  flipped={flipped}
                  animateLastMove={animateLastMove}
                  bestMove={isViewingHistory ? undefined : (hintUci ?? undefined)}
                  analysisMoves={suggestionArrows}
                />

                <div style={{ width: EVAL_BAR_WIDTH, height: boardSize, flexShrink: 0 }}>
                  {showEvalBar && (
                    <EvalBar score={viewEval?.score ?? 0} mate={viewEval?.mate ?? 0} height={boardSize} hasEval={!!viewEval} />
                  )}
                </div>

                <div style={{ width: buttonColWidth, height: boardSize, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                  <button
                    onClick={nextLine}
                    disabled={busy}
                    title="Next line"
                    aria-label="Next line"
                    style={iconBtn(lineComplete && !runHadMistake)}
                  >
                    <NextLineIcon />
                  </button>
                  {lineComplete && (
                    <>
                      <button onClick={redoLine} disabled={busy} title="Do it again" aria-label="Do it again" style={iconBtn(runHadMistake)}>
                        <RedoIcon />
                      </button>
                      <button
                        onClick={cycleEvalDisplay}
                        disabled={busy}
                        title={EVAL_DISPLAY_LABEL[evalDisplay]}
                        aria-label={EVAL_DISPLAY_LABEL[evalDisplay]}
                        style={iconBtn(false)}
                      >
                        <EvalIcon state={evalDisplay} />
                      </button>
                    </>
                  )}
                  <div style={{ width: '100%', marginTop: 'auto' }}>
                    <FeedbackStrip feedback={feedback} />
                  </div>
                </div>
              </div>

              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <MaterialRow cornerColor={materialRows.bottom.color} surplus={materialRows.bottom.surplus} pointsAhead={materialRows.bottom.pointsAhead} />
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

// Square icon-only variant of endBtn, same color logic — used where a
// glyph replaces the button's old text label (Next line / Do it again /
// the eval-display toggle), so the run-completion controls read as a
// compact icon row instead of a stack of text pills.
function iconBtn(primary: boolean): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: primary ? 'none' : '1px solid #eae8e2',
    background: primary ? '#4a90d9' : '#fff',
    color: primary ? '#fff' : '#37352f',
    cursor: 'pointer',
  }
}

// Simple right-pointing arrow — Next line moves on to a new line, same
// stroke style as RedoIcon below.
function NextLineIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="12" x2="18" y2="12" />
      <polyline points="12 6 18 12 12 18" />
    </svg>
  )
}

// Single clockwise-rotation arrow — the universal "retry/redo" glyph.
function RedoIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

// Eval-display toggle glyph: a bar-chart icon (grey when off, blue once
// showing) with a small arrow badge added only in the "+ moves" state,
// since arrows are literally what that state adds to the board.
function EvalIcon({ state }: { state: EvalDisplay }) {
  const on = state !== 'off'
  const color = on ? '#4a90d9' : '#b4b1a8'
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="18" y1="20" x2="18" y2="10" />
      </svg>
      {state === 'eval-moves' && (
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          style={{ position: 'absolute', top: -3, right: -5 }}
        >
          <path d="M2 8L8 2M8 2H3.5M8 2V6.5" stroke="#4a90d9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

'use client'

import { useEffect } from 'react'
import Board from '@/components/board/Board'
import { MaterialRow, computeMaterialRows } from '@/components/board/MaterialCorners'
import EvalBar from '@/components/analysis/EvalBar'
import { buildLinePgn, copyPgnToClipboard } from '@/lib/trainer/exportPgn'
import { EVAL_DISPLAY_LABEL, EvalIcon, useEvalDisplay } from '@/components/analysis/EvalToggle'
import { arrowShapes } from '@/lib/engine/arrows'
import { showToast } from '@/lib/toast'
import TopBar from '@/components/layout/TopBar'
import RepertoirePicker from '@/components/trainer/RepertoirePicker'
import LinePanel from '@/components/trainer/LinePanel'
import FeedbackStrip from '@/components/trainer/FeedbackStrip'
import SessionSummary from '@/components/trainer/SessionSummary'
import { useTrainerSession } from '@/hooks/useTrainerSession'
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis'
import { useEngineSettings } from '@/lib/engine/settings'
import { positionKey } from '@/lib/chess/positionKey'
import { useViewportWidth, useViewportHeight, clamp } from '@/hooks/useViewportWidth'

const DESKTOP_SQUARE_SIZE = 110
const SIDE_WIDTH = 371
const BUTTON_COL_WIDTH = 170
const NARROW_BREAKPOINT = 1040
const PHONE_BREAKPOINT = 640
const LANDSCAPE_CHROME_HEIGHT = 58 + 8 + 8 + 8
const LANDSCAPE_COLUMN_MIN = 220
const LANDSCAPE_COLUMN_MAX = 340
const PHONE_SIDE_PADDING = 10
const PHONE_CHROME_HEIGHT = 52 + 44 + 44 + 20 + 56 + 16
const PHONE_BTN = 44
const OUTER_PADDING_DESKTOP = 24
const OUTER_PADDING_NARROW = 14
const ROW_GAP_DESKTOP = 20
const STUDY_BACKGROUND = 'linear-gradient(135deg, #f1f0e9 0%, #eef1f0 52%, #e9edef 100%)'

const EVAL_BAR_WIDTH = 22

const MATERIAL_STRIP_HEIGHT = 22

const EVAL_DISPLAY_STORAGE_KEY = 'chesslab.trainer.evalDisplay'

const FIXED_OVERHEAD = ROW_GAP_DESKTOP * 3 + OUTER_PADDING_DESKTOP * 2 + EVAL_BAR_WIDTH
const SCALABLE_WIDTH = DESKTOP_SQUARE_SIZE * 8 + SIDE_WIDTH + BUTTON_COL_WIDTH
const FULL_CONTAINER_WIDTH = SCALABLE_WIDTH + FIXED_OVERHEAD
const MIN_DESKTOP_SCALE = 0.45
const RESERVED_VERTICAL = 112

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
    branchActive,
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

  const [evalDisplay, cycleEvalDisplay] = useEvalDisplay(EVAL_DISPLAY_STORAGE_KEY, 'off')
  const [engineSettings] = useEngineSettings()
  const { analysis: branchAnalysis, analysisFen: branchAnalysisFen } = useEngineAnalysis({
    fen: boardState?.fen ?? null,
    gameOver: boardState?.isGameOver ?? false,
    enabled: branchActive,
    settings: engineSettings,
    immediate: true,
  })

  const viewportWidth = useViewportWidth()
  const viewportHeight = useViewportHeight()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const isPhone = viewportWidth != null && viewportWidth < PHONE_BREAKPOINT
  const isLandscape =
    viewportWidth != null && viewportHeight != null && viewportWidth > viewportHeight && viewportWidth >= PHONE_BREAKPOINT && isNarrow
  const outerPadding = isNarrow ? OUTER_PADDING_NARROW : OUTER_PADDING_DESKTOP
  const desktopScale = isNarrow
    ? 1
    : clamp(((viewportWidth ?? FULL_CONTAINER_WIDTH) - FIXED_OVERHEAD) / SCALABLE_WIDTH, MIN_DESKTOP_SCALE, 1)
  const heightSquareSize = viewportHeight
    ? clamp(Math.floor((viewportHeight - RESERVED_VERTICAL - MATERIAL_STRIP_HEIGHT * 2) / 8), 30, DESKTOP_SQUARE_SIZE)
    : DESKTOP_SQUARE_SIZE
  const phoneSquareSize = clamp(
    Math.min(
      Math.floor(((viewportWidth ?? 390) - PHONE_SIDE_PADDING * 2) / 8),
      viewportHeight ? Math.floor((viewportHeight - PHONE_CHROME_HEIGHT) / 8) : 999,
    ),
    30,
    DESKTOP_SQUARE_SIZE,
  )
  const squareSize = isPhone
    ? phoneSquareSize
    : isLandscape
    ? clamp(
        Math.min(
          Math.floor(((viewportHeight ?? 0) - LANDSCAPE_CHROME_HEIGHT) / 8),
          Math.floor(((viewportWidth ?? 0) - outerPadding * 2 - EVAL_BAR_WIDTH - 20 - LANDSCAPE_COLUMN_MIN) / 8),
        ),
        28,
        DESKTOP_SQUARE_SIZE,
      )
    : isNarrow
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

  useEffect(() => {
    if (phase !== 'line-complete' || busy) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      event.preventDefault()
      if (tag === 'BUTTON') target?.blur()
      nextLine()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, busy, nextLine])

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
  const branchCurrent =
    branchActive && !!branchAnalysis && (branchAnalysisFen === null || positionKey(branchAnalysisFen) === positionKey(boardState.fen))
  const viewEval = branchActive
    ? branchCurrent && branchAnalysis
      ? { score: branchAnalysis.score, mate: branchAnalysis.mate }
      : undefined
    : boardState
      ? evalByFen[boardState.fen]
      : undefined
  const showEvalBar = lineComplete && (evalDisplay !== 'off' || branchActive)
  const suggestionArrows = branchActive
    ? branchCurrent && branchAnalysis
      ? arrowShapes(
          branchAnalysis.lines.map((line) => ({ uci: line.uciMoves?.[0], score: line.score, mate: line.mate })),
          boardState.turn,
          5,
        )
      : []
    : lineComplete && evalDisplay === 'eval-moves' && evalByFen[boardState.fen]?.bestMoves
      ? arrowShapes(
          evalByFen[boardState.fen].bestMoves!.map((m) => ({ uci: m.uci, score: m.score, mate: m.mate })),
          boardState.turn,
          5,
        )
      : []
  const materialRows = computeMaterialRows(boardState.pieces, flipped)
  const exportChapter =
    (runChapterId ? repertoire.chapters.find((c) => c.id === runChapterId) : undefined) ??
    repertoire.chapters.find((c) => runStartCard.chapterIds.includes(c.id))
  const exportLine = () => {
    const pgn = buildLinePgn({
      repertoireName: repertoire.name,
      chapterName: exportChapter?.name ?? repertoire.name,
      startFen: exportChapter?.startFen ?? runStartCard.fen,
      fallbackFen: runStartCard.fen,
      leadingSans: leadingMoves.map((m) => m.san),
      runSans: runMoves.map((m) => m.san),
      side: repertoire.side,
    })
    if (pgn) {
      copyPgnToClipboard(pgn)
        .then(() => showToast('PGN copied to clipboard'))
        .catch((error) => {
          console.error('Failed to copy PGN', error)
          showToast('Could not copy the PGN')
        })
    }
  }

  if (isPhone) {
    const activePly = viewIndex ?? runMoves.length
    const atStart = activePly <= 0
    const atLive = activePly >= runMoves.length
    return (
      <main className="safe-bottom" style={{ background: STUDY_BACKGROUND, minHeight: '100dvh' }}>
        <TopBar right={<span />} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `2px ${PHONE_SIDE_PADDING}px`, height: 44 }}>
          <button className="tap"
            onClick={changeRepertoire}
            title="Back to line picker"
            aria-label="Back to line picker"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              height: 32,
              fontSize: 13,
              fontWeight: 600,
              color: '#6a675f',
              background: '#f0efe9',
              border: 'none',
              padding: '0 12px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 1.5L2.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <span
            className="lbl"
            style={{ color: '#b4b1a8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {repertoire.name}
            {isTodayTraining ? ' · Mixed' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: `0 ${PHONE_SIDE_PADDING}px` }}>
          <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
            <MaterialRow justify="flex-start" cornerColor={materialRows.top.color} surplus={materialRows.top.surplus} pointsAhead={materialRows.top.pointsAhead} />
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

          <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <MaterialRow justify="flex-start" cornerColor={materialRows.bottom.color} surplus={materialRows.bottom.surplus} pointsAhead={materialRows.bottom.pointsAhead} />
                <FeedbackStrip feedback={branchActive ? null : feedback} />
          </div>

          <div style={{ width: boardSize, height: 20, display: 'flex', alignItems: 'center' }}>
            {showEvalBar && (
              <EvalBar horizontal score={viewEval?.score ?? 0} mate={viewEval?.mate ?? 0} height={boardSize} hasEval={!!viewEval} />
            )}
          </div>

          <div style={{ width: boardSize, height: 56, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }} />
            <button
              onClick={navBack}
              disabled={atStart}
              title="Previous move"
              aria-label="Previous move"
              style={{ ...iconBtn(false, PHONE_BTN), opacity: atStart ? 0.45 : 1 }}
            >
              <ChevronIcon dir="left" />
            </button>
            <button
              onClick={navForward}
              disabled={atLive}
              title="Next move"
              aria-label="Next move"
              style={{ ...iconBtn(false, PHONE_BTN), opacity: atLive ? 0.45 : 1 }}
            >
              <ChevronIcon dir="right" />
            </button>
            {lineComplete && (
              <>
                <button
                  onClick={cycleEvalDisplay}
                  disabled={busy}
                  title={EVAL_DISPLAY_LABEL[evalDisplay]}
                  aria-label={EVAL_DISPLAY_LABEL[evalDisplay]}
                  style={iconBtn(false, PHONE_BTN)}
                >
                  <EvalIcon state={evalDisplay} />
                </button>
                <button onClick={redoLine} disabled={busy} title="Do it again" aria-label="Do it again" style={iconBtn(runHadMistake, PHONE_BTN)}>
                  <RedoIcon />
                </button>
              </>
            )}
            <button
              onClick={nextLine}
              disabled={busy}
              title="Next line"
              aria-label="Next line"
              style={iconBtn(lineComplete && !runHadMistake, PHONE_BTN)}
            >
              <NextLineIcon />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', padding: `12px ${PHONE_SIDE_PADDING}px 0` }}>
          <LinePanel
            large
            repertoire={repertoire}
            runStartCard={runStartCard}
            runChapterId={runChapterId}
            runMoves={runMoves}
            leadingMoves={leadingMoves}
            isTodayTraining={isTodayTraining}
            viewIndex={viewIndex}
            onGotoPly={gotoPly}
            onNavBack={navBack}
            onNavForward={navForward}
            onExport={lineComplete ? exportLine : undefined}
          />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen pb-6 sm:pb-10" style={{ background: STUDY_BACKGROUND }}>
      <TopBar right={<span />} />

      {isNarrow && !isLandscape && (
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
      )}

      <div style={{ padding: `${isNarrow ? 8 : 12}px ${outerPadding}px 0` }}>
        {isLandscape ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ position: 'relative', width: boardSize }}>
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
            <div
              style={{
                width: clamp((viewportWidth ?? 0) - outerPadding * 2 - boardSize - EVAL_BAR_WIDTH - 20, LANDSCAPE_COLUMN_MIN, LANDSCAPE_COLUMN_MAX),
                height: boardSize,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <button
                  className="tap"
                  onClick={changeRepertoire}
                  title="Back to line picker"
                  aria-label="Back to line picker"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, fontSize: 13, fontWeight: 600, color: '#6a675f', background: '#f0efe9', border: 'none', padding: '0 12px', borderRadius: 8, cursor: 'pointer' }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M6.5 1.5L2.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  {lineComplete && (
                    <>
                      <button onClick={cycleEvalDisplay} disabled={busy} title={EVAL_DISPLAY_LABEL[evalDisplay]} aria-label={EVAL_DISPLAY_LABEL[evalDisplay]} style={iconBtn(false)}>
                        <EvalIcon state={evalDisplay} />
                      </button>
                      <button onClick={redoLine} disabled={busy} title="Do it again" aria-label="Do it again" style={iconBtn(runHadMistake)}>
                        <RedoIcon />
                      </button>
                    </>
                  )}
                  <button onClick={nextLine} disabled={busy} title="Next line" aria-label="Next line" style={iconBtn(lineComplete && !runHadMistake)}>
                    <NextLineIcon />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 22 }}>
                <MaterialRow justify="flex-start" cornerColor={materialRows.bottom.color} surplus={materialRows.bottom.surplus} pointsAhead={materialRows.bottom.pointsAhead} />
                <FeedbackStrip feedback={branchActive ? null : feedback} />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <LinePanel
                  repertoire={repertoire}
                  runStartCard={runStartCard}
                  runChapterId={runChapterId}
                  runMoves={runMoves}
                  leadingMoves={leadingMoves}
                  isTodayTraining={isTodayTraining}
                  viewIndex={viewIndex}
                  onGotoPly={gotoPly}
                  onNavBack={navBack}
                  onNavForward={navForward}
                  onExport={lineComplete ? exportLine : undefined}
                />
              </div>
            </div>
          </div>
        ) : isNarrow ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                <MaterialRow justify="flex-start" cornerColor={materialRows.top.color} surplus={materialRows.top.surplus} pointsAhead={materialRows.top.pointsAhead} />
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ position: 'relative', width: boardSize }}>
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

              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <MaterialRow justify="flex-start" cornerColor={materialRows.bottom.color} surplus={materialRows.bottom.surplus} pointsAhead={materialRows.bottom.pointsAhead} />
                <FeedbackStrip feedback={branchActive ? null : feedback} />
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
                viewIndex={viewIndex}
                onGotoPly={gotoPly}
                onNavBack={navBack}
                onNavForward={navForward}
            onExport={lineComplete ? exportLine : undefined}
              />
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', height: groupHeight }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center' }}>
              <button
                onClick={changeRepertoire}
                title="Back to line picker"
                style={{ display: 'flex', alignItems: 'center', gap: 5, height: 22, fontSize: 12, fontWeight: 600, color: '#6a675f', background: '#f0efe9', border: 'none', padding: '0 10px', borderRadius: 7, cursor: 'pointer' }}
              >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path d="M6.5 1.5L2.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
            </div>
            <div style={{ position: 'absolute', left: 0, top: MATERIAL_STRIP_HEIGHT, width: sideWidth, height: boardSize, display: 'flex', flexDirection: 'column' }}>
              <LinePanel
                repertoire={repertoire}
                runStartCard={runStartCard}
                runChapterId={runChapterId}
                runMoves={runMoves}
                leadingMoves={leadingMoves}
                isTodayTraining={isTodayTraining}
                viewIndex={viewIndex}
                onGotoPly={gotoPly}
                onNavBack={navBack}
                onNavForward={navForward}
            onExport={lineComplete ? exportLine : undefined}
              />
            </div>

            <div style={{ position: 'absolute', left: boardLeft, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                <MaterialRow justify="flex-start" cornerColor={materialRows.top.color} surplus={materialRows.top.surplus} pointsAhead={materialRows.top.pointsAhead} />
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
                </div>
              </div>

              <div style={{ width: boardSize, height: MATERIAL_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <MaterialRow justify="flex-start" cornerColor={materialRows.bottom.color} surplus={materialRows.bottom.surplus} pointsAhead={materialRows.bottom.pointsAhead} />
                <FeedbackStrip feedback={branchActive ? null : feedback} />
              </div>

            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function iconBtn(primary: boolean, size = 40): React.CSSProperties {
  return {
    width: size,
    height: size,
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

function NextLineIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="12" x2="18" y2="12" />
      <polyline points="12 6 18 12 12 18" />
    </svg>
  )
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={dir === 'left' ? '15 6 9 12 15 18' : '9 6 15 12 9 18'} />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Board from '@/components/board/Board'
import EvalBar from '@/components/analysis/EvalBar'
import EngineSettingsButton from '@/components/analysis/EngineSettingsButton'
import TopBar from '@/components/layout/TopBar'
import MoveStrip from '@/components/history/MoveStrip'
import PuzzleMoves from '@/components/puzzles/PuzzleMoves'
import FeedbackStrip from '@/components/trainer/FeedbackStrip'
import { useWoodpeckerSession } from '@/hooks/useWoodpeckerSession'
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis'
import { useViewportWidth, useViewportHeight, clamp } from '@/hooks/useViewportWidth'
import { useEngineSettings } from '@/lib/engine/settings'
import { arrowShapes, type CandidateLine } from '@/lib/engine/arrows'
import { positionKey } from '@/lib/chess/positionKey'

const MAX_SQUARE_SIZE = 112
const TOP_BAR_HEIGHT = 58
const PAGE_PADDING = 16
const CONTROLS_HEIGHT = 44
const CONTROLS_GAP = 12
const FEEDBACK_HEIGHT = 30
const NARROW_BREAKPOINT = 900
const PHONE_BREAKPOINT = 640
const PHONE_EXTRA_HEIGHT = 108
const LANDSCAPE_MAX_HEIGHT = 450
const LANDSCAPE_MAX_WIDTH = 1000
const LANDSCAPE_COLUMN_MIN = 200
const LANDSCAPE_COLUMN_MAX = 300
const PANEL_MIN_WIDTH = 220
const PANEL_MAX_WIDTH = 340
const EVAL_SLOT = 38
const SIDE_GAP = 16
const BUTTON_COLUMN_WIDTH = 150
const PUZZLE_MAX_HASH_MB = 16
const PUZZLE_ANALYSIS_DEPTH = 15
const SOLUTION_ARROW_COLOR = 'rgba(0, 48, 136, 0.4)'

export default function WoodpeckerPage() {
  const s = useWoodpeckerSession()
  const [engineSettings, updateEngineSettings, resetEngineSettings] = useEngineSettings()
  const viewportWidth = useViewportWidth()
  const viewportHeight = useViewportHeight()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const isPhone = viewportWidth != null && viewportWidth < PHONE_BREAKPOINT
  const isLandscape =
    viewportWidth != null && viewportHeight != null && viewportHeight < LANDSCAPE_MAX_HEIGHT && viewportWidth >= PHONE_BREAKPOINT && viewportWidth < LANDSCAPE_MAX_WIDTH
  const stacked = isNarrow && !isLandscape

  const finished = s.status === 'solved' || s.status === 'failed'
  const navigable = finished || s.status === 'playing'
  const [analysisOn, setAnalysisOn] = useState(false)
  if (!finished && analysisOn) setAnalysisOn(false)
  const analysisActive = finished && analysisOn
  const analysisSettings = useMemo(
    () => ({ ...engineSettings, limit: 'depth' as const, depth: PUZZLE_ANALYSIS_DEPTH, hashMb: Math.min(engineSettings.hashMb, PUZZLE_MAX_HASH_MB) }),
    [engineSettings],
  )
  const { analysis, analysisFen } = useEngineAnalysis({
    fen: s.boardState?.fen ?? null,
    gameOver: s.boardState?.isGameOver ?? false,
    enabled: analysisActive,
    settings: analysisSettings,
    immediate: true,
  })

  const { navPrev, navNext } = s
  useEffect(() => {
    if (!navigable) return
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        navPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        navNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigable, navPrev, navNext])

  const { next: nextPuzzle } = s
  useEffect(() => {
    if (!finished) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      event.preventDefault()
      if (tag === 'BUTTON') target?.blur()
      nextPuzzle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finished, nextPuzzle])

  const vw = viewportWidth ?? 375
  const vh = viewportHeight ?? 900
  const widthFit = isLandscape
    ? Math.floor((vw - 32 - EVAL_SLOT - SIDE_GAP - LANDSCAPE_COLUMN_MIN) / 8)
    : isNarrow ? Math.floor((vw - 20) / 8) : Math.floor((vw - 2 * (PANEL_MIN_WIDTH + EVAL_SLOT) - 2 * SIDE_GAP - 32) / 8)
  const heightFit = Math.floor(
    (vh - TOP_BAR_HEIGHT - PAGE_PADDING * 2 - (isLandscape ? 8 : FEEDBACK_HEIGHT) - (stacked ? CONTROLS_HEIGHT + CONTROLS_GAP + (analysisActive ? 20 : 0) + (isPhone ? PHONE_EXTRA_HEIGHT : 0) : 0)) / 8,
  )
  const squareSize = clamp(Math.min(widthFit, heightFit), isLandscape ? 28 : 36, MAX_SQUARE_SIZE)
  const boardSize = squareSize * 8
  const panelWidth = stacked ? boardSize : clamp(Math.floor((vw - 32 - boardSize) / 2 - EVAL_SLOT - SIDE_GAP), PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)

  const board = s.boardState
  const analysisIsCurrent = !!board && !!analysis && (analysisFen === null || positionKey(analysisFen) === positionKey(board.fen))
  const candidates: CandidateLine[] = []
  if (board && analysisActive && analysis && analysisIsCurrent && !board.isGameOver) {
    for (const line of analysis.lines ?? []) candidates.push({ uci: line.uciMoves?.[0], score: line.score, mate: line.mate })
    if (candidates.length === 0) candidates.push({ uci: analysis.bestMove, score: analysis.score, mate: analysis.mate })
  }
  const engineArrows = board ? arrowShapes(candidates, board.turn, engineSettings.lines) : []
  const arrows = analysisActive
    ? engineArrows
    : s.hintUci
      ? [{ uci: s.hintUci, scale: 1, color: SOLUTION_ARROW_COLOR }]
      : []

  const topRight = <span />

  const numberLabel = (
    <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#6a675f' }}>
      <span>{s.progress && s.puzzle ? `Puzzle ${s.puzzle.number} / ${s.progress.total}` : 'Woodpecker'}</span>
      {s.progress && <span style={{ fontWeight: 400, color: '#9a978f' }}>Cycle {s.progress.cycle}</span>}
    </div>
  )

  const gameOver = !!board?.isGameOver
  const checkmateWinner = gameOver && board?.gameOverReason === 'checkmate' ? (board.turn === 'w' ? -1 : 1) : 0
  const evalBarProps = gameOver
    ? { score: 0, mate: checkmateWinner, height: boardSize, flipped: s.flipped, hasEval: false }
    : {
        score: analysis?.score ?? 0,
        mate: analysis?.mate ?? 0,
        height: boardSize,
        flipped: s.flipped,
        hasEval: !!analysis?.depth || !!analysis?.tablebaseCategory,
      }
  const evalBarOpacity = gameOver || analysisIsCurrent ? 1 : 0.45

  const moves = (
    <PuzzleMoves
      nodes={s.moveNodes}
      currentId={s.currentNodeId}
      canPrev={s.canPrev}
      canNext={s.canNext}
      onGoto={s.gotoNode}
      onPrev={s.navPrev}
      onNext={s.navNext}
      height={isLandscape ? boardSize - 118 : isNarrow ? 190 : boardSize - 40}
    />
  )

  const canPause = s.status === 'playing' || s.status === 'opponent'
  const pauseButton = (
    <button
      onClick={s.togglePause}
      disabled={!canPause}
      className="tap"
      style={{
        ...secondaryButton,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: canPause ? 1 : 0.5,
        ...(s.paused ? { background: '#e8f3fd', borderColor: '#4a90d9', color: '#2f6db0' } : {}),
      }}
      title={s.paused ? 'Continue timing' : 'Pause timing'}
      aria-pressed={s.paused}
    >
      {s.paused ? <PlayIcon /> : <PauseIcon />}
      {s.paused ? 'Continue' : 'Pause'}
    </button>
  )

  const controls = (
    <div
      style={{
        display: 'flex',
        flexDirection: stacked || isLandscape ? 'row' : 'column',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: stacked || isLandscape ? 'center' : 'stretch',
        width: isLandscape ? '100%' : stacked ? boardSize : BUTTON_COLUMN_WIDTH,
        minHeight: stacked ? CONTROLS_HEIGHT : undefined,
      }}
    >
      {s.status === 'idle' && s.error && (
        <button onClick={s.next} className="tap" style={{ ...secondaryButton, background: '#4a90d9', borderColor: '#4a90d9', color: '#fff' }}>
          Try again
        </button>
      )}
      {!finished && !(s.status === 'idle' && s.error) && pauseButton}
      {!finished && !(s.status === 'idle' && s.error) && (
        <button onClick={s.giveUp} disabled={s.status !== 'playing'} className="tap" style={{ ...secondaryButton, opacity: s.status === 'playing' ? 1 : 0.5 }}>
          Give up
        </button>
      )}
      {finished && (
        <div style={{ display: 'flex', flexDirection: stacked || isLandscape ? 'row' : 'column', gap: 8 }}>
          <button onClick={s.next} className="tap" style={iconButton('primary')} title="Next puzzle" aria-label="Next puzzle">
            <NextIcon />
          </button>
          <button
            onClick={s.retry}
            className="tap"
            style={iconButton('plain')}
            title="Retry this puzzle (your rating won't change)"
            aria-label="Retry this puzzle"
          >
            <RetryIcon />
          </button>
          <button
            onClick={() => setAnalysisOn((on) => !on)}
            className="tap"
            style={iconButton(analysisOn ? 'active' : 'plain')}
            title="Analysis"
            aria-label="Analysis"
            aria-pressed={analysisOn}
          >
            <AnalysisIcon />
          </button>
          <EngineSettingsButton size={40} settings={engineSettings} onChange={updateEngineSettings} onReset={resetEngineSettings} />
        </div>
      )}
    </div>
  )

  const boardBlock = (
    <div style={{ width: boardSize }}>
      <div style={{ position: 'relative', width: boardSize, height: boardSize }}>
        {analysisActive && !stacked && (
          <div style={{ position: 'absolute', left: '100%', marginLeft: 8, top: 0, width: 22, opacity: evalBarOpacity, transition: 'opacity 120ms' }}>
            <EvalBar {...evalBarProps} />
          </div>
        )}
        {board ? (
          <div style={{ opacity: s.paused ? 0.3 : 1, pointerEvents: s.paused ? 'none' : undefined, transition: 'opacity 120ms' }}>
          <Board
            boardState={board}
            onSquareClick={s.selectSquare}
            onMove={s.move}
            legalMovesFor={s.legalMovesFor}
            squareSize={squareSize}
            flipped={s.flipped}
            analysisMoves={arrows}
          />
          </div>
        ) : (
          <div style={{ width: boardSize, height: boardSize, background: '#f0efe9', borderRadius: 6 }} />
        )}
      </div>
      {analysisActive && stacked && (
        <div style={{ width: boardSize, height: 20, opacity: evalBarOpacity }}>
          <EvalBar horizontal {...evalBarProps} />
        </div>
      )}
      {!isLandscape && <div style={{ width: boardSize, height: FEEDBACK_HEIGHT, display: 'flex', alignItems: 'center' }}>
        {s.paused ? <span style={{ fontSize: 13, color: '#6a675f' }}>Timing paused</span> : <FeedbackStrip feedback={s.feedback} />}
      </div>}
    </div>
  )

  const columnWidth = clamp(vw - 32 - boardSize - EVAL_SLOT - SIDE_GAP, LANDSCAPE_COLUMN_MIN, LANDSCAPE_COLUMN_MAX)

  return (
    <main className={isPhone && !isLandscape ? 'safe-bottom' : undefined} style={{ background: '#e8e8e6', minHeight: '100dvh' }}>
      <TopBar right={topRight} />
      {isLandscape ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: `${PAGE_PADDING}px 16px`, gap: SIDE_GAP }}>
          <div style={{ marginLeft: EVAL_SLOT }}>{boardBlock}</div>
          <div style={{ width: columnWidth, height: boardSize, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 32 }}>{numberLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', minHeight: 22 }}>
              <FeedbackStrip feedback={s.feedback} />
            </div>
            {controls}
                        {moves}
            {s.error && <p role="alert" style={{ color: '#b34343', fontSize: 13 }}>{s.error}</p>}
          </div>
        </div>
      ) : isNarrow ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: CONTROLS_GAP, padding: `${PAGE_PADDING}px 10px` }}>
          <div style={{ width: boardSize }}>{numberLabel}</div>
          {boardBlock}
          {controls}
                    {isPhone && board ? (
            <div style={{ width: boardSize, display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className="tap"
                onClick={s.navPrev}
                disabled={!s.canPrev}
                title="Previous move"
                aria-label="Previous move"
                style={{ ...iconButton('plain'), height: 44, opacity: s.canPrev ? 1 : 0.4 }}
              >
                <ChevronIcon dir="left" />
              </button>
              <MoveStrip moveTree={board.moveTree} currentNodeId={board.currentNodeId} onGotoNode={s.gotoNode} width={boardSize - 2 * 40 - 2 * 6} />
              <button
                className="tap"
                onClick={s.navNext}
                disabled={!s.canNext}
                title="Next move"
                aria-label="Next move"
                style={{ ...iconButton('plain'), height: 44, opacity: s.canNext ? 1 : 0.4 }}
              >
                <ChevronIcon dir="right" />
              </button>
            </div>
          ) : (
            <div style={{ width: boardSize }}>{moves}</div>
          )}
          {s.error && <p role="alert" style={{ color: '#b34343', fontSize: 13 }}>{s.error}</p>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', padding: `${PAGE_PADDING}px 16px` }}>
          <div style={{ justifySelf: 'end', width: panelWidth, marginRight: SIDE_GAP }}>
            <div style={{ height: 32, marginBottom: 8 }}>{numberLabel}</div>
            {moves}
          </div>
          {boardBlock}
          <div style={{ justifySelf: 'start', marginLeft: EVAL_SLOT + SIDE_GAP }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: boardSize }}>
              <div>
                {controls}
                                {s.error && <p role="alert" style={{ color: '#b34343', fontSize: 13, marginTop: 10, maxWidth: BUTTON_COLUMN_WIDTH }}>{s.error}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

const buttonBase: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 8, cursor: 'pointer' }
const secondaryButton: React.CSSProperties = { ...buttonBase, border: '1px solid #d9d6cf', background: '#fbfaf7', color: '#37352f' }

function iconButton(kind: 'primary' | 'plain' | 'active'): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    cursor: 'pointer',
    border: kind === 'primary' ? 'none' : kind === 'active' ? '1px solid #4a90d9' : '1px solid #eae8e2',
    background: kind === 'primary' ? '#4a90d9' : kind === 'active' ? '#e8f3fd' : '#fff',
    color: kind === 'primary' ? '#fff' : kind === 'active' ? '#2f6db0' : '#37352f',
  }
}

const iconProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function NextIcon() {
  return (
    <svg {...iconProps}>
      <line x1="4" y1="12" x2="18" y2="12" />
      <polyline points="12 6 18 12 12 18" />
    </svg>
  )
}

function AnalysisIcon() {
  return (
    <svg {...iconProps}>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="10" />
    </svg>
  )
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg {...iconProps}>
      <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <line x1="8" y1="5" x2="8" y2="19" />
      <line x1="16" y1="5" x2="16" y2="19" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <polygon points="7 4 19 12 7 20 7 4" />
    </svg>
  )
}

function RetryIcon() {
  return (
    <svg {...iconProps}>
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

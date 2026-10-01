'use client'

import { useEffect } from 'react'
import Board from '@/components/board/Board'
import EvalBar from '@/components/analysis/EvalBar'
import EngineSettingsButton from '@/components/analysis/EngineSettingsButton'
import TopBar from '@/components/layout/TopBar'
import ThemePicker from '@/components/puzzles/ThemePicker'
import MoveStrip from '@/components/history/MoveStrip'
import PuzzleMoves from '@/components/puzzles/PuzzleMoves'
import FeedbackStrip from '@/components/trainer/FeedbackStrip'
import { usePuzzleSession } from '@/hooks/usePuzzleSession'
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
const PANEL_MIN_WIDTH = 220
const PANEL_MAX_WIDTH = 340
const EVAL_SLOT = 38
const SIDE_GAP = 16
const BUTTON_COLUMN_WIDTH = 150
const SOLUTION_ARROW_COLOR = 'rgba(0, 48, 136, 0.4)'

export default function PuzzlesPage() {
  const s = usePuzzleSession()
  const [engineSettings, updateEngineSettings, resetEngineSettings] = useEngineSettings()
  const viewportWidth = useViewportWidth()
  const viewportHeight = useViewportHeight()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const isPhone = viewportWidth != null && viewportWidth < PHONE_BREAKPOINT

  const finished = s.status === 'solved' || s.status === 'failed'
  const navigable = finished || s.status === 'playing'
  const analysisActive = finished
  const { analysis, analysisFen } = useEngineAnalysis({
    fen: s.boardState?.fen ?? null,
    gameOver: s.boardState?.isGameOver ?? false,
    enabled: analysisActive,
    settings: engineSettings,
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

  if (!s.mode) {
    return (
      <main className="min-h-screen pb-6 sm:pb-10" style={{ background: '#e8e8e6' }}>
        <TopBar right={<span />} />
        <ThemePicker
          themes={s.themes}
          error={s.themesError}
          onMixed={() => s.start({ kind: 'mixed' })}
          onTheme={(theme) => s.start({ kind: 'theme', theme })}
          onRetry={s.loadThemes}
        />
      </main>
    )
  }

  const vw = viewportWidth ?? 375
  const vh = viewportHeight ?? 900
  const widthFit = isNarrow ? Math.floor((vw - 20) / 8) : Math.floor((vw - 2 * (PANEL_MIN_WIDTH + EVAL_SLOT) - 2 * SIDE_GAP - 32) / 8)
  const heightFit = Math.floor(
    (vh - TOP_BAR_HEIGHT - PAGE_PADDING * 2 - FEEDBACK_HEIGHT - (isNarrow ? CONTROLS_HEIGHT + CONTROLS_GAP + (analysisActive ? 20 : 0) + (isPhone ? PHONE_EXTRA_HEIGHT : 0) : 0)) / 8,
  )
  const squareSize = clamp(Math.min(widthFit, heightFit), 36, MAX_SQUARE_SIZE)
  const boardSize = squareSize * 8
  const panelWidth = isNarrow ? boardSize : clamp(Math.floor((vw - 32 - boardSize) / 2 - EVAL_SLOT - SIDE_GAP), PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)

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

  const backButton = (
    <button
      className="tap"
      onClick={s.backToPicker}
      title="Back to themes"
      aria-label="Back to themes"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
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
  )

  const evalBarProps = {
    score: analysis?.score ?? 0,
    mate: analysis?.mate ?? 0,
    height: boardSize,
    flipped: s.flipped,
    hasEval: !!analysis?.depth || !!analysis?.tablebaseCategory,
  }

  const moves = (
    <PuzzleMoves
      nodes={s.moveNodes}
      currentId={s.currentNodeId}
      canPrev={s.canPrev}
      canNext={s.canNext}
      onGoto={s.gotoNode}
      onPrev={s.navPrev}
      onNext={s.navNext}
      height={isNarrow ? 190 : boardSize - 40}
    />
  )

  const controls = (
    <div
      style={{
        display: 'flex',
        flexDirection: isNarrow ? 'row' : 'column',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: isNarrow ? 'center' : 'stretch',
        width: isNarrow ? boardSize : BUTTON_COLUMN_WIDTH,
        minHeight: isNarrow ? CONTROLS_HEIGHT : undefined,
      }}
    >
      {!finished && (
        <button onClick={s.giveUp} disabled={s.status !== 'playing'} className="tap" style={{ ...secondaryButton, opacity: s.status === 'playing' ? 1 : 0.5 }}>
          Give up
        </button>
      )}
      {finished && (
        <div style={{ display: 'flex', flexDirection: isNarrow ? 'row' : 'column', gap: 8 }}>
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
          <EngineSettingsButton size={40} settings={engineSettings} onChange={updateEngineSettings} onReset={resetEngineSettings} />
          {!isPhone && (
            <span className="mono" style={{ fontSize: 12, color: '#6a675f', alignSelf: 'center', minWidth: 52 }}>{analysis?.depth ? `depth ${analysis.depth}` : ''}</span>
          )}
        </div>
      )}
    </div>
  )

  const boardBlock = (
    <div style={{ width: boardSize }}>
      <div style={{ position: 'relative', width: boardSize, height: boardSize }}>
        {analysisActive && !isNarrow && (
          <div style={{ position: 'absolute', right: '100%', marginRight: 8, top: 0, width: 22, opacity: analysisIsCurrent ? 1 : 0.45, transition: 'opacity 120ms' }}>
            <EvalBar {...evalBarProps} />
          </div>
        )}
        {board ? (
          <Board
            boardState={board}
            onSquareClick={s.selectSquare}
            onMove={s.move}
            legalMovesFor={s.legalMovesFor}
            squareSize={squareSize}
            flipped={s.flipped}
            analysisMoves={arrows}
          />
        ) : (
          <div style={{ width: boardSize, height: boardSize, background: '#f0efe9', borderRadius: 6 }} />
        )}
      </div>
      {analysisActive && isNarrow && (
        <div style={{ width: boardSize, height: 20, opacity: analysisIsCurrent ? 1 : 0.45 }}>
          <EvalBar horizontal {...evalBarProps} />
        </div>
      )}
      <div style={{ width: boardSize, height: FEEDBACK_HEIGHT, display: 'flex', alignItems: 'center' }}>
        {isPhone ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div style={{ display: 'flex' }}><FeedbackStrip feedback={s.feedback} /></div>
            {analysisActive && analysis?.depth ? (
              <span className="mono" style={{ fontSize: 12, color: '#6a675f' }}>depth {analysis.depth}</span>
            ) : null}
          </div>
        ) : (
          <FeedbackStrip feedback={s.feedback} />
        )}
      </div>
    </div>
  )

  return (
    <main className="safe-bottom" style={{ background: '#e8e8e6', minHeight: '100dvh' }}>
      <TopBar right={topRight} />
      {isNarrow ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: CONTROLS_GAP, padding: `${PAGE_PADDING}px 10px` }}>
          <div style={{ width: boardSize }}>{backButton}</div>
          {boardBlock}
          {controls}
          {isPhone && board ? (
            <MoveStrip moveTree={board.moveTree} currentNodeId={board.currentNodeId} onGotoNode={s.gotoNode} width={boardSize} />
          ) : (
            <div style={{ width: boardSize }}>{moves}</div>
          )}
          {s.error && <p role="alert" style={{ color: '#b34343', fontSize: 13 }}>{s.error}</p>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', padding: `${PAGE_PADDING}px 16px` }}>
          <div style={{ justifySelf: 'end', width: panelWidth, marginRight: EVAL_SLOT + SIDE_GAP }}>
            <div style={{ height: 32, marginBottom: 8 }}>{backButton}</div>
            {moves}
          </div>
          {boardBlock}
          <div style={{ justifySelf: 'start', marginLeft: SIDE_GAP }}>
            {controls}
            {s.error && <p role="alert" style={{ color: '#b34343', fontSize: 13, marginTop: 10, maxWidth: BUTTON_COLUMN_WIDTH }}>{s.error}</p>}
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

function RetryIcon() {
  return (
    <svg {...iconProps}>
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

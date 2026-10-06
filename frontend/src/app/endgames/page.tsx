'use client'

import Board from '@/components/board/Board'
import TopBar from '@/components/layout/TopBar'
import EndgamePicker from '@/components/endgames/EndgamePicker'
import EndgameFeedbackLine from '@/components/endgames/EndgameFeedback'
import PuzzleMoves from '@/components/puzzles/PuzzleMoves'
import { useEndgameSession } from '@/hooks/useEndgameSession'
import { useViewportWidth, useViewportHeight, clamp } from '@/hooks/useViewportWidth'
import { userColorOf } from '@/lib/endgame/positions'

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
const SIDE_GAP = 16
const BUTTON_COLUMN_WIDTH = 150
const HINT_ARROW_COLOR = 'rgba(0, 48, 136, 0.4)'

export default function EndgamesPage() {
  const s = useEndgameSession()
  const viewportWidth = useViewportWidth()
  const viewportHeight = useViewportHeight()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const isPhone = viewportWidth != null && viewportWidth < PHONE_BREAKPOINT

  const finished = s.status === 'success' || s.status === 'failed'

  if (!s.position) {
    return (
      <main className="min-h-screen pb-6 sm:pb-10" style={{ background: '#e8e8e6' }}>
        <TopBar right={<span />} />
        <EndgamePicker done={s.done} onRandom={s.next} onPick={s.start} />
      </main>
    )
  }

  const vw = viewportWidth ?? 375
  const vh = viewportHeight ?? 900
  const widthFit = isNarrow ? Math.floor((vw - 20) / 8) : Math.floor((vw - 2 * PANEL_MIN_WIDTH - 2 * SIDE_GAP - 32) / 8)
  const heightFit = Math.floor(
    (vh - TOP_BAR_HEIGHT - PAGE_PADDING * 2 - FEEDBACK_HEIGHT - (isNarrow ? CONTROLS_HEIGHT + CONTROLS_GAP + (isPhone ? PHONE_EXTRA_HEIGHT : 0) : 0)) / 8,
  )
  const squareSize = clamp(Math.min(widthFit, heightFit), 36, MAX_SQUARE_SIZE)
  const boardSize = squareSize * 8
  const panelWidth = isNarrow ? boardSize : clamp(Math.floor((vw - 32 - boardSize) / 2 - SIDE_GAP), PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)

  const board = s.boardState
  const arrows = s.hintMoves.map((uci) => ({ uci, scale: 1, color: HINT_ARROW_COLOR }))
  const side = userColorOf(s.position) === 'w' ? 'White' : 'Black'
  const goalText = s.position.goal === 'win' ? `Win as ${side}` : `Hold the draw as ${side}`

  const backButton = (
    <button className="tap" onClick={s.backToPicker} title="Back to endgames" aria-label="Back to endgames" style={backStyle}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M6.5 1.5L2.5 5L6.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back
    </button>
  )

  const nameCard = (
    <div style={{ ...infoCard, marginBottom: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{s.position.name}</div>
    </div>
  )

  const moves = (
    <PuzzleMoves
      nodes={s.moveNodes}
      currentId={s.currentNodeId}
      canPrev={s.canPrev}
      canNext={s.canNext}
      onGoto={s.gotoNode}
      onPrev={s.navPrev}
      onNext={s.navNext}
      height={isNarrow ? 190 : boardSize - 90}
    />
  )

  const goalCard = (
    <div style={{ ...infoCard, width: isNarrow ? boardSize : BUTTON_COLUMN_WIDTH, boxSizing: 'border-box' }}>
      <div className="lbl" style={{ color: '#a3a099' }}>GOAL</div>
      <div style={{ fontWeight: 600, color: '#2f6db0', fontSize: 13 }}>{goalText}</div>
      <div className="lbl" style={{ color: '#a3a099', marginTop: 8 }}>{finished ? 'MOVES USED' : 'MOVES LEFT'}</div>
      <div className="mono" style={{ fontSize: 14 }}>{finished ? s.movesUsed : (s.movesLeft ?? '–')}</div>
      {finished && s.mistakes > 0 && (
        <>
          <div className="lbl" style={{ color: '#a3a099', marginTop: 8 }}>MISTAKES</div>
          <div className="mono" style={{ fontSize: 14 }}>{s.mistakes}</div>
        </>
      )}
    </div>
  )

  const controls = (
    <div style={{ display: 'flex', gap: 8, minHeight: isNarrow ? CONTROLS_HEIGHT : undefined, alignItems: 'center', marginTop: isNarrow ? 0 : 10 }}>
      <button onClick={s.next} className="tap" style={iconButton('primary')} title="Next position" aria-label="Next position">
        <svg {...iconProps}>
          <line x1="4" y1="12" x2="18" y2="12" />
          <polyline points="12 6 18 12 12 18" />
        </svg>
      </button>
      <button
        onClick={s.showHint}
        disabled={s.status !== 'playing'}
        className="tap"
        style={{ ...iconButton('plain'), opacity: s.status === 'playing' ? 1 : 0.4 }}
        title="Hint"
        aria-label="Hint"
      >
        <svg {...iconProps}>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
        </svg>
      </button>
      <button onClick={s.restart} className="tap" style={iconButton('plain')} title="Restart this position" aria-label="Restart this position">
        <svg {...iconProps}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <polyline points="3 4 3 10 9 10" />
        </svg>
      </button>
    </div>
  )

  const boardBlock = (
    <div style={{ width: boardSize }}>
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
      <div style={{ width: boardSize, height: FEEDBACK_HEIGHT, display: 'flex', alignItems: 'center' }}>
        <EndgameFeedbackLine feedback={s.feedback} />
      </div>
    </div>
  )

  return (
    <main className={isPhone ? 'safe-bottom' : undefined} style={{ background: '#e8e8e6', minHeight: '100dvh' }}>
      <TopBar right={<span />} />
      {isNarrow ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: CONTROLS_GAP, padding: `${PAGE_PADDING}px 10px` }}>
          <div style={{ width: boardSize }}>{backButton}</div>
          {boardBlock}
          {controls}
          {goalCard}
          <div style={{ width: boardSize }}>
            {nameCard}
            {moves}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', padding: `${PAGE_PADDING}px 16px` }}>
          <div style={{ justifySelf: 'end', width: panelWidth, marginRight: SIDE_GAP }}>
            <div style={{ height: 32, marginBottom: 8 }}>{backButton}</div>
            {nameCard}
            {moves}
          </div>
          {boardBlock}
          <div style={{ justifySelf: 'start', marginLeft: SIDE_GAP }}>
            {goalCard}
            {controls}
          </div>
        </div>
      )}
    </main>
  )
}

const backStyle: React.CSSProperties = {
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
}

const infoCard: React.CSSProperties = {
  background: '#fbfaf7',
  border: '1px solid #eae8e2',
  borderRadius: 8,
  padding: '10px 12px',
}

function iconButton(kind: 'primary' | 'plain'): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    cursor: 'pointer',
    border: kind === 'primary' ? 'none' : '1px solid #eae8e2',
    background: kind === 'primary' ? '#4a90d9' : '#fff',
    color: kind === 'primary' ? '#fff' : '#37352f',
  }
}

const iconProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

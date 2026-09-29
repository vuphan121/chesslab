'use client'

import Board from '@/components/board/Board'
import EvalBar from '@/components/analysis/EvalBar'
import { EVAL_DISPLAY_LABEL, EvalIcon, useEvalDisplay } from '@/components/analysis/EvalToggle'
import MaterialCorners, { MATERIAL_CORNERS_WIDTH } from '@/components/board/MaterialCorners'
import MoveHistory from '@/components/history/MoveHistory'
import TopBar from '@/components/layout/TopBar'
import OpeningTree from '@/components/tree/OpeningTree'
import EngineSettingsButton from '@/components/analysis/EngineSettingsButton'
import { useChessGame } from '@/hooks/useChessGame'
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis'
import { arrowShapes } from '@/lib/engine/arrows'
import type { CandidateLine } from '@/lib/engine/arrows'
import { useEngineSettings } from '@/lib/engine/settings'
import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { useViewportWidth, useViewportHeight, clamp } from '@/hooks/useViewportWidth'
import { flatten } from '@/lib/chess/moveTree'
import MoveStrip from '@/components/history/MoveStrip'
import { MaterialRow, computeMaterialRows } from '@/components/board/MaterialCorners'

const DESKTOP_SQUARE_SIZE = 72
const SIDE_WIDTH = 371
const NARROW_BREAKPOINT = 1040
const PHONE_BREAKPOINT = 640
const PHONE_STRIP_HEIGHT = 22
const OUTER_PADDING_DESKTOP = 24
const OUTER_PADDING_NARROW = 14
const EVAL_DISPLAY_STORAGE_KEY = 'chesslab.analysis.evalDisplay'
const TREE_STORAGE_KEY = 'chesslab.analysis.openingTree'
const ROW_GAP_DESKTOP = 20
const MAX_SQUARE_SIZE = 112
const PAGE_TOP_PADDING = 8
const TOP_BAR_HEIGHT = 58
const PAGE_BOTTOM_RESERVE = 32

const treeListeners = new Set<() => void>()
let treeMemory: boolean | null = null

function readShowTree(): boolean {
  try {
    const stored = localStorage.getItem(TREE_STORAGE_KEY)
    if (stored === 'on' || stored === 'off') return stored === 'on'
  } catch {}
  return treeMemory ?? true
}

function subscribeTree(callback: () => void): () => void {
  treeListeners.add(callback)
  window.addEventListener('storage', callback)
  return () => {
    treeListeners.delete(callback)
    window.removeEventListener('storage', callback)
  }
}


const FULL_CONTAINER_WIDTH =
  SIDE_WIDTH * 2 + ROW_GAP_DESKTOP * 2 + (DESKTOP_SQUARE_SIZE * 8 + 11 + 15 + 11 + MATERIAL_CORNERS_WIDTH) + OUTER_PADDING_DESKTOP * 2
const MIN_DESKTOP_SCALE = 0.45




const CAPTION_ROW_HEIGHT = 30
const COLUMN_GAP = 10
const BOARD_TOP_OFFSET = CAPTION_ROW_HEIGHT + COLUMN_GAP



function formatEval(score: number, mate: number): string {
  if (mate !== 0) return `#${mate}`
  const v = (Math.abs(score) / 100).toFixed(1)
  return score >= 0 ? `+${v}` : `-${v}`
}

function formatTablebaseEval(score: number, mate: number, category: string): string {
  if (mate !== 0) return formatEval(score, mate)
  switch (category) {
    case 'win':
    case 'syzygy-win':
      return 'White wins'
    case 'loss':
    case 'syzygy-loss':
      return 'Black wins'
    case 'cursed-win':
      return 'White wins*'
    case 'blessed-loss':
      return 'Black wins*'
    case 'maybe-win':
      return 'White likely wins'
    case 'maybe-loss':
      return 'Black likely wins'
    case 'unknown':
      return 'Unknown'
    default:
      return 'Draw'
  }
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  )
}

function HomeInner() {


  const searchParams = useSearchParams()
  const initialGameId = searchParams.get('gameId') ?? undefined

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
    loadPgn,
    gameId,
    explorer,
    explorerLoading,
    lastOpening,
    flipped,
    toggleFlipped,
  } = useChessGame(initialGameId)

  const [animateMove, setAnimateMove] = useState(false)
  const stepPrev = useCallback(() => {
    setAnimateMove(true)
    navPrev()
  }, [navPrev])
  const stepNext = useCallback(() => {
    setAnimateMove(true)
    navNext()
  }, [navNext])
  const jump = useCallback(
    <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A) => {
        setAnimateMove(false)
        return fn(...args)
      },
    [],
  )

  const [evalDisplay, cycleEvalDisplay] = useEvalDisplay(EVAL_DISPLAY_STORAGE_KEY, 'eval-moves')
  const [engineSettings, updateEngineSettings, resetEngineSettings] = useEngineSettings()
  const { analysis, analysisFen, analyzing, engineError } = useEngineAnalysis({
    gameId,
    fen: boardState?.fen ?? null,
    gameOver: boardState?.isGameOver ?? false,
    enabled: evalDisplay !== 'off',
    settings: engineSettings,
  })
  const viewportWidth = useViewportWidth()
  const viewportHeight = useViewportHeight()
  const showTree = useSyncExternalStore(subscribeTree, readShowTree, () => true)
  const toggleTree = useCallback(() => {
    const next = !readShowTree()
    treeMemory = next
    try {
      localStorage.setItem(TREE_STORAGE_KEY, next ? 'on' : 'off')
    } catch {}
    treeListeners.forEach((l) => l())
  }, [])



  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const isPhone = viewportWidth != null && viewportWidth < PHONE_BREAKPOINT
  const outerPadding = isNarrow ? OUTER_PADDING_NARROW : OUTER_PADDING_DESKTOP











  const desktopScale = isNarrow
    ? 1
    : clamp((viewportWidth ?? FULL_CONTAINER_WIDTH) / FULL_CONTAINER_WIDTH, MIN_DESKTOP_SCALE, 1)
  const squareSize = isPhone
    ? clamp(Math.floor(((viewportWidth ?? PHONE_BREAKPOINT) - outerPadding * 2) / 8), 30, DESKTOP_SQUARE_SIZE)
    : isNarrow
    ? clamp(
        Math.floor(
          ((viewportWidth ?? NARROW_BREAKPOINT) - outerPadding * 2 - 15 - 11 - MATERIAL_CORNERS_WIDTH - 11) / 8,
        ),
        30,
        DESKTOP_SQUARE_SIZE,
      )
    : clamp(
        Math.min(
          Math.floor(
            ((viewportWidth ?? FULL_CONTAINER_WIDTH) -
              outerPadding * 2 -
              Math.floor(SIDE_WIDTH * desktopScale) * 2 -
              Math.max(12, Math.floor(ROW_GAP_DESKTOP * desktopScale)) * 2 -
              11 -
              MATERIAL_CORNERS_WIDTH -
              11 -
              22) /
              8,
          ),
          Math.floor(
            ((viewportHeight ?? 900) -
              TOP_BAR_HEIGHT -
              PAGE_TOP_PADDING -
              outerPadding * 2 -
              BOARD_TOP_OFFSET -
              PAGE_BOTTOM_RESERVE) /
              8,
          ),
        ),
        40,
        MAX_SQUARE_SIZE,
      )
  const boardSize = squareSize * 8
  const sideWidth = isNarrow ? SIDE_WIDTH : Math.floor(SIDE_WIDTH * desktopScale)
  const rowGap = isNarrow ? 16 : Math.max(12, Math.floor(ROW_GAP_DESKTOP * desktopScale))
  const containerWidth =
    sideWidth * 2 + rowGap * 2 + boardSize + 11 + MATERIAL_CORNERS_WIDTH + 11 + 22 + outerPadding * 2

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [stepPrev, stepNext])

  if (!boardState) return null

  const atStart = boardState.currentNodeId === boardState.moveTree.id
  const atEnd = !(boardState.moveTree && flatten(boardState.moveTree).get(boardState.currentNodeId)?.node.children?.length)
  // Past the Lichess explorer's book, explorer.openingName comes back empty —
  // keep showing the last named opening reached on this line instead of a
  // generic placeholder (see useChessGame's lastOpening).
  const openingName = atStart
    ? 'Starting Position'
    : (explorer?.openingName ?? lastOpening?.name ?? '')

  const showEval = evalDisplay !== 'off'
  const analysisIsCurrent = !!analysis && (analysisFen === null || analysisFen === boardState.fen)
  const candidates: CandidateLine[] = []
  if (analysis && analysisIsCurrent && !boardState.isGameOver) {
    for (const line of analysis.lines ?? []) candidates.push({ uci: line.uciMoves?.[0], score: line.score, mate: line.mate })
    if (candidates.length === 0) candidates.push({ uci: analysis.bestMove, score: analysis.score, mate: analysis.mate })
  }
  const suggestionArrows =
    evalDisplay === 'eval-moves' ? arrowShapes(candidates, boardState.turn, engineSettings.lines) : []

  const playContinuation = (uci: string) => move(uci.slice(0, 2), uci.slice(2, 4))

  const hasBook = (explorer?.moves?.length ?? 0) > 0

  const ctlSize = isPhone ? 40 : 30
  const materialRows = computeMaterialRows(boardState.pieces, flipped)

  const controlsRow = (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '0 2px 2px',
      height: CAPTION_ROW_HEIGHT,
      width: isPhone ? boardSize : isNarrow ? boardSize + 11 + MATERIAL_CORNERS_WIDTH + 11 + 22 : sideWidth,
    }}
  >
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {showEval && (!!analysis?.depth || !!analysis?.tablebaseCategory) && (
          <span
            className="mono"
            style={{ fontSize: 11, color: '#a3a099', opacity: analysisIsCurrent ? 1 : 0.45, transition: 'opacity 120ms' }}
          >
            {analysis.tablebaseCategory ? (
              <>
                {analysis.engineName} ·{' '}
                {analysis.tablebaseDtz !== undefined && `DTZ ${Math.abs(analysis.tablebaseDtz)} · `}
                <span style={{ fontWeight: 700, color: '#37352f' }}>
                  {formatTablebaseEval(analysis.score, analysis.mate, analysis.tablebaseCategory)}
                </span>
              </>
            ) : (
              <>
                depth {analysis.depth}{analyzing ? '…' : ''}
              </>
            )}
          </span>
        )}
        {engineError && (
          <span title={engineError} style={{ fontSize: 11, color: '#b3483f' }}>
            Browser engine unavailable, using the server
          </span>
        )}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <EngineSettingsButton size={ctlSize} settings={engineSettings} onChange={updateEngineSettings} onReset={resetEngineSettings} />
      <button
        onClick={cycleEvalDisplay}
        title={EVAL_DISPLAY_LABEL[evalDisplay]}
        aria-label={EVAL_DISPLAY_LABEL[evalDisplay]}
        style={{
          width: ctlSize,
          height: ctlSize,
          border: '1px solid #eae8e2',
          background: '#fff',
          borderRadius: 6,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <EvalIcon state={evalDisplay} size={15} />
      </button>
      <button
        onClick={toggleTree}
        title={showTree ? 'Hide opening tree' : 'Show opening tree'}
        aria-label={showTree ? 'Hide opening tree' : 'Show opening tree'}
        aria-pressed={showTree}
        style={{
          width: ctlSize,
          height: ctlSize,
          border: '1px solid #eae8e2',
          background: '#fff',
          borderRadius: 6,
          color: showTree ? '#4a90d9' : '#b4b1a8',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <circle cx="3" cy="7.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="12" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="12" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4.5 7.5H7M7 7.5V3H10.4M7 7.5V12H10.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        onClick={toggleFlipped}
        title="Flip board"
        style={{
          width: ctlSize,
          height: ctlSize,
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
  )

  const treePanel = (
    <OpeningTree
      moves={explorer?.moves ?? []}
      loading={explorerLoading}
      onPlay={jump(playContinuation)}
      height={isNarrow ? 260 : boardSize}
    />
  )

  return (
    <main className="min-h-screen bg-[#e8e8e6] pb-6 sm:pb-10">
      <TopBar />
      <div className="flex justify-center" style={{ paddingTop: isNarrow ? 20 : PAGE_TOP_PADDING }}>
      <div
        style={{
          width: isNarrow ? '100%' : containerWidth,
          maxWidth: '100vw',
          flexShrink: 0,
          background: '#e8e8e6',
          borderRadius: 16,
          padding: isNarrow ? outerPadding : `${outerPadding / 2}px ${outerPadding}px ${outerPadding}px`,
        }}
      >
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
              order: isNarrow ? 1 : 2,
              alignItems: isNarrow ? 'center' : undefined,
              marginTop: isNarrow ? 0 : BOARD_TOP_OFFSET,
            }}
          >
            {isNarrow && controlsRow}

            {isPhone ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: boardSize, height: PHONE_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <MaterialRow cornerColor={materialRows.top.color} surplus={materialRows.top.surplus} pointsAhead={materialRows.top.pointsAhead} />
                </div>
                <Board
                  boardState={boardState}
                  animateLastMove={animateMove}
                  onSquareClick={jump(selectSquare)}
                  onMove={jump(move)}
                  legalMovesFor={legalMovesFor}
                  squareSize={squareSize}
                  flipped={flipped}
                  analysisMoves={suggestionArrows}
                />
                <div style={{ width: boardSize, height: PHONE_STRIP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <MaterialRow cornerColor={materialRows.bottom.color} surplus={materialRows.bottom.surplus} pointsAhead={materialRows.bottom.pointsAhead} />
                </div>
                <div style={{ width: boardSize, height: 20, display: 'flex', alignItems: 'center', opacity: analysisIsCurrent ? 1 : 0.45, transition: 'opacity 120ms' }}>
                  {showEval && (
                    <EvalBar
                      horizontal
                      score={analysis?.score ?? 0}
                      mate={analysis?.mate ?? 0}
                      height={boardSize}
                      flipped={flipped}
                      hasEval={!!analysis?.depth || !!analysis?.tablebaseCategory}
                    />
                  )}
                </div>
                <div style={{ width: boardSize, display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                  {([
                    ['Start', '⟨⟨', jump(navStart), atStart],
                    ['Previous move', '⟨', stepPrev, atStart],
                    ['Next move', '⟩', stepNext, atEnd],
                    ['End', '⟩⟩', jump(navEnd), atEnd],
                  ] as const).map(([label, glyph, onClick, disabled]) => (
                    <button
                      key={label}
                      onClick={onClick}
                      disabled={disabled}
                      aria-label={label}
                      title={label}
                      style={{
                        flex: 1,
                        height: 44,
                        border: '1px solid #eae8e2',
                        background: '#fff',
                        borderRadius: 10,
                        fontSize: 18,
                        color: disabled ? '#c9c6bc' : '#37352f',
                        cursor: disabled ? 'default' : 'pointer',
                      }}
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <MoveStrip moveTree={boardState.moveTree} currentNodeId={boardState.currentNodeId} onGotoNode={jump(gotoNode)} width={boardSize} />
                </div>
              </div>
            ) : (
            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                <Board
                  boardState={boardState}
                  animateLastMove={animateMove}
                  onSquareClick={jump(selectSquare)}
                  onMove={jump(move)}
                  legalMovesFor={legalMovesFor}
                  squareSize={squareSize}
                  flipped={flipped}
                  analysisMoves={suggestionArrows}
                />
                <MaterialCorners pieces={boardState.pieces} flipped={flipped} height={boardSize} />
                <div style={{ width: 22, height: boardSize, flexShrink: 0, opacity: analysisIsCurrent ? 1 : 0.45, transition: 'opacity 120ms' }}>
                  {showEval && (
                    <EvalBar
                      score={analysis?.score ?? 0}
                      mate={analysis?.mate ?? 0}
                      height={boardSize}
                      flipped={flipped}
                      hasEval={!!analysis?.depth || !!analysis?.tablebaseCategory}
                    />
                  )}
                </div>
              </div>
            )}

            {isNarrow && showTree && hasBook && (
              <div style={{ width: isPhone ? boardSize : boardSize + 11 + MATERIAL_CORNERS_WIDTH + 11 + 22 }}>{treePanel}</div>
            )}
          </div>

          <div
            style={{
              width: isNarrow ? '100%' : sideWidth,
              height: isNarrow ? 360 : boardSize,
              marginTop: isNarrow ? 0 : BOARD_TOP_OFFSET,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              order: isNarrow ? 2 : 1,
            }}
          >
            <MoveHistory
              openingName={openingName}
              moveTree={boardState.moveTree}
              currentNodeId={boardState.currentNodeId}
              onGotoNode={jump(gotoNode)}
              onLoadPgn={jump(loadPgn)}
              engineEnabled={evalDisplay !== 'off'}
              engineBusy={analyzing}
            />
          </div>

          {!isNarrow && (
            <div style={{ width: sideWidth, flexShrink: 0, order: 3, display: 'flex', flexDirection: 'column', gap: COLUMN_GAP }}>
              {controlsRow}
              {showTree && hasBook && treePanel}
            </div>
          )}
        </div>
      </div>
      </div>
    </main>
  )
}

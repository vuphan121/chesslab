'use client'

import Board from '@/components/board/Board'
import EvalBar from '@/components/analysis/EvalBar'
import MaterialCorners, { MATERIAL_CORNERS_WIDTH } from '@/components/board/MaterialCorners'
import MoveHistory from '@/components/history/MoveHistory'
import TopBar from '@/components/layout/TopBar'
import OpeningTree from '@/components/tree/OpeningTree'
import { useChessGame } from '@/hooks/useChessGame'
import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useViewportWidth, clamp } from '@/hooks/useViewportWidth'

const DESKTOP_SQUARE_SIZE = 72
const SIDE_WIDTH = 371
const NARROW_BREAKPOINT = 1040
const OUTER_PADDING_DESKTOP = 24
const OUTER_PADDING_NARROW = 14
const ROW_GAP_DESKTOP = 20


// "11 + 15" is the pre-existing (stale — EvalBar is actually 22px) board-row
// gap+eval-bar allowance; "+ 11 + MATERIAL_CORNERS_WIDTH" is this row's new
// third flex child (board → gap → MaterialCorners → gap → EvalBar).
const FULL_CONTAINER_WIDTH =
  SIDE_WIDTH * 2 + ROW_GAP_DESKTOP * 2 + (DESKTOP_SQUARE_SIZE * 8 + 11 + 15 + 11 + MATERIAL_CORNERS_WIDTH) + OUTER_PADDING_DESKTOP * 2
const MIN_DESKTOP_SCALE = 0.45




const CAPTION_ROW_HEIGHT = 30
const COLUMN_GAP = 14
const BOARD_TOP_OFFSET = CAPTION_ROW_HEIGHT + COLUMN_GAP



function formatEval(score: number, mate: number): string {
  if (mate !== 0) return `#${mate}`
  const v = (Math.abs(score) / 100).toFixed(1)
  return score >= 0 ? `+${v}` : `-${v}`
}

// A tablebase result with no DTM (7-man positions never carry one — see
// backend CLAUDE.md) has no real mate/cp number, just an exact category —
// showing "+100.0" from the score sentinel would look like a real eval, so
// this takes over whenever mate is unavailable.
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
    reset,
    loadPgn,
    analysis,
    explorer,
    explorerLoading,
    flipped,
    toggleFlipped,
  } = useChessGame(initialGameId)

  const viewportWidth = useViewportWidth()



  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const outerPadding = isNarrow ? OUTER_PADDING_NARROW : OUTER_PADDING_DESKTOP











  const desktopScale = isNarrow
    ? 1
    : clamp((viewportWidth ?? FULL_CONTAINER_WIDTH) / FULL_CONTAINER_WIDTH, MIN_DESKTOP_SCALE, 1)
  const squareSize = isNarrow
    ? clamp(
        Math.floor(
          ((viewportWidth ?? NARROW_BREAKPOINT) - outerPadding * 2 - 15 - 11 - MATERIAL_CORNERS_WIDTH - 11) / 8,
        ),
        30,
        DESKTOP_SQUARE_SIZE,
      )
    : clamp(Math.floor(DESKTOP_SQUARE_SIZE * desktopScale), 30, DESKTOP_SQUARE_SIZE)
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
    <main className="min-h-screen bg-[#e8e8e6] pb-6 sm:pb-10">
      <TopBar turn={boardState.turn} isBookMove={isBookMove} />
      <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 84px)', paddingTop: isNarrow ? 20 : 28 }}>
      <div
        style={{
          width: isNarrow ? '100%' : containerWidth,
          maxWidth: '100vw',
          flexShrink: 0,
          background: '#e8e8e6',
          borderRadius: 16,
          padding: outerPadding,
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
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                padding: '0 2px 2px',
                width: boardSize + 11 + MATERIAL_CORNERS_WIDTH + 11 + 22,
              }}
            >
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {(!!analysis?.depth || !!analysis?.tablebaseCategory) && (
                  <span className="mono" style={{ fontSize: 12, color: '#a3a099' }}>
                    {analysis.engineName} ·{' '}
                    {analysis.tablebaseCategory ? (
                      <>
                        {analysis.tablebaseDtz !== undefined && `DTZ ${Math.abs(analysis.tablebaseDtz)} · `}
                        <span style={{ fontWeight: 700, color: '#37352f' }}>
                          {formatTablebaseEval(analysis.score, analysis.mate, analysis.tablebaseCategory)}
                        </span>
                      </>
                    ) : (
                      <>
                        depth {analysis.depth} ·{' '}
                        <span style={{ fontWeight: 700, color: '#37352f' }}>
                          {formatEval(analysis.score, analysis.mate)}
                        </span>
                      </>
                    )}
                  </span>
                )}
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
                squareSize={squareSize}
                flipped={flipped}
              />
              <MaterialCorners pieces={boardState.pieces} flipped={flipped} height={boardSize} />
              <EvalBar
                score={analysis?.score ?? 0}
                mate={analysis?.mate ?? 0}
                height={boardSize}
                flipped={flipped}
                hasEval={!!analysis?.depth || !!analysis?.tablebaseCategory}
              />
            </div>

            <div style={{ width: boardSize + 11 + MATERIAL_CORNERS_WIDTH + 11 + 22 }}>
              <OpeningTree
                moves={explorer?.moves ?? []}
                totalGames={explorer?.totalGames ?? 0}
                loading={explorerLoading}
                onPlay={playContinuation}
              />
            </div>
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

          {!isNarrow && <div style={{ width: sideWidth, flexShrink: 0, order: 3 }} aria-hidden="true" />}
        </div>
      </div>
      </div>
    </main>
  )
}

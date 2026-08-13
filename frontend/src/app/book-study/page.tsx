'use client'

import { useEffect } from 'react'
import Board from '@/components/board/Board'
import TopBar from '@/components/layout/TopBar'
import BookPicker from '@/components/book/BookPicker'
import ItemPanel from '@/components/book/ItemPanel'
import ChapterSections from '@/components/book/ChapterSections'
import { useBookStudySession } from '@/hooks/useBookStudySession'
import { useViewportWidth, clamp } from '@/hooks/useViewportWidth'

const DESKTOP_SQUARE_SIZE = 72
const SIDE_WIDTH = 300
const SECTIONS_WIDTH = 180
const NARROW_BREAKPOINT = 1200
const OUTER_PADDING_DESKTOP = 24
const OUTER_PADDING_NARROW = 14
const CAPTION_ROW_HEIGHT = 30
const COLUMN_GAP = 14
const BOARD_TOP_OFFSET = CAPTION_ROW_HEIGHT + COLUMN_GAP
const ROW_GAP_DESKTOP = 20
const FULL_CONTAINER_WIDTH =
  DESKTOP_SQUARE_SIZE * 8 + SIDE_WIDTH + SECTIONS_WIDTH + ROW_GAP_DESKTOP * 2 + OUTER_PADDING_DESKTOP * 2
const MIN_DESKTOP_SCALE = 0.45

export default function BookStudyPage() {
  const {
    phase,
    book,
    loadError,
    loading,
    flatItems,
    flatIndex,
    current,
    boardState,
    busy,
    flipped,
    toggleFlipped,
    feedback,
    lessonStarted,
    completedItems,
    currentPly,
    canStepBack,
    canStepForward,
    stepBack,
    stepForward,
    startLesson,
    revealSolution,
    loadStart,
    nextItem,
    prevItem,
    goToIndex,
    selectSquare,
    move,
    legalMovesFor,
    restart,
  } = useBookStudySession()

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
  const sectionsWidth = isNarrow ? SECTIONS_WIDTH : Math.floor(SECTIONS_WIDTH * desktopScale)
  const rowGap = isNarrow ? 16 : Math.max(12, Math.floor(ROW_GAP_DESKTOP * desktopScale))
  const containerWidth = boardSize + sideWidth + sectionsWidth + rowGap * 2 + outerPadding * 2

  const chapterItems = current ? flatItems.filter((f) => f.chapterId === current.chapterId) : []
  const chapterStartIndex = current ? flatItems.findIndex((f) => f.chapterId === current.chapterId) : 0

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepBack()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepForward()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [stepBack, stepForward])

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
        <BookPicker onStart={loadStart} starting={loading} startError={loadError} />
      </main>
    )
  }

  if (phase === 'done') {
    return (
      <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10">
        <div style={outerWrapStyle}>
          <TopBar right={<span />} />
        </div>
        <div
          style={{
            width: 'min(480px, calc(100vw - 32px))',
            margin: '24px auto',
            background: '#fff',
            borderRadius: 11,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
            padding: 'clamp(16px, 4vw, 28px)',
            textAlign: 'center',
          }}
        >
          <h1 className="serif" style={{ fontSize: 20, fontWeight: 500, marginBottom: 10 }}>
            Chapter complete
          </h1>
          <p style={{ fontSize: 13, color: '#7a776f', marginBottom: 20 }}>
            You&rsquo;ve worked through every position in {book?.title}.
          </p>
          <button
            onClick={restart}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '9px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#4a90d9',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Choose another book
          </button>
        </div>
      </main>
    )
  }

  if (!boardState || !book || !current) {
    return (
      <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10">
        <div style={outerWrapStyle}>
          <TopBar right={<span />} />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#e8e8e6] py-6 sm:py-10">
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
              {book.title}
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
              <span style={{ fontSize: 14, color: '#37352f' }}>
                <strong>{boardState.turn === 'w' ? 'White' : 'Black'} to move</strong>
              </span>
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

            <Board
              boardState={boardState}
              onSquareClick={selectSquare}
              onMove={move}
              legalMovesFor={legalMovesFor}
              squareSize={squareSize}
              flipped={flipped}
            />

            <div
              style={{
                width: boardSize,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={stepBack}
                  disabled={!canStepBack}
                  title="Previous move (←)"
                  style={navBtn(canStepBack)}
                >
                  ⟨
                </button>
                <button
                  onClick={stepForward}
                  disabled={!canStepForward}
                  title="Next move (→)"
                  style={navBtn(canStepForward)}
                >
                  ⟩
                </button>
              </div>
              <span className="mono" style={{ fontSize: 12, color: '#a3a099' }}>
                {currentPly > 0 || canStepBack ? `ply ${currentPly}` : ' '}
              </span>
            </div>
          </div>

          <div
            style={{
              width: isNarrow ? '100%' : sideWidth,
              height: isNarrow ? 420 : boardSize,
              marginTop: isNarrow ? 0 : BOARD_TOP_OFFSET,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              order: isNarrow ? 2 : 0,
            }}
          >
            <ItemPanel
              current={current}
              index={flatIndex}
              total={flatItems.length}
              feedback={feedback}
              lessonStarted={lessonStarted}
              completed={completedItems.has(current.item.id)}
              busy={busy}
              onPrev={prevItem}
              onNext={nextItem}
              onStartLesson={startLesson}
              onRevealSolution={revealSolution}
            />
          </div>

          <div
            style={{
              width: isNarrow ? '100%' : sectionsWidth,
              height: isNarrow ? 260 : boardSize,
              marginTop: isNarrow ? 0 : BOARD_TOP_OFFSET,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              order: isNarrow ? 3 : 0,
            }}
          >
            <ChapterSections
              items={chapterItems}
              activeItemId={current.item.id}
              completedItems={completedItems}
              busy={busy}
              onSelect={(localIndex) => goToIndex(chapterStartIndex + localIndex)}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

function navBtn(enabled: boolean): React.CSSProperties {
  return {
    width: 34,
    height: 30,
    border: '1px solid #eae8e2',
    background: '#fff',
    borderRadius: 6,
    color: enabled ? '#37352f' : '#d6d3ca',
    cursor: enabled ? 'pointer' : 'default',
    fontSize: 14,
  }
}

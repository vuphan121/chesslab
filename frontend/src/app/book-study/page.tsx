'use client'

import { useEffect } from 'react'
import Board from '@/components/board/Board'
import TopBar from '@/components/layout/TopBar'
import BookPicker from '@/components/book/BookPicker'
import BookMoveHistory from '@/components/book/BookMoveHistory'
import EvalBar from '@/components/analysis/EvalBar'
import ChapterSections from '@/components/book/ChapterSections'
import BookPDFViewer from '@/components/book/BookPDFViewer'
import { useBookStudySession } from '@/hooks/useBookStudySession'
import { useViewportWidth, clamp } from '@/hooks/useViewportWidth'
import { sourcePageForItem } from '@/lib/books/sourcePages'

const DESKTOP_SQUARE_SIZE = 72
const SECTIONS_WIDTH = 190
const PDF_WIDTH = 460
const NARROW_BREAKPOINT = 1360
const OUTER_PADDING = 24
const COLUMN_GAP = 16
const EVAL_SLOT_WIDTH = 30

export default function BookStudyPage() {
  const {
    phase, book, loadError, loading, flatItems, current, boardState,
    busy, flipped, toggleFlipped, analysisEnabled, analysis, analysisLoading, toggleAnalysis, completedItemIds, bookmarkedItemIds, completionBusy, completionError, markCurrentComplete, toggleCurrentBookmark, currentPly, canStepBack, canStepForward,
    stepBack, stepForward, loadStart, goToIndex, goToMove, selectSquare,
    move, legalMovesFor, restart,
  } = useBookStudySession()

  const viewportWidth = useViewportWidth()
  const isNarrow = viewportWidth != null && viewportWidth < NARROW_BREAKPOINT
  const squareSize = isNarrow
    ? clamp(Math.floor(((viewportWidth ?? NARROW_BREAKPOINT) - 28) / 8), 38, DESKTOP_SQUARE_SIZE)
    : DESKTOP_SQUARE_SIZE
  const boardSize = squareSize * 8


  const centerWidth = boardSize + EVAL_SLOT_WIDTH
  const shellWidth = SECTIONS_WIDTH + centerWidth + PDF_WIDTH + COLUMN_GAP * 2 + OUTER_PADDING * 2
  const frameHeight = Math.max(720, boardSize + 370)

  const chapterItems = current ? flatItems.filter((f) => f.chapterId === current.chapterId) : []
  const chapterStartIndex = current ? flatItems.findIndex((f) => f.chapterId === current.chapterId) : 0
  const analysisMoves = (analysis?.lines ?? []).slice(0, 3).flatMap((line, index) => {
    const uci = line.uciMoves?.[0]
    return uci ? [{ uci, scale: [1, 0.72, 0.48][index] }] : []
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepBack() }
      if (event.key === 'ArrowRight') { event.preventDefault(); stepForward() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [stepBack, stepForward])

  const topWrap: React.CSSProperties = {
    width: isNarrow ? '100%' : shellWidth,
    maxWidth: '100vw',
    margin: '0 auto',
    padding: isNarrow ? '0 14px' : `0 ${OUTER_PADDING}px`,
  }

  if (phase === 'setup') {
    return <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10"><div style={topWrap}><TopBar right={<span />} /></div><BookPicker onStart={loadStart} starting={loading} startError={loadError} /></main>
  }
  if (phase === 'done') {
    return (
      <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10">
        <div style={topWrap}><TopBar right={<span />} /></div>
        <div style={{ width: 'min(480px, calc(100vw - 32px))', margin: '24px auto', background: '#fff', borderRadius: 11, boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: 28, textAlign: 'center' }}>
          <h1 className="serif" style={{ fontSize: 20, fontWeight: 500, marginBottom: 10 }}>Chapter complete</h1>
          <p style={{ fontSize: 13, color: '#7a776f', marginBottom: 20 }}>You&rsquo;ve worked through every position in {book?.title}.</p>
          <button onClick={restart} style={primaryButton}>Choose another book</button>
        </div>
      </main>
    )
  }
  if (!boardState || !book || !current) return <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10"><div style={topWrap}><TopBar right={<span />} /></div></main>

  return (
    <main className="min-h-screen bg-[#e8e8e6] py-6 sm:py-10">
      <div style={{ ...topWrap, background: '#e8e8e6' }}>
        <TopBar right={<span style={{ fontSize: 12, fontWeight: 600, color: '#6a675f', background: '#f0efe9', padding: '6px 13px', borderRadius: 8 }}>{book.title}</span>} />
        <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : `${SECTIONS_WIDTH}px ${centerWidth}px ${PDF_WIDTH}px`, gap: COLUMN_GAP, alignItems: 'stretch' }}>
          <aside style={{ height: isNarrow ? 260 : frameHeight, minHeight: 0, order: isNarrow ? 1 : undefined }}>
            <ChapterSections items={chapterItems} startIndex={chapterStartIndex} activeItemId={current.item.id} completedItemIds={completedItemIds} bookmarkedItemIds={bookmarkedItemIds} busy={busy} onSelect={goToIndex} />
          </aside>

          <section style={{ width: isNarrow ? '100%' : centerWidth, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start', order: isNarrow ? 2 : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: centerWidth, minHeight: 30 }}>
              <strong style={{ fontSize: 14, color: '#37352f' }}>{boardState.turn === 'w' ? 'White' : 'Black'} to move</strong>
              <div style={{ display: 'flex', gap: 7 }}>
                <button onClick={toggleCurrentBookmark} title="Save this section" style={{ ...analysisButton, background: bookmarkedItemIds.has(current.item.id) ? '#fff5df' : '#fff', color: bookmarkedItemIds.has(current.item.id) ? '#a46b15' : '#77746c', borderColor: bookmarkedItemIds.has(current.item.id) ? '#edd9ae' : '#dbe8f4' }}>{bookmarkedItemIds.has(current.item.id) ? '★ Saved' : '☆ Save'}</button>
                <button onClick={markCurrentComplete} disabled={completionBusy || completedItemIds.has(current.item.id)} style={{ ...completeButton, background: completedItemIds.has(current.item.id) ? '#e5f6eb' : '#fff', color: completedItemIds.has(current.item.id) ? '#25864d' : '#427e59', borderColor: completedItemIds.has(current.item.id) ? '#b9e5c8' : '#d6e8dd' }}>
                  {completedItemIds.has(current.item.id) ? '✓ Complete' : completionBusy ? 'Saving…' : 'Mark complete'}
                </button>
                {completionError && <span title={completionError} style={{ color: '#b1453b', fontSize: 11 }}>Not saved</span>}
                <button onClick={toggleAnalysis} title="Toggle engine analysis" style={{ ...analysisButton, background: analysisEnabled ? '#e8f3fd' : '#fff', color: analysisEnabled ? '#2f6db0' : '#77746c' }}>{analysisLoading ? 'Analyzing…' : 'Analysis'}</button>
                <button onClick={toggleFlipped} title="Flip board" style={flipButton}>⇅</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: EVAL_SLOT_WIDTH - 15, alignItems: 'flex-start' }}>
              <Board boardState={boardState} onSquareClick={selectSquare} onMove={move} legalMovesFor={legalMovesFor} squareSize={squareSize} flipped={flipped} analysisMoves={analysisEnabled ? analysisMoves : []} />
              <div style={{ width: 15, opacity: analysisEnabled ? 1 : 0, transition: 'opacity 160ms ease', pointerEvents: 'none' }}>
                <EvalBar score={analysis?.score ?? 0} mate={analysis?.mate ?? 0} height={boardSize} />
              </div>
            </div>
            <div style={{ width: boardSize, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 6 }}><button onClick={stepBack} disabled={!canStepBack} title="Previous move (←)" style={navBtn(canStepBack)}>⟨</button><button onClick={stepForward} disabled={!canStepForward} title="Next move (→)" style={navBtn(canStepForward)}>⟩</button></div>
              <span className="mono" style={{ fontSize: 12, color: '#a3a099' }}>{currentPly > 0 || canStepBack ? `ply ${currentPly}` : ' '}</span>
            </div>
            <div style={{ width: boardSize }}>
              <BookMoveHistory moveTree={boardState.moveTree} currentNodeId={boardState.currentNodeId} busy={busy} onGoto={goToMove} />
            </div>
          </section>

          <aside style={{ height: isNarrow ? 680 : frameHeight, minHeight: 0, order: isNarrow ? 3 : undefined }}>
            <BookPDFViewer key={`${book.id}:${current.chapterId}`} bookId={book.id} chapterId={current.chapterId} sourcePage={sourcePageForItem(book.id, current.item.id, current.item.sourcePage)} />
          </aside>
        </div>
      </div>
    </main>
  )
}

function navBtn(enabled: boolean): React.CSSProperties {
  return { width: 34, height: 30, border: '1px solid #eae8e2', background: '#fff', borderRadius: 6, color: enabled ? '#37352f' : '#d6d3ca', cursor: enabled ? 'pointer' : 'default', fontSize: 14 }
}

const primaryButton: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#4a90d9', color: '#fff', cursor: 'pointer' }
const flipButton: React.CSSProperties = { width: 30, height: 30, border: '1px solid #eae8e2', background: '#fff', borderRadius: 6, color: '#77746c', cursor: 'pointer', fontSize: 16, lineHeight: 1 }
const analysisButton: React.CSSProperties = { height: 30, border: '1px solid #dbe8f4', borderRadius: 6, padding: '0 9px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }
const completeButton: React.CSSProperties = { height: 30, border: '1px solid', borderRadius: 6, padding: '0 9px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { getPdfBook } from '@/lib/api/client'
import { getLastPdfPage, saveLastPdfPage } from '@/lib/books/pdfPosition'

const PAGE_GAP = 10
const MAX_PAGE_WIDTH = 900
const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25
const RENDER_AHEAD = 2
const SAVE_DELAY_MS = 400

interface Props {
  bookId: string
  title: string
}

export default function PdfReader({ bookId, title }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [aspect, setAspect] = useState(1.4)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState('1')
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const pageRef = useRef(1)

  useEffect(() => {
    let active = true
    let loadingTask: PDFDocumentLoadingTask | null = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const data = await getPdfBook(bookId)
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), wasmUrl: '/pdfjs/wasm/' })
        const opened = await loadingTask.promise
        if (!active) return
        const first = await opened.getPage(1)
        const view = first.getViewport({ scale: 1 })
        const start = Math.min(getLastPdfPage(bookId), opened.numPages)
        pageRef.current = start
        setAspect(view.height / view.width)
        setPage(start)
        setDraft(String(start))
        setDoc(opened)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load this book.')
      }
    })()
    return () => {
      active = false
      loadingTask?.destroy()
    }
  }, [bookId])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [doc])

  const pageWidth = Math.max(0, Math.min(width - 16, MAX_PAGE_WIDTH) * zoom)
  const pageHeight = pageWidth * aspect
  const stride = pageHeight + PAGE_GAP
  const strideRef = useRef(stride)
  strideRef.current = stride

  const scrollToPage = useCallback((n: number) => {
    const el = scroller.current
    if (el) el.scrollTop = (n - 1) * strideRef.current
  }, [])

  const restored = useRef(false)
  useEffect(() => {
    if (!doc || pageWidth === 0) return
    scrollToPage(pageRef.current)
    restored.current = true
  }, [doc, pageWidth, scrollToPage])

  useEffect(() => {
    if (!doc) return
    const timer = window.setTimeout(() => saveLastPdfPage(bookId, page), SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [bookId, doc, page])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el || !doc || !restored.current || strideRef.current <= 0) return
    const n = Math.min(doc.numPages, Math.max(1, Math.round(el.scrollTop / strideRef.current) + 1))
    if (n !== pageRef.current) {
      pageRef.current = n
      setPage(n)
      setDraft(String(n))
    }
  }, [doc])

  const goTo = (n: number) => {
    if (!doc) return
    const target = Math.min(doc.numPages, Math.max(1, n))
    pageRef.current = target
    setPage(target)
    setDraft(String(target))
    scrollToPage(target)
  }

  const submitDraft = () => {
    const parsed = Number.parseInt(draft, 10)
    if (Number.isFinite(parsed)) goTo(parsed)
    else setDraft(String(page))
  }

  const total = doc?.numPages ?? 0

  return (
    <section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#e8e8e6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 14px', background: '#fff', borderBottom: '1px solid #efeee9' }}>
        <span style={{ flex: 1, minWidth: 120, fontSize: 13, fontWeight: 600, color: '#37352f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <button type="button" style={buttonStyle} disabled={!doc || page <= 1} onClick={() => goTo(page - 1)} aria-label="Previous page">‹</button>
        <form onSubmit={(event) => { event.preventDefault(); submitDraft() }} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input
            value={draft}
            inputMode="numeric"
            aria-label="Page number"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submitDraft}
            style={{ width: 48, padding: '4px 5px', border: '1px solid #dedbd3', borderRadius: 5, fontSize: 13, textAlign: 'center' }}
          />
          <span style={{ fontSize: 12, color: '#77746c' }}>/ {total || '…'}</span>
        </form>
        <button type="button" style={buttonStyle} disabled={!doc || page >= total} onClick={() => goTo(page + 1)} aria-label="Next page">›</button>
        <button type="button" style={buttonStyle} disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))} aria-label="Zoom out">−</button>
        <button type="button" style={buttonStyle} disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))} aria-label="Zoom in">+</button>
      </div>

      {doc ? (
        <div ref={scroller} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ width: Math.max(pageWidth + 16, 0), margin: '0 auto', padding: '0 8px', boxSizing: 'border-box' }}>
            {Array.from({ length: total }, (_, i) => (
              <PdfPage key={i} doc={doc} number={i + 1} width={pageWidth} height={pageHeight} near={Math.abs(i + 1 - page) <= RENDER_AHEAD} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: '#7a776f', fontSize: 13 }}>
          {error ?? 'Loading book…'}
        </div>
      )}
    </section>
  )
}

function PdfPage({ doc, number, width, height, near }: { doc: PDFDocumentProxy; number: number; width: number; height: number; near: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const target = canvas.current
    if (!near || width === 0 || !target) return
    let task: RenderTask | null = null
    let cancelled = false
    ;(async () => {
      try {
        const p = await doc.getPage(number)
        if (cancelled) return
        const base = p.getViewport({ scale: 1 })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = p.getViewport({ scale: (width / base.width) * ratio })
        target.width = Math.floor(viewport.width)
        target.height = Math.floor(viewport.height)
        const ctx = target.getContext('2d')
        if (!ctx) return
        task = p.render({ canvasContext: ctx, canvas: target, viewport })
        await task.promise
      } catch (err) {
        console.error('pdf render', number, err)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
      target.width = 0
      target.height = 0
    }
  }, [near, doc, number, width])

  return (
    <div style={{ width, height, marginBottom: PAGE_GAP, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
      <canvas ref={canvas} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid #d7e7f6',
  background: '#f2f8fd',
  borderRadius: 6,
  color: '#2f6db0',
  fontSize: 15,
  fontWeight: 600,
  minWidth: 32,
  height: 30,
  cursor: 'pointer',
}

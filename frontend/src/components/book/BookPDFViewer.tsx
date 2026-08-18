'use client'

import { useEffect, useState } from 'react'
import { getBookChapterPDF } from '@/lib/api/client'

interface Props {
  bookId: string
  chapterId: string
  sourcePage?: number
}




export default function BookPDFViewer({ bookId, chapterId, sourcePage }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(sourcePage ?? 1)
  const [draftPage, setDraftPage] = useState(String(sourcePage ?? 1))

  useEffect(() => {
    let active = true
    let objectURL: string | null = null
    getBookChapterPDF(bookId, chapterId)
      .then((pdf) => {
        if (!active) return
        objectURL = URL.createObjectURL(pdf)
        setUrl(objectURL)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load this chapter PDF.')
      })
    return () => {
      active = false
      if (objectURL) URL.revokeObjectURL(objectURL)
    }
  }, [bookId, chapterId])

  useEffect(() => {
    const nextPage = sourcePage ?? 1
    setPage(nextPage)
    setDraftPage(String(nextPage))
  }, [sourcePage])

  const goToPage = () => {
    const parsed = Number.parseInt(draftPage, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      setPage(parsed)
      setDraftPage(String(parsed))
    }
  }

  return (
    <section
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #efeee9', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lbl" style={{ color: '#b4b1a8' }}>Chapter source</div>
          <div style={{ fontSize: 11, color: '#8b887f', marginTop: 3 }}>This chapter only · scroll, zoom, or use Find</div>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); goToPage() }} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <label htmlFor="book-source-page" style={{ fontSize: 11, color: '#77746c' }}>Page</label>
          <input
            id="book-source-page"
            value={draftPage}
            inputMode="numeric"
            onChange={(event) => setDraftPage(event.target.value)}
            style={{ width: 42, padding: '4px 5px', border: '1px solid #dedbd3', borderRadius: 5, fontSize: 12 }}
          />
          <button type="submit" style={goButtonStyle}>Go</button>
        </form>
      </div>

      {url ? (
        <iframe
          key={`${url}#${page}`}
          title="Book chapter PDF"
          src={`${url}#page=${page}&view=FitH`}
          style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', background: '#f4f3ef' }}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: '#7a776f', fontSize: 13 }}>
          {error ? error : 'Loading this chapter PDF…'}
        </div>
      )}
    </section>
  )
}

const goButtonStyle: React.CSSProperties = {
  border: '1px solid #d7e7f6',
  background: '#f2f8fd',
  borderRadius: 5,
  color: '#2f6db0',
  fontSize: 11,
  fontWeight: 600,
  padding: '4px 7px',
  cursor: 'pointer',
}

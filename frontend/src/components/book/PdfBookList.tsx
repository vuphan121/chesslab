'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { listPdfBooks, type PdfBookSummary } from '@/lib/api/client'

export default function PdfBookList() {
  const [books, setBooks] = useState<PdfBookSummary[]>([])

  useEffect(() => {
    listPdfBooks().then(setBooks).catch(() => {})
  }, [])

  if (books.length === 0) return null

  return (
    <div
      style={{
        width: 'min(720px, calc(100vw - 32px))',
        margin: '0 auto 24px',
        background: '#fff',
        borderRadius: 11,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
        padding: 'clamp(16px, 4vw, 28px)',
      }}
    >
      <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
        PDF books
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {books.map((b) => (
          <Link
            key={b.id}
            href={`/book-study/pdf/${encodeURIComponent(b.id)}`}
            style={{ display: 'block', padding: '12px 14px', borderRadius: 8, border: '1px solid #eae8e2', color: 'inherit', textDecoration: 'none' }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>{b.title}</span>
            <span style={{ fontSize: 11, color: '#a3a099', marginLeft: 8 }}>{(b.sizeBytes / 1048576).toFixed(0)} MB · reader only</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

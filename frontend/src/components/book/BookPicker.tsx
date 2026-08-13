'use client'

import { useEffect, useState } from 'react'
import { listBooks } from '@/lib/api/client'
import type { BookSummary } from '@/lib/books/types'

interface Props {
  onStart: (bookId: string, chapterId: string) => void
  starting: boolean
  startError: string | null
}

export default function BookPicker({ onStart, starting, startError }: Props) {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)

  useEffect(() => {
    listBooks()
      .then((list) => {
        setBooks(list)
        if (list.length > 0) {
          setSelectedId(list[0].id)
          setSelectedChapterId(list[0].chapters[0]?.id ?? null)
        }
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to reach the backend.'))
  }, [])

  const selected = books?.find((b) => b.id === selectedId) ?? null

  function selectBook(id: string) {
    setSelectedId(id)
    const book = books?.find((b) => b.id === id)
    setSelectedChapterId(book?.chapters[0]?.id ?? null)
  }

  const panelStyle: React.CSSProperties = {
    width: 'min(720px, calc(100vw - 32px))',
    margin: '24px auto',
    background: '#fff',
    borderRadius: 11,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)',
    padding: 'clamp(16px, 4vw, 28px)',
  }

  if (listError) {
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 14, color: '#37352f', marginBottom: 10 }}>Can&rsquo;t reach the backend.</p>
        <pre className="mono" style={{ fontSize: 12, background: '#fbfaf7', padding: 10, borderRadius: 6 }}>
          cd backend{'\n'}go run ./cmd/server/
        </pre>
      </div>
    )
  }

  if (!books) {
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 13, color: '#a3a099' }}>Loading books…</p>
      </div>
    )
  }

  if (books.length === 0) {
    return (
      <div style={panelStyle}>
        <p style={{ fontSize: 14, color: '#37352f', marginBottom: 10 }}>No books loaded.</p>
        <p style={{ fontSize: 12, color: '#a3a099' }}>
          Drop an extracted book JSON into <code>backend/data/books/</code> (gitignored — see root{' '}
          <code>CLAUDE.md</code>&rsquo;s &ldquo;Study from Book&rdquo; section).
        </p>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <h1 className="serif" style={{ fontSize: 22, fontWeight: 500, marginBottom: 18 }}>
        Study from Book
      </h1>

      <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
        Choose a book
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {books.map((b) => {
          const active = b.id === selectedId
          return (
            <div
              key={b.id}
              onClick={() => selectBook(b.id)}
              style={{
                cursor: 'pointer',
                padding: '12px 14px',
                borderRadius: 8,
                border: active ? '1px solid #4a90d9' : '1px solid #eae8e2',
                background: active ? '#f2f8fd' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{b.title}</span>
                <span style={{ fontSize: 11, color: '#a3a099' }}>{b.itemCount} positions</span>
              </div>
              <div style={{ fontSize: 12, color: '#7a776f', marginTop: 4 }}>{b.author}</div>
            </div>
          )
        })}
      </div>

      {selected && (
        <>
          <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>
            Choose a chapter
          </div>
          <select
            value={selectedChapterId ?? ''}
            onChange={(e) => setSelectedChapterId(e.target.value)}
            style={{
              width: '100%',
              fontSize: 13,
              fontWeight: 500,
              color: '#37352f',
              padding: '10px 12px',
              borderRadius: 7,
              border: '1px solid #eae8e2',
              background: '#fff',
              marginBottom: 22,
              cursor: 'pointer',
              appearance: 'auto',
            }}
          >
            {selected.chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.number}. {ch.name} — {ch.itemCount} item{ch.itemCount === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </>
      )}

      {startError && <p style={{ fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{startError}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => selectedId && selectedChapterId && onStart(selectedId, selectedChapterId)}
          disabled={starting || !selectedId || !selectedChapterId}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: '9px 20px',
            borderRadius: 8,
            border: 'none',
            background: starting ? '#a9c9e8' : '#4a90d9',
            color: '#fff',
            cursor: starting ? 'default' : 'pointer',
          }}
        >
          {starting ? 'Starting…' : 'Start studying'}
        </button>
      </div>
    </div>
  )
}

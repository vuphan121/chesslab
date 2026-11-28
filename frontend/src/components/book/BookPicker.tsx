'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBook, getBookProgress, getWoodpeckerState, listBooks } from '@/lib/api/client'
import type { BookSummary } from '@/lib/books/types'

const WOODPECKER_ID = 'woodpecker'
const OPEN_CATEGORIES_KEY = 'book-picker-open-categories'
const GM_PREFIX = 'Grandmaster Preparation: '
const PUZZLE_BOOKS = 'Puzzle books'
const UNCATEGORIZED = 'Uncategorized'

const CATEGORIES: { name: string; matches: (book: BookSummary) => boolean }[] = [
  { name: 'Yusupov series', matches: (book) => book.author.includes('Yusupov') },
  { name: 'Endgames', matches: (book) => /endgame/i.test(book.title) },
  { name: 'Grandmaster Preparation', matches: (book) => book.title.startsWith('Grandmaster Preparation') },
  { name: 'Mauricio Flores Rios', matches: (book) => book.author.includes('Flores Rios') },
]

interface BookEntry {
  id: string
  title: string
  author: string
}

function groupBooks(books: BookSummary[]) {
  const categoryOf = (book: BookSummary) => CATEGORIES.find((category) => category.matches(book))?.name ?? UNCATEGORIZED
  const grouped = (name: string) => ({
    name,
    books: books
      .filter((book) => categoryOf(book) === name)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((book): BookEntry => ({ id: book.id, title: book.title.replace(GM_PREFIX, ''), author: book.author })),
  })
  return [
    ...CATEGORIES.map((category) => grouped(category.name)),
    { name: PUZZLE_BOOKS, books: [{ id: WOODPECKER_ID, title: 'Woodpecker', author: 'Woodpecker Method' }] },
    grouped(UNCATEGORIZED),
  ].filter((group) => group.books.length > 0)
}

function percentLabel(done: number, total: number) {
  if (total <= 0 || done <= 0) return '0%'
  if (done >= total) return '100%'
  return `${Math.min(99, Math.max(1, Math.round((done / total) * 100)))}%`
}

async function bookPercent(book: BookSummary) {
  const progress = await getBookProgress(book.id)
  if (progress.done.length === 0) return percentLabel(0, book.itemCount)
  const done = new Set(progress.done)
  const items = (await getBook(book.id)).chapters.flatMap((chapter) => chapter.items)
  return percentLabel(items.filter((item) => done.has(item.id)).length, items.length)
}

function readOpenCategories(): string[] | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OPEN_CATEGORIES_KEY) ?? 'null')
    return Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string') : null
  } catch {
    return null
  }
}

interface Props {
  onStart: (bookId: string, chapterId: string) => void
  starting: boolean
  startError: string | null
}

export default function BookPicker({ onStart, starting, startError }: Props) {
  const router = useRouter()
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [completedChapterIds, setCompletedChapterIds] = useState<Set<string>>(() => new Set())
  const [chapterProgress, setChapterProgress] = useState<Record<string, { done: number; total: number }>>({})
  const [percents, setPercents] = useState<Record<string, string>>({})
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    listBooks()
      .then((list) => {
        setBooks(list)
        const firstGroup = groupBooks(list)[0]
        const first = list.find((book) => book.id === firstGroup?.books[0]?.id)
        if (first) {
          setSelectedId(first.id)
          setSelectedChapterId(first.chapters[0]?.id ?? null)
        }
        setOpenCategories(new Set(readOpenCategories() ?? (firstGroup ? [firstGroup.name] : [])))
      })
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to reach the backend.'))
  }, [])

  useEffect(() => {
    if (!books) return
    let cancelled = false
    const store = (id: string, label: string) => {
      if (!cancelled) setPercents((current) => ({ ...current, [id]: label }))
    }
    books.forEach((book) => {
      bookPercent(book).then((label) => store(book.id, label)).catch(() => store(book.id, '—'))
    })
    getWoodpeckerState()
      .then((state) => store(WOODPECKER_ID, percentLabel(state.done, state.total)))
      .catch(() => store(WOODPECKER_ID, '—'))
    return () => { cancelled = true }
  }, [books])

  const selected = books?.find((b) => b.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId || selectedId === WOODPECKER_ID) return
    let cancelled = false
    Promise.all([getBook(selectedId), getBookProgress(selectedId).catch(() => ({ done: [] }))])
      .then(([book, progress]) => {
        if (cancelled) return
        const done = new Set(progress.done)
        setChapterProgress(Object.fromEntries(book.chapters.map((chapter) => [chapter.id, { done: chapter.items.filter((item) => done.has(item.id)).length, total: chapter.items.length }])))
        setCompletedChapterIds(new Set(book.chapters
          .filter((chapter) => chapter.items.length > 0 && chapter.items.every((item) => done.has(item.id)))
          .map((chapter) => chapter.id)))
      })
      .catch(() => { if (!cancelled) { setCompletedChapterIds(new Set()); setChapterProgress({}) } })
    return () => { cancelled = true }
  }, [selectedId])

  function selectBook(id: string) {
    if (id === selectedId) return
    setCompletedChapterIds(new Set())
    setChapterProgress({})
    setSelectedId(id)
    const book = books?.find((b) => b.id === id)
    setSelectedChapterId(book?.chapters[0]?.id ?? null)
  }

  function toggleCategory(name: string) {
    const next = new Set(openCategories)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setOpenCategories(next)
    try {
      localStorage.setItem(OPEN_CATEGORIES_KEY, JSON.stringify([...next]))
    } catch {}
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
          Drop an extracted book JSON into <code>backend/data/books/</code> (gitignored — see{' '}
          <code>docs/study-from-book/data-format.md</code>).
        </p>
      </div>
    )
  }

  const groups = groupBooks(books)
  const selectedEntry = groups.flatMap((group) => group.books).find((entry) => entry.id === selectedId) ?? null
  const startDisabled = starting || !selectedId || (selectedId !== WOODPECKER_ID && !selectedChapterId)

  return (
    <div style={{ width: panelStyle.width, margin: '24px auto' }}>
      <h1 className="serif" style={{ fontSize: 'clamp(24px, 7vw, 32px)', fontWeight: 500, marginBottom: 18 }}>
        Study from Book
      </h1>

      <div className="lbl" style={{ color: '#8a877e', marginBottom: 8 }}>
        Book
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {groups.map((group) => {
          const open = openCategories.has(group.name)
          const hiddenSelection = open ? undefined : group.books.find((entry) => entry.id === selectedId)
          return (
            <section key={group.name} style={cardStyle}>
              <button onClick={() => toggleCategory(group.name)} aria-expanded={open} style={categoryButtonStyle}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{group.name}</span>
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: '#2f6db0', background: '#dfeaf7', padding: '2px 7px', borderRadius: 5 }}>{group.books.length}</span>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 12, color: '#8a877e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hiddenSelection?.title}</span>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, color: '#b4b1a8', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.1s' }}>
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {open && group.books.map((entry) => (
                <BookRow key={entry.id} entry={entry} percent={percents[entry.id] ?? '…'} active={entry.id === selectedId} onSelect={() => selectBook(entry.id)} />
              ))}
            </section>
          )
        })}
      </div>

      {selected && (
        <>
          <div className="lbl" style={{ color: '#8a877e', marginBottom: 8 }}>
            Chapter
          </div>
          <div style={{ ...cardStyle, padding: '0 8px', marginBottom: 20 }}>
            <select
              value={selectedChapterId ?? ''}
              onChange={(e) => setSelectedChapterId(e.target.value)}
              aria-label="Chapter"
              style={{ width: '100%', height: 46, fontSize: 13, fontWeight: 500, color: '#37352f', padding: '0 6px', border: 'none', background: 'transparent', cursor: 'pointer', appearance: 'auto' }}
            >
              {selected.chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {completedChapterIds.has(ch.id) ? '✓ ' : ''}{ch.number}. {ch.name} — {chapterProgress[ch.id]?.done ?? 0}/{chapterProgress[ch.id]?.total ?? ch.itemCount} complete
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {startError && <p style={{ fontSize: 12, color: '#c0392b', marginBottom: 10 }}>{startError}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => {
            if (selectedId === WOODPECKER_ID) router.push('/book-study/woodpecker')
            else if (selectedId && selectedChapterId) onStart(selectedId, selectedChapterId)
          }}
          disabled={startDisabled}
          style={{ ...startButtonStyle, opacity: startDisabled ? 0.55 : 1, cursor: startDisabled ? 'default' : 'pointer' }}
        >
          <span style={{ textAlign: 'left', minWidth: 0 }}>
            {starting ? 'Starting…' : selectedId === WOODPECKER_ID ? 'Open' : 'Start studying'}
            <span style={{ display: 'block', fontSize: 11.5, fontWeight: 400, color: '#b9b6ab', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedEntry?.title}</span>
          </span>
          <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', background: '#4a90d9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}

function BookRow({ entry, percent, active, onSelect }: { entry: BookEntry; percent: string; active: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} aria-pressed={active} style={rowStyle}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: active ? '1.5px solid #4a90d9' : '1.5px solid #cfccc2', background: active ? '#4a90d9' : 'transparent' }}>
        {active && (
          <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, color: '#1c1b18' }}>{entry.title}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: '#8a877e', marginTop: 1 }}>{entry.author}</span>
      </span>
      <span title="Completed" style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: '#6a675f', fontVariantNumeric: 'tabular-nums' }}>{percent}</span>
    </button>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  overflow: 'hidden',
  boxShadow: '0 1px 2px rgba(28,27,24,0.04)',
}

const categoryButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 14px',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  font: 'inherit',
  color: '#1c1b18',
  textAlign: 'left',
}

const rowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  background: '#fbfaf7',
  border: 'none',
  borderTop: '0.5px solid #eeece6',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
}

const startButtonStyle: React.CSSProperties = {
  maxWidth: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 16,
  padding: '8px 8px 8px 20px',
  border: 'none',
  borderRadius: 999,
  background: '#1c1b18',
  color: '#fff',
  fontSize: 14,
  fontWeight: 700,
  boxShadow: '0 10px 22px rgba(28,27,24,0.18)',
}

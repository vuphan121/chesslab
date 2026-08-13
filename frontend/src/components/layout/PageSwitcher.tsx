'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PAGES = [
  { href: '/', label: 'Analysis Board', sub: 'Board, engine, explorer, AI coach' },
  { href: '/opening-study', label: 'Opening Study', sub: 'Drill your repertoire' },
  { href: '/book-study', label: 'Study from Book', sub: 'Work through book chapters' },
]

export default function PageSwitcher() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = PAGES.find((p) => p.href === pathname) ?? PAGES[0]

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12,
          fontWeight: 600,
          color: '#6a675f',
          background: '#f0efe9',
          border: '1px solid #eae8e2',
          padding: '6px 12px',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        {current.label}
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.6 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 220,
            maxWidth: 'calc(100vw - 32px)',
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(0,0,0,0.05)',
            padding: 6,
            zIndex: 50,
          }}
        >
          {PAGES.map((p) => {
            const isCurrent = p.href === pathname
            return (
              <Link
                key={p.href}
                href={p.href}
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: isCurrent ? '#2f6db0' : '#37352f',
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) (e.currentTarget as HTMLElement).style.background = '#f6f5f1'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <span>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: '#a3a099', marginTop: 1 }}>{p.sub}</div>
                </span>
                {isCurrent && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6.5L5 9L9.5 3" stroke="#2f6db0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ICONS: Record<string, ReactNode> = {
  analysis: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 12h18M12 3v18" />
    </>
  ),
  openings: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    </>
  ),
  puzzle: (
    <path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1" />
  ),
  endgames: (
    <>
      <path d="M12 3v4M10 5h4" />
      <path d="M8 21l1-9h6l1 9z" />
      <path d="M9 12c0-3 1.5-5 3-5s3 2 3 5" />
    </>
  ),
  statistics: (
    <>
      <rect x="4" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="12" rx="1" />
      <rect x="16" y="4" width="4" height="16" rx="1" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
}

const PAGES = [
  { href: '/', label: 'Analysis Board', icon: 'analysis' },
  { href: '/opening-study', label: 'Opening Study', icon: 'openings' },
  { href: '/book-study', label: 'Study from Book', icon: 'book' },
  { href: '/puzzles', label: 'Puzzles', icon: 'puzzle' },
  { href: '/endgames', label: 'Endgames', icon: 'endgames' },
  { href: '/statistics', label: 'Statistics', icon: 'statistics' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
]

function PageIcon({ name, size, color }: { name: string; size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {ICONS[name]}
    </svg>
  )
}

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
        <PageIcon name={current.icon} size={15} color="#6a675f" />
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
            minWidth: 210,
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
            const restBackground = isCurrent ? '#f2f8fd' : 'transparent'
            return (
              <Link
                key={p.href}
                href={p.href}
                onClick={(event) => {
                  setOpen(false)
                  if (isCurrent) {
                    event.preventDefault()
                    window.location.assign(p.href)
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  color: isCurrent ? '#2f6db0' : '#37352f',
                  background: restBackground,
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) (e.currentTarget as HTMLElement).style.background = '#f6f5f1'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = restBackground
                }}
              >
                <PageIcon name={p.icon} size={17} color={isCurrent ? '#2f6db0' : '#a3a099'} />
                <span style={{ flex: 1 }}>{p.label}</span>
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

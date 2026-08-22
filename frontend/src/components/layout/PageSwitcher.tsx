'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const PAGES: Array<{ href: string; label: string; dockLabel: string; icon: ReactNode }> = [
  { href: '/', label: 'Analysis Board', dockLabel: 'Board', icon: <path d="M4.5 4.5h15v15h-15zM4.5 9.5h15M9.5 4.5v15M14.5 4.5v15M4.5 14.5h15" /> },
  { href: '/opening-study', label: 'Opening Study', dockLabel: 'Openings', icon: <path d="M5 5.5c2.2-1 4.6-.7 7 1.1v12c-2.4-1.8-4.8-2.1-7-1.1zM19 5.5c-2.2-1-4.6-.7-7 1.1v12c2.4-1.8 4.8-2.1 7-1.1zM12 6.6v12" /> },
  { href: '/book-study', label: 'Study from Book', dockLabel: 'Book Study', icon: <path d="M5 4.5h12.5a1.5 1.5 0 0 1 1.5 1.5v13.5H6.5A1.5 1.5 0 0 1 5 18zM8 8h8M8 11h8M8 14h5" /> },
]

const PROXIMITY = 118

export default function PageSwitcher() {
  const pathname = usePathname()
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const [proximities, setProximities] = useState(() => PAGES.map(() => 0))

  const updateProximity = (pointerX: number) => {
    setProximities(PAGES.map((_, index) => {
      const rect = itemRefs.current[index]?.getBoundingClientRect()
      if (!rect) return 0
      return Math.max(0, 1 - Math.abs(pointerX - (rect.left + rect.width / 2)) / PROXIMITY)
    }))
  }

  return (
    <nav aria-label="Choose workspace" className="top-dock" onMouseMove={(event) => updateProximity(event.clientX)} onMouseLeave={() => setProximities(PAGES.map(() => 0))}>
      {PAGES.map((page, index) => {
        const isCurrent = page.href === pathname
        const proximity = proximities[index]
        const dockStyle = { '--dock-grow': `${proximity * 17}px`, '--dock-drop': `${proximity * 3.5}px` } as CSSProperties

        return (
          <Link key={page.href} ref={(element) => { itemRefs.current[index] = element }} href={page.href} aria-label={page.label} title={page.label} aria-current={isCurrent ? 'page' : undefined} className={`top-dock-item${isCurrent ? ' top-dock-item-active' : ''}`} style={dockStyle}>
            <svg className="top-dock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{page.icon}</svg>
            <span>{page.dockLabel}</span>
          </Link>
        )
      })}

      <style jsx global>{`
        .top-dock { display: flex; align-items: center; gap: 4px; min-height: 42px; padding: 4px; border: 1px solid #dddcd7; border-radius: 13px; background: linear-gradient(180deg, #fff 0%, #f7f7f5 100%); box-shadow: 0 2px 5px rgba(28, 27, 24, 0.11), inset 0 1px 0 #fff; }
        .top-dock-item { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 0 calc(11px + var(--dock-grow)); border: 1px solid transparent; border-radius: 8px; color: #171716; font-family: var(--font-sans), -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; line-height: 1; text-decoration: none; text-transform: uppercase; transform: translateY(var(--dock-drop)); transform-origin: center top; transition: padding 190ms cubic-bezier(.22, 1.28, .45, 1), transform 190ms cubic-bezier(.22, 1.28, .45, 1), color 140ms ease, background 140ms ease, box-shadow 140ms ease; white-space: nowrap; }
        .top-dock-item:hover, .top-dock-item:focus-visible { color: #000; background: #ecece8; outline: none; }
        .top-dock-item:focus-visible { box-shadow: 0 0 0 2px rgba(126, 202, 232, 0.6); }
        .top-dock-item-active { color: #000; border-color: #d8d7d2; background: #e9e9e5; box-shadow: 0 1px 3px rgba(28, 27, 24, 0.13), inset 0 1px 0 #fff; }
        .top-dock-icon { flex: none; }
        @media (max-width: 560px) { .top-dock-item { gap: 6px; padding: 0 calc(8px + var(--dock-grow)); font-size: 10px; letter-spacing: 0.07em; } }
        @media (prefers-reduced-motion: reduce) { .top-dock-item { transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease; transform: none; } }
      `}</style>
    </nav>
  )
}

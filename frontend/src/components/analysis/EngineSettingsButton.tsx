'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { engineLimits, isMobileDevice } from '@/lib/engine/settings'
import type { EngineSettings, SearchLimit } from '@/lib/engine/settings'

interface Props {
  settings: EngineSettings
  onChange: (patch: Partial<EngineSettings>) => void
  onReset: () => void
}

function formatTime(sec: number): string {
  return sec >= 60 ? `${sec / 60} min` : `${sec} s`
}

function Segmented<T extends string | number>({
  options,
  value,
  onSelect,
  label,
}: {
  options: { id: T; label: string }[]
  value: T
  onSelect: (id: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', background: '#f0efe9', borderRadius: 999, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(o.id)}
            style={{
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 999,
              background: on ? '#fff' : 'transparent',
              color: on ? '#2f6db0' : '#6a675f',
              boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="lbl" style={{ color: '#b4b1a8', marginBottom: 8 }}>{title}</div>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: '#a3a099', marginTop: 6, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  )
}

export default function EngineSettingsButton({ settings, onChange, onReset }: Props) {
  const limits = engineLimits(isMobileDevice())
  const limitOptions: { id: SearchLimit; label: string }[] = [
    { id: 'depth', label: 'Depth' },
    { id: 'time', label: 'Time' },
    ...(limits.allowInfinite ? [{ id: 'infinite' as SearchLimit, label: 'Infinite' }] : []),
  ]
  const timeIndex = Math.max(0, limits.timeTicks.indexOf(settings.timeSec))
  const [open, setOpen] = useState(false)
  const [sheetTop, setSheetTop] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    setSheetTop(rect && window.innerWidth < 640 ? rect.bottom + 8 : null)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rangeStyle = { width: '100%', accentColor: '#4a90d9' } as const

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        ref={buttonRef}
        onClick={toggle}
        title="Engine settings"
        aria-label="Engine settings"
        aria-expanded={open}
        style={{
          width: 30,
          height: 30,
          border: '1px solid #eae8e2',
          background: open ? '#eef6fd' : '#fff',
          borderRadius: 6,
          color: open ? '#4a90d9' : '#9a978f',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Engine settings"
          style={{
            position: sheetTop === null ? 'absolute' : 'fixed',
            top: sheetTop === null ? 'calc(100% + 8px)' : sheetTop,
            ...(sheetTop === null ? { right: 0, width: 320 } : { left: 16, right: 16, maxHeight: `calc(100vh - ${sheetTop + 16}px)`, overflowY: 'auto' as const }),
            zIndex: 60,
            background: '#fff',
            borderRadius: 12,
            padding: '16px 18px 14px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.16), inset 0 0 0 1px rgba(0,0,0,0.06)',
            color: '#37352f',
          }}
        >
          <div className="serif" style={{ fontSize: 18, fontWeight: 500 }}>Engine</div>
          <div style={{ fontSize: 12, color: '#a3a099', marginTop: 2 }}>Stockfish 19 Lite, running on this device</div>

          <Section
            title="Search limit"
            hint={
              settings.limit === 'infinite'
                ? 'Keeps thinking until you move or turn the engine off.'
                : settings.limit === 'depth'
                  ? 'Stops once this many moves ahead have been searched.'
                  : 'Stops after this long on each position.'
            }
          >
            <Segmented
              label="Search limit"
              options={limitOptions}
              value={settings.limit}
              onSelect={(limit) => onChange({ limit })}
            />
            {settings.limit === 'depth' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <input
                  type="range"
                  aria-label="Depth"
                  min={limits.depth.min}
                  max={limits.depth.max}
                  value={settings.depth}
                  onChange={(e) => onChange({ depth: Number(e.target.value) })}
                  style={rangeStyle}
                />
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, minWidth: 64, textAlign: 'right' }}>depth {settings.depth}</span>
              </div>
            )}
            {settings.limit === 'time' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <input
                  type="range"
                  aria-label="Seconds per position"
                  min={0}
                  max={limits.timeTicks.length - 1}
                  step={1}
                  value={timeIndex}
                  onChange={(e) => onChange({ timeSec: limits.timeTicks[Number(e.target.value)] })}
                  style={rangeStyle}
                />
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, minWidth: 64, textAlign: 'right' }}>{formatTime(settings.timeSec)}</span>
              </div>
            )}
          </Section>

          <Section title="Arrows" hint="How many suggested moves to draw (and lines to search). The best move is blue. Others are grey, thinner the worse they are, and left out if they are much worse.">
            <Segmented
              label="Arrows"
              options={Array.from({ length: limits.lines.max - limits.lines.min + 1 }, (_, i) => {
                const n = limits.lines.min + i
                return { id: n, label: String(n) }
              })}
              value={settings.lines}
              onSelect={(lines) => onChange({ lines })}
            />
          </Section>

          <Section title="Memory (MB)" hint="More memory helps deep searches. Lower it on a phone.">
            <Segmented
              label="Memory in megabytes"
              options={limits.hashOptions.map((mb) => ({ id: mb, label: String(mb) }))}
              value={settings.hashMb}
              onSelect={(hashMb) => onChange({ hashMb })}
            />
          </Section>

          <Section title="Lichess" hint={settings.limit === 'infinite' ? 'Not used while the limit is infinite.' : undefined}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, lineHeight: 1.4 }}>
              <input
                type="checkbox"
                checked={settings.useCloud}
                onChange={(e) => onChange({ useCloud: e.target.checked })}
                style={{ marginTop: 2, accentColor: '#4a90d9', width: 15, height: 15 }}
              />
              <span>Use Lichess cloud analysis and endgame tablebases when they have the position</span>
            </label>
          </Section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              onClick={onReset}
              style={{ border: 'none', background: 'none', color: '#3974ad', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 4 }}
            >
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

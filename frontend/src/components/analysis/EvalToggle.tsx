'use client'

import { useCallback, useSyncExternalStore } from 'react'

export type EvalDisplay = 'off' | 'eval' | 'eval-moves'

export const EVAL_DISPLAY_CYCLE: EvalDisplay[] = ['off', 'eval', 'eval-moves']

export const EVAL_DISPLAY_LABEL: Record<EvalDisplay, string> = {
  off: 'Eval: Off',
  eval: 'Eval: Bar',
  'eval-moves': 'Eval: Bar + Moves',
}

const listeners = new Set<() => void>()
const memory: Record<string, EvalDisplay> = {}

function isEvalDisplay(value: string | null): value is EvalDisplay {
  return value === 'off' || value === 'eval' || value === 'eval-moves'
}

function read(key: string, fallback: EvalDisplay): EvalDisplay {
  try {
    const stored = localStorage.getItem(key)
    if (isEvalDisplay(stored)) return stored
  } catch {
    return memory[key] ?? fallback
  }
  return fallback
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  window.addEventListener('storage', callback)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', callback)
  }
}

export function useEvalDisplay(storageKey: string, fallback: EvalDisplay): [EvalDisplay, () => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(storageKey, fallback),
    () => fallback,
  )
  const cycle = useCallback(() => {
    const next = EVAL_DISPLAY_CYCLE[(EVAL_DISPLAY_CYCLE.indexOf(value) + 1) % EVAL_DISPLAY_CYCLE.length]
    memory[storageKey] = next
    try {
      localStorage.setItem(storageKey, next)
    } catch {
    }
    listeners.forEach((l) => l())
  }, [storageKey, value])
  return [value, cycle]
}

export function EvalIcon({ state, size = 17 }: { state: EvalDisplay; size?: number }) {
  const on = state !== 'off'
  const color = on ? '#4a90d9' : '#b4b1a8'
  const badge = Math.round(size * 0.53)
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="18" y1="20" x2="18" y2="10" />
      </svg>
      {state === 'eval-moves' && (
        <svg
          width={badge}
          height={badge}
          viewBox="0 0 10 10"
          fill="none"
          style={{ position: 'absolute', top: -3, right: -5 }}
        >
          <path d="M2 8L8 2M8 2H3.5M8 2V6.5" stroke="#4a90d9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

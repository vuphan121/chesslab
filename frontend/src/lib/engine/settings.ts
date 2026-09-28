import { useCallback, useSyncExternalStore } from 'react'

export type SearchLimit = 'depth' | 'time' | 'infinite'

export interface EngineSettings {
  limit: SearchLimit
  depth: number
  timeSec: number
  lines: number
  hashMb: number
  useCloud: boolean
}

const DESKTOP_TIME_TICKS = [2, 4, 6, 8, 10, 12, 15, 20, 30, 60, 120, 300]
const MOBILE_TIME_TICKS = [2, 4, 6, 8, 10, 12, 15, 20, 30]

export interface EngineLimits {
  depth: { min: number; max: number }
  timeTicks: number[]
  lines: { min: number; max: number }
  hashOptions: number[]
  allowInfinite: boolean
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const hint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
  if (typeof hint === 'boolean') return hint
  const ua = navigator.userAgent
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function engineLimits(mobile: boolean): EngineLimits {
  return {
    depth: { min: 8, max: 40 },
    timeTicks: mobile ? MOBILE_TIME_TICKS : DESKTOP_TIME_TICKS,
    lines: { min: 1, max: 5 },
    hashOptions: mobile ? [16, 32, 64] : [16, 32, 64, 128, 256],
    allowInfinite: !mobile,
  }
}

export function engineDefaults(mobile: boolean): EngineSettings {
  return mobile
    ? { limit: 'time', depth: 18, timeSec: 4, lines: 1, hashMb: 16, useCloud: true }
    : { limit: 'time', depth: 20, timeSec: 8, lines: 3, hashMb: 64, useCloud: true }
}

export const DEFAULT_ENGINE_SETTINGS = engineDefaults(false)

const STORAGE_KEY = 'chesslab.analysis.engineSettings'

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function nearest(value: number, options: number[]): number {
  return options.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best), options[0])
}

export function sanitizeSettings(raw: unknown, mobile = false): EngineSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = engineDefaults(mobile)
  const limits = engineLimits(mobile)
  const limit: SearchLimit =
    r.limit === 'depth' || r.limit === 'time' || (r.limit === 'infinite' && limits.allowInfinite) ? r.limit : d.limit
  const time = typeof r.timeSec === 'number' && Number.isFinite(r.timeSec) ? nearest(r.timeSec, limits.timeTicks) : d.timeSec
  const hash = typeof r.hashMb === 'number' ? r.hashMb : d.hashMb
  return {
    limit,
    depth: clampInt(r.depth, limits.depth.min, limits.depth.max, d.depth),
    timeSec: time,
    lines: clampInt(r.lines, limits.lines.min, limits.lines.max, d.lines),
    hashMb: limits.hashOptions.includes(hash) ? hash : nearest(hash, limits.hashOptions),
    useCloud: typeof r.useCloud === 'boolean' ? r.useCloud : d.useCloud,
  }
}

export function settingsSignature(s: EngineSettings): string {
  const limitValue = s.limit === 'depth' ? s.depth : s.limit === 'time' ? s.timeSec : 0
  return [s.limit, limitValue, s.lines, s.hashMb, s.useCloud ? 1 : 0].join('|')
}

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedValue: EngineSettings = DEFAULT_ENGINE_SETTINGS
let memoryRaw: string | null = null
let mobileMemo: boolean | null = null

function mobile(): boolean {
  if (mobileMemo === null) mobileMemo = isMobileDevice()
  return mobileMemo
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return memoryRaw
  }
}

function getSnapshot(): EngineSettings {
  const raw = readRaw()
  if (raw === cachedRaw) return cachedValue
  cachedRaw = raw
  try {
    cachedValue = sanitizeSettings(raw ? JSON.parse(raw) : null, mobile())
  } catch {
    cachedValue = engineDefaults(mobile())
  }
  return cachedValue
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  window.addEventListener('storage', callback)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', callback)
  }
}

export function useEngineSettings(): [EngineSettings, (patch: Partial<EngineSettings>) => void, () => void] {
  const settings = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_ENGINE_SETTINGS)
  const write = useCallback((next: EngineSettings) => {
    const raw = JSON.stringify(next)
    memoryRaw = raw
    try {
      localStorage.setItem(STORAGE_KEY, raw)
    } catch {
    }
    listeners.forEach((l) => l())
  }, [])
  const update = useCallback(
    (patch: Partial<EngineSettings>) => write(sanitizeSettings({ ...getSnapshot(), ...patch }, mobile())),
    [write],
  )
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
    }
    memoryRaw = null
    listeners.forEach((l) => l())
  }, [])
  return [settings, update, reset]
}

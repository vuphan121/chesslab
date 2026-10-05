'use client'

import { useEffect, useState } from 'react'
import { refreshAppShell } from '@/lib/offline/refresh'

const CHECK_EVERY_MS = 60000
const RELOAD_GUARD_KEY = 'chesslab-update-reload'

function reload(build: string) {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === build) return
    sessionStorage.setItem(RELOAD_GUARD_KEY, build)
  } catch {
  }
  window.location.reload()
}

export default function UpdateWatcher({ authed }: { authed: boolean }) {
  const [readyBuild, setReadyBuild] = useState<string | null>(null)

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    const current = process.env.NEXT_PUBLIC_BUILD_ID
    let busy = false
    let found = false
    let stopped = false

    const check = async () => {
      if (busy || found || stopped || document.visibilityState !== 'visible' || !navigator.onLine) return
      busy = true
      try {
        const res = await fetch('/api/build', { cache: 'no-store' })
        if (!res.ok) return
        const latest = (await res.json())?.build
        if (typeof latest !== 'string' || latest === 'unknown' || latest === current) return
        if (await refreshAppShell()) {
          found = true
          setReadyBuild(latest)
        }
      } catch {
      } finally {
        busy = false
      }
    }

    void check()
    const timer = setInterval(check, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [])

  useEffect(() => {
    if (readyBuild && !authed) reload(readyBuild)
  }, [readyBuild, authed])

  if (!readyBuild || !authed) return null
  return (
    <button
      type="button"
      onClick={() => reload(readyBuild)}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        zIndex: 60,
        boxShadow: '0 4px 14px rgba(28,27,24,0.2)',
        fontSize: 13,
        fontWeight: 600,
        color: '#fff',
        background: '#2b2a27',
        padding: '9px 16px',
        borderRadius: 999,
        border: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      New version ready · Update
    </button>
  )
}

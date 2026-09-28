'use client'

import { useEffect } from 'react'
import { flushProgressOutbox, pingBackend } from '@/lib/api/client'

const REVALIDATE_EVERY_MS = 30 * 60 * 1000

export default function OfflineSync() {
  useEffect(() => {
    const flush = () => {
      void flushProgressOutbox()
    }
    let lastRevalidate = Date.now()
    const revalidateShell = () => {
      lastRevalidate = Date.now()
      navigator.serviceWorker?.controller?.postMessage({ type: 'REVALIDATE', url: location.href })
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      pingBackend()
      flush()
      if (Date.now() - lastRevalidate > REVALIDATE_EVERY_MS) revalidateShell()
    }
    flush()
    revalidateShell()
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}

'use client'

import { useEffect } from 'react'
import { checkBackendHealth, flushProgressOutbox, flushPuzzleResultOutbox, flushTodayTrainingOutbox, listRepertoires, pingBackend, prefetchTodayTrainingSnapshot } from '@/lib/api/client'
import { isMobileOfflineDevice, prefetchRepertoires } from '@/lib/offline/prefetch'
import { watchBackendReady } from '@/lib/puzzle/backendWatch'
import { puzzlePoolNeedsRefill, refillPuzzlePool } from '@/lib/puzzle/poolManager'

const REVALIDATE_EVERY_MS = 30 * 60 * 1000

export default function OfflineSync() {
  useEffect(() => {
    let stopPuzzleWatch: (() => void) | null = null
    const syncPuzzles = () => {
      if (!isMobileOfflineDevice()) return
      const run = () => {
        void flushPuzzleResultOutbox()
        void puzzlePoolNeedsRefill().then((needed) => {
          if (needed) void refillPuzzlePool()
        })
      }
      void checkBackendHealth().then((ok) => {
        if (ok) {
          run()
          return
        }
        if (stopPuzzleWatch) return
        stopPuzzleWatch = watchBackendReady(
          () => {
            stopPuzzleWatch = null
            run()
          },
          { ping: checkBackendHealth, canPing: () => document.visibilityState === 'visible' && navigator.onLine },
        )
      })
    }
    const flush = () => {
      syncPuzzles()
      void flushProgressOutbox()
      void flushTodayTrainingOutbox()
      if (isMobileOfflineDevice()) {
        void listRepertoires()
          .then(async (list) => {
            await Promise.all([
              prefetchRepertoires(list, { force: true }),
              flushTodayTrainingOutbox().then(() => prefetchTodayTrainingSnapshot()),
            ])
          })
          .catch(() => {})
      }
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
      stopPuzzleWatch?.()
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}

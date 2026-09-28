'use client'

import { useEffect } from 'react'
import { flushProgressOutbox } from '@/lib/api/client'

export default function OfflineSync() {
  useEffect(() => {
    const flush = () => {
      void flushProgressOutbox()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush()
    }
    flush()
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}

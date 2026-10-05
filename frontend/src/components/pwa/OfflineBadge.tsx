'use client'

import { useEffect, useState } from 'react'
import { useIsPhoneLike } from '@/hooks/useViewportWidth'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { outboxCount, subscribeOutbox } from '@/lib/offline/cache'

export default function OfflineBadge() {
  const online = useOnlineStatus()
  const phone = useIsPhoneLike().compact
  const [pending, setPending] = useState(0)

  useEffect(() => {
    let active = true
    const refresh = () => {
      outboxCount().then((n) => {
        if (active) setPending(n)
      })
    }
    refresh()
    const unsubscribe = subscribeOutbox(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (pending === 0) return null
  const label = `${pending} run${pending === 1 ? '' : 's'} to sync`
  return (
    <span
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        ...(phone
          ? { top: 'calc(env(safe-area-inset-top) + 58px)' }
          : { bottom: 'max(12px, env(safe-area-inset-bottom))' }),
        transform: 'translateX(-50%)',
        zIndex: 40,
        pointerEvents: 'none',
        boxShadow: '0 4px 14px rgba(28,27,24,0.14)',
        fontSize: 12,
        fontWeight: 600,
        color: online ? '#3974ad' : '#8a6a1f',
        background: online ? '#ecf3fb' : '#fbf3dc',
        padding: '7px 14px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

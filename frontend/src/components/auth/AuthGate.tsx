'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { getToken, onAuthChange } from '@/lib/auth/token'
import { pingBackend } from '@/lib/api/client'
import { prepareSound } from '@/lib/sound'
import Login from './Login'
import UserSettingsProvider from '@/components/settings/UserSettingsProvider'
import OfflineSync from '@/components/pwa/OfflineSync'
import OfflineBadge from '@/components/pwa/OfflineBadge'
import UpdateWatcher from '@/components/pwa/UpdateWatcher'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    pingBackend()
    prepareSound()
    const syncAuth = () => {
      const authenticated = !!getToken()
      setAuthed(authenticated)
    }
    syncAuth()
    return onAuthChange(syncAuth)
  }, [])

  if (authed === null) return null
  if (!authed) {
    return (
      <>
        <UpdateWatcher authed={false} />
        <Login />
      </>
    )
  }
  return (
    <UserSettingsProvider>
      <UpdateWatcher authed />
      <OfflineSync />
      <OfflineBadge />
      {children}
    </UserSettingsProvider>
  )
}

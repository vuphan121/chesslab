'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { getToken, onAuthChange } from '@/lib/auth/token'
import { getTodayTraining, pingBackend } from '@/lib/api/client'
import Login from './Login'








export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    pingBackend()
    const syncAuth = () => {
      const authenticated = !!getToken()
      setAuthed(authenticated)
      if (authenticated) getTodayTraining().catch(() => {})
    }
    syncAuth()
    return onAuthChange(syncAuth)
  }, [])

  if (authed === null) return null
  if (!authed) return <Login />
  return <>{children}</>
}

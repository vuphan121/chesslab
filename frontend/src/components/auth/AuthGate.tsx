'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { getToken, onAuthChange } from '@/lib/auth/token'
import { pingBackend } from '@/lib/api/client'
import Login from './Login'








export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    pingBackend()
    setAuthed(!!getToken())
    return onAuthChange(() => setAuthed(!!getToken()))
  }, [])

  if (authed === null) return null
  if (!authed) return <Login />
  return <>{children}</>
}

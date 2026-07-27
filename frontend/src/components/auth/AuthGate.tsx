'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { getToken, onAuthChange } from '@/lib/auth/token'
import Login from './Login'

// Gates the entire app behind the login screen (both pages — this wraps
// layout.tsx, not a per-page check). Checks localStorage on mount rather
// than during render, so the server-rendered/first-paint markup is
// consistent regardless of auth state (no hydration mismatch), and
// re-checks whenever token.ts's onAuthChange fires — a successful login, an
// explicit logout, or client.ts clearing the token after a 401 from the
// backend (expired/invalid session).
export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    setAuthed(!!getToken())
    return onAuthChange(() => setAuthed(!!getToken()))
  }, [])

  if (authed === null) return null // avoid a flash of the login screen before the check runs
  if (!authed) return <Login />
  return <>{children}</>
}

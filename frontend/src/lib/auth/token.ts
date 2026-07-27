// localStorage-backed auth token + a tiny change-notification mechanism so
// AuthGate can react to a login/logout (or client.ts reacting to a 401 —
// see its request() helper) without a page reload.
'use client'

const STORAGE_KEY = 'chesslab.auth.token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

export function setToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token)
  notifyChange()
}

export function clearToken(): void {
  window.localStorage.removeItem(STORAGE_KEY)
  notifyChange()
}

type Listener = () => void
const listeners = new Set<Listener>()

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyChange(): void {
  for (const l of listeners) l()
}

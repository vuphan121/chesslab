


'use client'

const STORAGE_KEY = 'chesslab.auth.token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem(STORAGE_KEY) === token) return
  window.localStorage.setItem(STORAGE_KEY, token)
  notifyChange()
}

export function clearToken(): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem(STORAGE_KEY) === null) return
  window.localStorage.removeItem(STORAGE_KEY)
  notifyChange()
}

type Listener = () => void
const listeners = new Set<Listener>()

export function onAuthChange(listener: Listener): () => void {
  ensureStorageListener()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let storageListenerInstalled = false

function ensureStorageListener(): void {
  if (storageListenerInstalled || typeof window === 'undefined') return
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) notifyChange()
  })
  storageListenerInstalled = true
}

function notifyChange(): void {
  for (const l of listeners) l()
}

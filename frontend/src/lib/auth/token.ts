

'use client'

const STORAGE_KEY = 'chesslab.auth.token'

let memoryToken: string | null = null

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return memoryToken
  }
}

function writeStored(token: string | null): void {
  memoryToken = token
  try {
    if (token === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, token)
  } catch {}
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return readStored()
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return
  if (readStored() === token) return
  writeStored(token)
  notifyChange()
}

export function clearToken(): void {
  if (typeof window === 'undefined') return
  if (readStored() === null) return
  writeStored(null)
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

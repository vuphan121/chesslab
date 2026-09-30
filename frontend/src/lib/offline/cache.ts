import { idbClear, idbDelete, idbGet, idbList, idbSet } from './idb'
import { isRetryable } from './errors'

const OWNER_KEY = 'chesslab.offline.owner'
const OUTBOX_PREFIX = 'outbox:'
const inflight = new Map<string, Promise<unknown>>()
const cacheRevisions = new Map<string, number>()

function cacheRevision(key: string): number {
  return cacheRevisions.get(key) ?? 0
}

function advanceCacheRevision(key: string): number {
  const next = cacheRevision(key) + 1
  cacheRevisions.set(key, next)
  return next
}

function invalidateAllCacheRequests(): void {
  const keys = new Set([...cacheRevisions.keys(), ...inflight.keys()])
  for (const key of keys) advanceCacheRevision(key)
  inflight.clear()
}

interface Cached<T> {
  value: T
  at: number
}

export async function readCache<T>(key: string): Promise<Cached<T> | undefined> {
  return idbGet<Cached<T>>(`cache:${key}`)
}

export async function writeCache<T>(key: string, value: T): Promise<boolean> {
  advanceCacheRevision(key)
  return idbSet(`cache:${key}`, { value, at: Date.now() } satisfies Cached<T>)
}

export async function deleteCache(key: string): Promise<void> {
  advanceCacheRevision(key)
  await idbDelete(`cache:${key}`)
}

export async function cacheAgeMs(key: string): Promise<number | null> {
  const hit = await readCache<unknown>(key)
  return hit ? Date.now() - hit.at : null
}

export async function networkFirst<T>(key: string, fetcher: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const net = revalidate(key, fetcher)
  net.catch(() => {})
  const cached = await readCache<T>(key)
  if (!cached) return net
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  try {
    const result = await Promise.race([net, timeout])
    if (result === 'timeout') {
      if (inflight.get(key) === net) inflight.delete(key)
      return cached.value
    }
    return result
  } catch (err) {
    if (isRetryable(err)) return cached.value
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const REVALIDATE_MIN_AGE_MS = 30_000

export interface CacheFirstOptions<T> {
  onUpdate?: (value: T) => void
}

function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const revision = advanceCacheRevision(key)
  const p = fetcher()
    .then(async (value) => {
      if (cacheRevision(key) === revision) {
        await idbSet(`cache:${key}`, { value, at: Date.now() } satisfies Cached<T>)
      }
      return value
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key)
    })
  inflight.set(key, p)
  return p
}

export async function cacheFirst<T>(key: string, fetcher: () => Promise<T>, opts: CacheFirstOptions<T> = {}): Promise<T> {
  const cached = await readCache<T>(key)
  if (!cached) return revalidate(key, fetcher)
  if (Date.now() - cached.at >= REVALIDATE_MIN_AGE_MS) {
    revalidate(key, fetcher)
      .then((value) => {
        if (opts.onUpdate && JSON.stringify(value) !== JSON.stringify(cached.value)) opts.onUpdate(value)
      })
      .catch(() => {})
  }
  return cached.value
}

export const refreshCache = revalidate

export async function dropCachedRepertoiresExcept(keepIds: Set<string>): Promise<void> {
  const prefix = 'cache:repertoire:'
  for (const { key } of await idbList<unknown>(prefix)) {
    if (!keepIds.has(key.slice(prefix.length))) await deleteCache(key.slice('cache:'.length))
  }
}

export interface OutboxItem<T = unknown> {
  id: string
  queuedAt: number
  payload: T
}

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyOutbox(): void {
  for (const l of listeners) l()
}

export async function enqueue<T>(payload: T): Promise<boolean> {
  const queuedAt = Date.now()
  const id = `${OUTBOX_PREFIX}${String(queuedAt).padStart(15, '0')}-${crypto.randomUUID()}`
  const ok = await idbSet(id, { id, queuedAt, payload } satisfies OutboxItem<T>)
  if (ok) notifyOutbox()
  return ok
}

export async function listOutbox<T>(): Promise<OutboxItem<T>[]> {
  const rows = await idbList<OutboxItem<T>>(OUTBOX_PREFIX)
  return rows.map((r) => r.value)
}

export async function removeOutboxItem(id: string): Promise<void> {
  await idbDelete(id)
  notifyOutbox()
}

export async function outboxCount(): Promise<number> {
  return (await idbList(OUTBOX_PREFIX)).length
}

export async function claimOfflineStore(username: string): Promise<boolean> {
  try {
    const owner = window.localStorage.getItem(OWNER_KEY)
    if (owner === username) return true
    const cleared = await idbClear()
    if (!cleared) return false
    invalidateAllCacheRequests()
    window.localStorage.setItem(OWNER_KEY, username)
    notifyOutbox()
    return true
  } catch {
    return false
  }
}

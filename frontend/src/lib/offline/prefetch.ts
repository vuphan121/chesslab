import { getProgress, getRepertoire } from '@/lib/api/client'
import { cacheAgeMs } from './cache'
import type { RepertoireSummary } from '@/lib/trainer/types'

const FRESH_MS = 24 * 60 * 60 * 1000
const PHONE_MEDIA = '(max-width: 639px)'

interface NetworkInformationLike {
  saveData?: boolean
}

const pending = new Map<string, RepertoireSummary>()
const scheduled = new Set<string>()
let running: Promise<void> | null = null

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const requestIdle = (window as Window & { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback
    if (requestIdle) {
      requestIdle.call(window, () => resolve(), { timeout: 750 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

export function isMobileOfflineDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_MEDIA).matches
}

async function drainPrefetchQueue(): Promise<void> {
  while (pending.size > 0) {
    if (!navigator.onLine) return
    const next = pending.entries().next().value as [string, RepertoireSummary] | undefined
    if (!next) return
    const [id, rep] = next
    pending.delete(id)
    await yieldToBrowser()
    const age = await cacheAgeMs(`repertoire:${rep.id}`)
    if (age === null || age >= FRESH_MS) {
      try {
        await getRepertoire(rep.id)
      } catch {
        return
      }
    }
    await getProgress(rep.id).catch(() => {})
  }
}

export function prefetchRepertoires(list: RepertoireSummary[], opts: { force?: boolean } = {}): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return Promise.resolve()
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  if (connection?.saveData && !opts.force) return Promise.resolve()
  for (const rep of list) {
    if (scheduled.has(rep.id)) continue
    scheduled.add(rep.id)
    pending.set(rep.id, rep)
  }
  if (!running) {
    running = drainPrefetchQueue().finally(() => {
      pending.clear()
      scheduled.clear()
      running = null
    })
  }
  return running
}

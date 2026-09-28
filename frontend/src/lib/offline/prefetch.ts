import { getRepertoire } from '@/lib/api/client'
import { cacheAgeMs } from './cache'
import type { RepertoireSummary } from '@/lib/trainer/types'

const FRESH_MS = 24 * 60 * 60 * 1000

interface NetworkInformationLike {
  saveData?: boolean
}

export async function prefetchRepertoires(list: RepertoireSummary[]): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  if (connection?.saveData) return
  for (const rep of list) {
    const age = await cacheAgeMs(`repertoire:${rep.id}`)
    if (age !== null && age < FRESH_MS) continue
    try {
      await getRepertoire(rep.id)
    } catch {
      return
    }
  }
}

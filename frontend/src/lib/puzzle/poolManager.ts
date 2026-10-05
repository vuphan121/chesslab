import { nextPuzzles } from '@/lib/api/client'
import { isMobileOfflineDevice } from '@/lib/offline/device'
import { PuzzlePool, POOL_BATCH } from './pool'
import { idbPoolStore } from './poolStore'

let pool: PuzzlePool | null = null

export function getPuzzlePool(): PuzzlePool | null {
  if (!isMobileOfflineDevice()) return null
  if (!pool) pool = new PuzzlePool(idbPoolStore)
  return pool
}

export async function refillPuzzlePool(): Promise<number> {
  const current = getPuzzlePool()
  if (!current) return 0
  return current.refill((exclude) => nextPuzzles(null, { count: POOL_BATCH, exclude, timeoutMs: 20000 }))
}

export async function puzzlePoolNeedsRefill(): Promise<boolean> {
  const current = getPuzzlePool()
  return !!current && (await current.needsRefill())
}

import { readCache, writeCache } from '@/lib/offline/cache'
import type { PoolState, PoolStore } from './pool'

const POOL_CACHE_KEY = 'puzzle-pool'

export const idbPoolStore: PoolStore = {
  async read() {
    return (await readCache<PoolState>(POOL_CACHE_KEY))?.value
  },
  async write(state) {
    await writeCache(POOL_CACHE_KEY, state)
  },
}

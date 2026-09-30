import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()
let clearSucceeds = true

vi.mock('./idb', () => ({
  idbGet: async (key: string) => store.get(key),
  idbSet: async (key: string, value: unknown) => {
    store.set(key, value)
    return true
  },
  idbDelete: async (key: string) => {
    store.delete(key)
  },
  idbList: async (prefix: string) =>
    [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
  idbClear: async () => {
    if (!clearSucceeds) return false
    store.clear()
    return true
  },
}))

import { ApiError } from './errors'
import { cacheAgeMs, cacheFirst, claimOfflineStore, dropCachedRepertoiresExcept, networkFirst, readCache, writeCache } from './cache'

beforeEach(() => {
  store.clear()
  clearSucceeds = true
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function seedOld<T>(key: string, value: T) {
  store.set(`cache:${key}`, { value, at: Date.now() - 10 * 60 * 1000 })
}

describe('cacheFirst', () => {
  it('waits for the network when nothing is cached, and stores the result', async () => {
    const value = await cacheFirst('k', async () => 'fresh')
    expect(value).toBe('fresh')
    expect((await readCache<string>('k'))?.value).toBe('fresh')
  })

  it('returns the cached value immediately without waiting for a slow server', async () => {
    await seedOld('k', 'old')
    const slow = deferred<string>()
    const value = await cacheFirst('k', () => slow.promise)
    expect(value).toBe('old')
    slow.resolve('new')
    await vi.waitFor(async () => expect((await readCache<string>('k'))?.value).toBe('new'))
  })

  it('calls onUpdate only when the refreshed value differs', async () => {
    await seedOld('same', { a: 1 })
    const onSame = vi.fn()
    await cacheFirst('same', async () => ({ a: 1 }), { onUpdate: onSame })
    await vi.waitFor(async () => expect((await cacheAgeMs('same')) ?? 1e9).toBeLessThan(5000))
    expect(onSame).not.toHaveBeenCalled()

    await seedOld('diff', { a: 1 })
    const onDiff = vi.fn()
    await cacheFirst('diff', async () => ({ a: 2 }), { onUpdate: onDiff })
    await vi.waitFor(() => expect(onDiff).toHaveBeenCalledWith({ a: 2 }))
  })

  it('does not hit the network again when the cache is only seconds old', async () => {
    await writeCache('k', 'cached')
    const fetcher = vi.fn(async () => 'new')
    expect(await cacheFirst('k', fetcher)).toBe('cached')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps serving the cache when the background refresh fails', async () => {
    await seedOld('k', 'old')
    const value = await cacheFirst('k', async () => {
      throw new TypeError('offline')
    })
    expect(value).toBe('old')
    await new Promise((r) => setTimeout(r, 10))
    expect((await readCache<string>('k'))?.value).toBe('old')
  })

  it('shares one request between concurrent callers', async () => {
    await seedOld('k', 'old')
    const fetcher = vi.fn(async () => 'new')
    await Promise.all([cacheFirst('k', fetcher), cacheFirst('k', fetcher)])
    await vi.waitFor(async () => expect((await readCache<string>('k'))?.value).toBe('new'))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('networkFirst', () => {
  it('uses the cache when the server takes longer than the timeout', async () => {
    vi.useFakeTimers()
    await writeCache('k', 'cached')
    const slow = deferred<string>()
    const pending = networkFirst('k', () => slow.promise, 1500)
    await vi.advanceTimersByTimeAsync(1600)
    expect(await pending).toBe('cached')
  })

  it('returns fresh data when the server answers in time', async () => {
    await writeCache('k', 'cached')
    expect(await networkFirst('k', async () => 'fresh', 1500)).toBe('fresh')
  })

  it('shares one network request between concurrent callers', async () => {
    const slow = deferred<string>()
    const fetcher = vi.fn(() => slow.promise)
    const first = networkFirst('shared', fetcher, 1500)
    const second = networkFirst('shared', fetcher, 1500)
    slow.resolve('fresh')
    await expect(Promise.all([first, second])).resolves.toEqual(['fresh', 'fresh'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('falls back to the cache on a network error and on a gateway error', async () => {
    await writeCache('k', 'cached')
    expect(await networkFirst('k', async () => Promise.reject(new TypeError('offline')))).toBe('cached')
    expect(await networkFirst('k', async () => Promise.reject(new ApiError('bad gateway', 502)))).toBe('cached')
  })

  it('does not hide a real client error behind the cache', async () => {
    await writeCache('k', 'cached')
    await expect(networkFirst('k', async () => Promise.reject(new ApiError('nope', 404)))).rejects.toThrow('nope')
  })
})

describe('dropCachedRepertoiresExcept', () => {
  it('removes cached repertoires that no longer exist but keeps the list and the rest', async () => {
    await writeCache('repertoires', ['a', 'b'])
    await writeCache('repertoire:a', 1)
    await writeCache('repertoire:gone', 2)
    await writeCache('progress:gone', 3)
    await dropCachedRepertoiresExcept(new Set(['a']))
    expect(await readCache('repertoire:a')).toBeDefined()
    expect(await readCache('repertoire:gone')).toBeUndefined()
    expect(await readCache('repertoires')).toBeDefined()
    expect(await readCache('progress:gone')).toBeDefined()
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('claimOfflineStore', () => {
  it('does not transfer cache ownership when clearing IndexedDB fails', async () => {
    const local = new Map<string, string>([['chesslab.offline.owner', 'alice']])
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => local.get(key) ?? null,
        setItem: (key: string, value: string) => local.set(key, value),
      },
    })
    await writeCache('progress:private', { cards: { secret: true } })
    clearSucceeds = false
    await claimOfflineStore('bob')
    expect(local.get('chesslab.offline.owner')).toBe('alice')
    expect(await readCache('progress:private')).toBeDefined()
  })
})

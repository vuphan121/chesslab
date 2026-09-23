import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearToken, onAuthChange, setToken } from './token'

describe('auth token notifications', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('syncs other tabs and suppresses duplicate local notifications', () => {
    const values = new Map<string, string>()
    const storageHandlers: Array<(event: StorageEvent) => void> = []
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
    vi.stubGlobal('window', {
      localStorage,
      addEventListener: (type: string, handler: (event: StorageEvent) => void) => {
        if (type === 'storage') storageHandlers.push(handler)
      },
    })

    const listener = vi.fn()
    const unsubscribe = onAuthChange(listener)

    setToken('token-a')
    setToken('token-a')
    expect(listener).toHaveBeenCalledTimes(1)

    storageHandlers[0]({ key: 'chesslab.auth.token' } as StorageEvent)
    expect(listener).toHaveBeenCalledTimes(2)

    clearToken()
    clearToken()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WATCH_FAST_MS, WATCH_FAST_WINDOW_MS, WATCH_SLOW_MS, watchBackendReady } from './backendWatch'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('watchBackendReady', () => {
  it('pings right away and calls back as soon as the backend answers', async () => {
    const ping = vi.fn().mockResolvedValue(true)
    const onReady = vi.fn()
    watchBackendReady(onReady, { ping })
    await flush()
    expect(ping).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ping).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('keeps polling every 3 seconds while the backend is cold, then calls back once', async () => {
    let up = false
    const ping = vi.fn(async () => up)
    const onReady = vi.fn()
    watchBackendReady(onReady, { ping })
    await flush()
    expect(ping).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(WATCH_FAST_MS)
    expect(ping).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(WATCH_FAST_MS * 3)
    expect(ping).toHaveBeenCalledTimes(5)
    expect(onReady).not.toHaveBeenCalled()
    up = true
    await vi.advanceTimersByTimeAsync(WATCH_FAST_MS)
    expect(onReady).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(ping).toHaveBeenCalledTimes(6)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('slows down to every 15 seconds after the first 90 seconds', async () => {
    const ping = vi.fn(async () => false)
    watchBackendReady(vi.fn(), { ping })
    await vi.advanceTimersByTimeAsync(WATCH_FAST_WINDOW_MS)
    const fastCount = ping.mock.calls.length
    expect(fastCount).toBe(WATCH_FAST_WINDOW_MS / WATCH_FAST_MS + 1)
    await vi.advanceTimersByTimeAsync(WATCH_SLOW_MS * 4)
    expect(ping.mock.calls.length - fastCount).toBe(4)
  })

  it('treats a rejected ping as not ready and tries again', async () => {
    const ping = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(true)
    const onReady = vi.fn()
    watchBackendReady(onReady, { ping })
    await flush()
    expect(onReady).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(WATCH_FAST_MS)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('does not ping while the tab is hidden or the phone is offline', async () => {
    let allowed = false
    const ping = vi.fn(async () => true)
    const onReady = vi.fn()
    watchBackendReady(onReady, { ping, canPing: () => allowed })
    await vi.advanceTimersByTimeAsync(WATCH_FAST_MS * 5)
    expect(ping).not.toHaveBeenCalled()
    allowed = true
    await vi.advanceTimersByTimeAsync(WATCH_FAST_MS)
    expect(ping).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('stopping cancels the next ping and any late answer', async () => {
    let resolvePing: (ok: boolean) => void = () => {}
    const ping = vi.fn(() => new Promise<boolean>((resolve) => (resolvePing = resolve)))
    const onReady = vi.fn()
    const stop = watchBackendReady(onReady, { ping })
    await flush()
    stop()
    resolvePing(true)
    await flush()
    expect(onReady).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('stopping while waiting for the next tick prevents it', async () => {
    const ping = vi.fn(async () => false)
    const stop = watchBackendReady(vi.fn(), { ping })
    await flush()
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('never has two pings in flight at the same time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const ping = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10_000))
      inFlight--
      return false
    })
    watchBackendReady(vi.fn(), { ping })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(maxInFlight).toBe(1)
  })
})

export const WATCH_FAST_MS = 3000
export const WATCH_FAST_WINDOW_MS = 90000
export const WATCH_SLOW_MS = 15000

export interface WatchDeps {
  ping: () => Promise<boolean>
  canPing?: () => boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function watchBackendReady(onReady: () => void, deps: WatchDeps): () => void {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const startedAt = now()
  let stopped = false
  let handle: unknown = null

  const schedule = () => {
    if (stopped) return
    const delay = now() - startedAt < WATCH_FAST_WINDOW_MS ? WATCH_FAST_MS : WATCH_SLOW_MS
    handle = setTimer(tick, delay)
  }

  const tick = () => {
    handle = null
    if (stopped) return
    if (deps.canPing && !deps.canPing()) {
      schedule()
      return
    }
    deps
      .ping()
      .then((ok) => {
        if (stopped) return
        if (ok) {
          stopped = true
          onReady()
          return
        }
        schedule()
      })
      .catch(() => schedule())
  }

  tick()

  return () => {
    stopped = true
    if (handle !== null) clearTimer(handle)
    handle = null
  }
}

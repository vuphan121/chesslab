'use client'

import { useEffect, useState } from 'react'

// useViewportWidth tracks window.innerWidth with a resize listener. Returns
// `null` before mount (SSR/first paint) so callers can render the desktop
// layout until the real width is known, avoiding a hydration mismatch —
// there is no "correct" width to guess on the server.
export function useViewportWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    // Belt-and-suspenders for mobile rotation — some browsers are slow to
    // fire 'resize' on an orientation change, though most fire both.
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return width
}

// clamp restricts n to [min, max].
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

'use client'

import { useEffect, useState } from 'react'

// `dimension` is a stable primitive (not a closure) so the effect below can
// keep an empty dependency array — a function prop recreated every render
// would otherwise tear down and re-add the resize listener on every render.
function useWindowDimension(dimension: 'width' | 'height'): number | null {
  const [value, setValue] = useState<number | null>(null)

  useEffect(() => {
    const update = () => setValue(dimension === 'width' ? window.innerWidth : window.innerHeight)
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [dimension])

  return value
}

export function useViewportWidth(): number | null {
  return useWindowDimension('width')
}

export function useViewportHeight(): number | null {
  return useWindowDimension('height')
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

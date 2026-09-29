'use client'

import { useEffect, useState } from 'react'

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

export function useIsPhoneLike(): { compact: boolean; short: boolean } {
  const w = useViewportWidth() ?? 1000
  const h = useViewportHeight() ?? 1000
  const short = h < 450 && w < 1000
  return { compact: w < 640 || short, short }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

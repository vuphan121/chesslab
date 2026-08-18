'use client'

import { useEffect, useState } from 'react'





export function useViewportWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)


    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return width
}


export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

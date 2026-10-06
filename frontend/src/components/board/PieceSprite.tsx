import { memo, useLayoutEffect, useRef } from 'react'
import type { Piece as PieceType } from '@/lib/chess/types'
import Piece from './Piece'

const SLIDE_MS = 160

interface Props {
  square: string
  piece: PieceType
  left: number
  top: number
  size: number
  animate: boolean
  hidden: boolean
}

function PieceSprite({ square, piece, left, top, size, animate, hidden }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef({ square, left, top })

  useLayoutEffect(() => {
    const before = prev.current
    prev.current = { square, left, top }
    const el = ref.current
    if (!el || !animate || before.square === square) return
    el.style.zIndex = '24'
    const animation = el.animate(
      [
        { transform: `translate3d(${before.left - left}px, ${before.top - top}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: SLIDE_MS, easing: 'cubic-bezier(0.22, 0.8, 0.28, 1)' },
    )
    const done = () => {
      el.style.zIndex = ''
    }
    animation.addEventListener('finish', done, { once: true })
    animation.addEventListener('cancel', done, { once: true })
    const timer = window.setTimeout(() => {
      animation.cancel()
      done()
    }, SLIDE_MS + 100)
    return () => window.clearTimeout(timer)
  }, [square, left, top, animate])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        visibility: hidden ? 'hidden' : undefined,
      }}
    >
      <Piece piece={piece} size={size * 0.9} />
    </div>
  )
}

export default memo(PieceSprite)

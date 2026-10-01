import { isMobileDevice } from '@/lib/engine/settings'

let audio: HTMLAudioElement | null = null
let muted: boolean | null = null

export function playMoveSound(): void {
  if (typeof window === 'undefined') return
  if (muted === null) muted = isMobileDevice()
  if (muted) return
  if (!audio) audio = new Audio('/sounds/move.mp3')
  audio.currentTime = 0
  audio.play().catch(() => {})
}

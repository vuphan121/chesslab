import { isMobileDevice } from '@/lib/engine/settings'

let moveAudio: HTMLAudioElement | null = null
let captureAudio: HTMLAudioElement | null = null
let muted: boolean | null = null

export function playMoveSound(capture = false): void {
  if (typeof window === 'undefined') return
  if (muted === null) muted = isMobileDevice()
  if (muted) return
  if (capture) {
    if (!captureAudio) captureAudio = new Audio('/sounds/capture.mp3')
    captureAudio.currentTime = 0
    captureAudio.play().catch(() => {})
    return
  }
  if (!moveAudio) moveAudio = new Audio('/sounds/move-self.mp3')
  moveAudio.currentTime = 0
  moveAudio.play().catch(() => {})
}

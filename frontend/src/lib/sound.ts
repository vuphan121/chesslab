const SOURCES = { move: '/sounds/move-self.mp3', capture: '/sounds/capture.mp3' } as const
type Kind = keyof typeof SOURCES

let context: AudioContext | null = null
const buffers: Partial<Record<Kind, AudioBuffer>> = {}
const loading: Partial<Record<Kind, Promise<void>>> = {}
let unlockBound = false

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (context) return context
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) session.type = 'ambient'
    context = new Ctor()
  } catch {
    return null
  }
  return context
}

function load(kind: Kind): Promise<void> {
  const ctx = getContext()
  if (!ctx) return Promise.resolve()
  loading[kind] ??= fetch(SOURCES[kind])
    .then((res) => res.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      buffers[kind] = buffer
    })
    .catch(() => {
      delete loading[kind]
    })
  return loading[kind]!
}

function unlock(): void {
  const ctx = getContext()
  if (!ctx) return
  if (ctx.state !== 'running') void ctx.resume().catch(() => {})
  void load('move')
  void load('capture')
}

export function prepareSound(): void {
  if (typeof window === 'undefined' || unlockBound) return
  unlockBound = true
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    window.addEventListener(type, unlock, { passive: true })
  }
}

export function playMoveSound(capture = false): void {
  const ctx = getContext()
  if (!ctx) return
  prepareSound()
  const kind: Kind = capture ? 'capture' : 'move'
  const buffer = buffers[kind]
  if (!buffer) {
    void load(kind)
    return
  }
  if (ctx.state !== 'running') void ctx.resume().catch(() => {})
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start(0)
}

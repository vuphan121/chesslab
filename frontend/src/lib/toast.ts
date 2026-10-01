const TOAST_MS = 2200
let current: HTMLDivElement | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function showToast(message: string): void {
  if (typeof document === 'undefined') return
  if (timer) clearTimeout(timer)
  current?.remove()
  const el = document.createElement('div')
  el.textContent = message
  el.setAttribute('role', 'status')
  el.style.cssText =
    'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1000;padding:9px 16px;border-radius:8px;' +
    'background:#2b2a27;color:#fff;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.25);' +
    'pointer-events:none;opacity:0;transition:opacity 160ms'
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    el.style.opacity = '1'
  })
  current = el
  timer = setTimeout(() => {
    el.style.opacity = '0'
    setTimeout(() => {
      el.remove()
      if (current === el) current = null
    }, 200)
  }, TOAST_MS)
}

'use client'

import { useEffect } from 'react'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))
      if ('caches' in window) {
        caches.keys().then((keys) => keys.filter((k) => k.startsWith('chesslab-')).forEach((k) => caches.delete(k)))
      }
      return
    }

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        const ready = await navigator.serviceWorker.ready
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin))
        ;(reg.active ?? ready.active)?.postMessage({ type: 'CACHE_URLS', urls: [location.href, ...urls] })
        void navigator.storage?.persist?.()
      } catch {
      }
    }
    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}

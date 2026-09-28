const VERSION = 'v1'
const STATIC_CACHE = `chesslab-static-${VERSION}`
const PAGE_CACHE = `chesslab-pages-${VERSION}`
const NAV_TIMEOUT_MS = 4000

const PRECACHE_PAGES = ['/opening-study']
const PIECES = ['bb', 'bk', 'bn', 'bp', 'bq', 'br', 'wb', 'wk', 'wn', 'wp', 'wq', 'wr']
const PRECACHE_ASSETS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
  '/board-texture.png',
  '/sounds/move.mp3',
  ...PIECES.map((p) => `/pieces/${p}.png`),
  ...PIECES.map((p) => `/pieces/glass/${p}.png`),
]

const STATIC_PATTERN = /\/_next\/static\/[^"'\\\s)]+?\.(?:js|css|woff2?)/g
const CSS_URL_PATTERN = /url\(["']?(\/_next\/static\/[^"')]+)/g
const ASSET_EXT = /\.(?:png|jpe?g|svg|webp|ico|mp3|woff2?)$/

function pageKey(url) {
  const u = new URL(url)
  return new Request(u.origin + u.pathname)
}

function isCacheableAsset(pathname) {
  return pathname.startsWith('/_next/static/') || ASSET_EXT.test(pathname) || pathname === '/manifest.webmanifest'
}

async function precachePage(url, pages, assets) {
  const res = await fetch(url, { cache: 'reload' })
  if (!res.ok || res.redirected) return
  const html = await res.clone().text()
  await pages.put(pageKey(new URL(url, self.location.origin).href), res)
  const chunks = [...new Set(html.match(STATIC_PATTERN) ?? [])]
  await Promise.allSettled(chunks.map((u) => assets.add(u)))
  for (const cssUrl of chunks.filter((u) => u.endsWith('.css'))) {
    const cached = await assets.match(cssUrl)
    if (!cached) continue
    const css = await cached.text()
    const fonts = [...css.matchAll(CSS_URL_PATTERN)].map((m) => m[1])
    await Promise.allSettled(fonts.map((u) => assets.add(u)))
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const assets = await caches.open(STATIC_CACHE)
      const pages = await caches.open(PAGE_CACHE)
      await Promise.allSettled(PRECACHE_ASSETS.map((u) => assets.add(u)))
      for (const url of PRECACHE_PAGES) {
        try {
          await precachePage(url, pages, assets)
        } catch {
        }
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE])
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith('chesslab-') && !keep.has(n)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'CACHE_URLS' || !Array.isArray(data.urls)) return
  event.waitUntil(
    (async () => {
      const assets = await caches.open(STATIC_CACHE)
      const pages = await caches.open(PAGE_CACHE)
      for (const raw of data.urls) {
        let u
        try {
          u = new URL(raw)
        } catch {
          continue
        }
        if (u.origin !== self.location.origin) continue
        try {
          if (isCacheableAsset(u.pathname)) {
            if (!(await assets.match(u.href))) await assets.add(u.href)
          } else if (raw === data.urls[0]) {
            const res = await fetch(u.href)
            if (res.ok && !res.redirected) await pages.put(pageKey(u.href), res)
          }
        } catch {
        }
      }
    })(),
  )
})

function offlineResponse() {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chesslab offline</title>
<body style="font-family:system-ui,sans-serif;background:#e8e8e6;color:#1c1b18;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px">
<div style="max-width:340px"><h1 style="font-size:20px;margin:0 0 8px">You're offline</h1>
<p style="font-size:14px;line-height:1.5;color:#6a675f;margin:0 0 16px">This page isn't available without a connection. Opening Study works offline.</p>
<a href="/opening-study" style="display:inline-block;background:#1c1b18;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:999px">Open Opening Study</a></div></body>`
  return new Response(body, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function handleNavigation(event) {
  const req = event.request
  const cache = await caches.open(PAGE_CACHE)
  const key = pageKey(req.url)
  const cached = await cache.match(key)
  const network = fetch(req).then((res) => {
    if (res.ok && !res.redirected) event.waitUntil(cache.put(key, res.clone()))
    return res
  })
  if (!cached) return network.catch(() => offlineResponse())
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS))
  return Promise.race([network, timeout]).catch(() => cached)
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

async function rangeResponse(req, res) {
  const match = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
  const buf = await res.arrayBuffer()
  const size = buf.byteLength
  if (!match) return new Response(buf, { status: 200, headers: res.headers })
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  let end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  const chunk = buf.slice(start, end + 1)
  return new Response(chunk, {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(chunk.byteLength),
    },
  })
}

async function staleWhileRevalidate(event) {
  const req = event.request
  const cache = await caches.open(STATIC_CACHE)
  if (req.headers.has('range')) {
    const whole = await cache.match(req.url)
    if (whole) return rangeResponse(req, whole)
    return fetch(req)
  }
  const hit = await cache.match(req)
  const refresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => null)
  if (hit) {
    event.waitUntil(refresh)
    return hit
  }
  return (await refresh) ?? Response.error()
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event))
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req))
  } else if (ASSET_EXT.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(event))
  }
})

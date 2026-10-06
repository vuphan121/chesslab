const VERSION = 'v4'
const STATIC_CACHE = `chesslab-static-${VERSION}`
const PAGE_CACHE = `chesslab-pages-${VERSION}`
const REVALIDATE_MIN_GAP_MS = 60000
const UNREFERENCED_STATIC_GRACE = 32

const PRECACHE_PAGES = ['/opening-study', '/puzzles', '/endgames']
const PIECES = ['bb', 'bk', 'bn', 'bp', 'bq', 'br', 'wb', 'wk', 'wn', 'wp', 'wq', 'wr']
const PRECACHE_ASSETS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
  '/board-texture.png',
  '/sounds/move-self.mp3',
  '/sounds/capture.mp3',
  '/stockfish/stockfish-19-lite-single.js',
  '/stockfish/stockfish-19-lite-single.wasm',
  ...PIECES.map((p) => `/pieces/${p}.png`),
  ...PIECES.map((p) => `/pieces/glass/${p}.png`),
]

const STATIC_PATTERN = /\/_next\/static\/[^"'\\\s)]+?\.(?:js|css|woff2?)/g
const CSS_URL_PATTERN = /url\(["']?(\/_next\/static\/[^"')]+)/g
const ASSET_EXT = /\.(?:png|jpe?g|svg|webp|ico|mp3|woff2?|wasm)$/

function pageKey(url) {
  const u = new URL(url)
  return new Request(u.origin + u.pathname)
}

function isCacheableAsset(pathname) {
  return pathname.startsWith('/_next/static/') || pathname.startsWith('/stockfish/') || ASSET_EXT.test(pathname) || pathname === '/manifest.webmanifest'
}

async function cacheAssetsFromHtml(html, assets) {
  const chunks = [...new Set(html.match(STATIC_PATTERN) ?? [])]
  const missing = []
  for (const u of chunks) if (!(await assets.match(u))) missing.push(u)
  const results = await Promise.allSettled(missing.map((u) => assets.add(u)))
  if (results.some((r) => r.status === 'rejected')) return false
  for (const cssUrl of chunks.filter((u) => u.endsWith('.css'))) {
    const cached = await assets.match(cssUrl)
    if (!cached) continue
    const css = await cached.text()
    const fonts = [...css.matchAll(CSS_URL_PATTERN)].map((m) => m[1])
    for (const u of fonts) {
      if (await assets.match(u)) continue
      try {
        await assets.add(u)
      } catch {
        return false
      }
    }
  }
  return true
}

async function referencedStaticAssets() {
  const pages = await caches.open(PAGE_CACHE)
  const assets = await caches.open(STATIC_CACHE)
  const referenced = new Set()
  for (const request of await pages.keys()) {
    const response = await pages.match(request)
    if (!response) continue
    const html = await response.text()
    for (const path of html.match(STATIC_PATTERN) ?? []) {
      referenced.add(new URL(path, self.location.origin).href)
    }
  }
  for (const url of [...referenced].filter((value) => value.endsWith('.css'))) {
    const response = await assets.match(url)
    if (!response) continue
    const css = await response.text()
    for (const match of css.matchAll(CSS_URL_PATTERN)) {
      referenced.add(new URL(match[1], self.location.origin).href)
    }
  }
  return referenced
}

async function pruneStaticAssets() {
  const assets = await caches.open(STATIC_CACHE)
  const referenced = await referencedStaticAssets()
  const unreferenced = (await assets.keys()).filter((request) => {
    const url = new URL(request.url)
    return url.pathname.startsWith('/_next/static/') && !referenced.has(request.url)
  })
  const removable = unreferenced.slice(0, Math.max(0, unreferenced.length - UNREFERENCED_STATIC_GRACE))
  await Promise.all(removable.map((request) => assets.delete(request)))
}

const lastRevalidated = new Map()
const revalidating = new Map()

function revalidatePage(url, force) {
  const key = pageKey(new URL(url, self.location.origin).href)
  if (revalidating.has(key.url)) return revalidating.get(key.url)
  if (!force && Date.now() - (lastRevalidated.get(key.url) ?? 0) < REVALIDATE_MIN_GAP_MS) return Promise.resolve(false)
  const run = (async () => {
    const res = await fetch(key.url, { cache: 'no-cache', headers: { Accept: 'text/html' } })
    if (!res.ok || res.redirected) return false
    const html = await res.clone().text()
    const assets = await caches.open(STATIC_CACHE)
    if (!(await cacheAssetsFromHtml(html, assets))) return false
    const pages = await caches.open(PAGE_CACHE)
    await pages.put(key, res)
    await pruneStaticAssets()
    lastRevalidated.set(key.url, Date.now())
    return true
  })()
    .catch(() => false)
    .finally(() => revalidating.delete(key.url))
  revalidating.set(key.url, run)
  return run
}

async function revalidateAllPages() {
  const pages = await caches.open(PAGE_CACHE)
  const urls = new Set((await pages.keys()).map((r) => r.url))
  for (const u of PRECACHE_PAGES) urls.add(new URL(u, self.location.origin).href)
  const assets = await caches.open(STATIC_CACHE)
  await Promise.allSettled(PRECACHE_ASSETS.map((u) => assets.add(u)))
  const results = await Promise.all([...urls].map((u) => revalidatePage(u, true)))
  return results.every(Boolean)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const assets = await caches.open(STATIC_CACHE)
      await Promise.allSettled(PRECACHE_ASSETS.map((u) => assets.add(u)))
      await Promise.allSettled(PRECACHE_PAGES.map((u) => revalidatePage(u, true)))
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
  if (data && data.type === 'REVALIDATE' && typeof data.url === 'string') {
    event.waitUntil(revalidatePage(data.url, false))
    return
  }
  if (data && data.type === 'REFRESH_SHELL') {
    const port = event.ports[0]
    event.waitUntil(revalidateAllPages().then((ok) => port?.postMessage({ ok })))
    return
  }
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
  const cached = await cache.match(pageKey(req.url))
  if (cached) {
    event.waitUntil(revalidatePage(req.url, false))
    return cached
  }
  try {
    const res = await fetch(req)
    if (res.ok && !res.redirected) {
      const forHtml = res.clone()
      const forCache = res.clone()
      event.waitUntil(
        (async () => {
          const html = await forHtml.text()
          const assets = await caches.open(STATIC_CACHE)
          if (await cacheAssetsFromHtml(html, assets)) {
            await cache.put(pageKey(req.url), forCache)
            await pruneStaticAssets()
          }
        })().catch(() => {}),
      )
    }
    return res
  } catch {
    return offlineResponse()
  }
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
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/stockfish/')) {
    event.respondWith(cacheFirst(req))
  } else if (ASSET_EXT.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(event))
  }
})

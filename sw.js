// Service Worker：让手机装到主屏幕后离线也能打开，同时保证改版后一刷新就生效。
//
// 关键点：所有请求都带一个版本参数（?__v=...）。
// GitHub Pages 的 CDN 是按完整 URL 缓存的，版本一变 URL 就变，
// CDN 的旧副本就永远不会被用上 —— 这样就不会再出现「HTML 是新的、JS 还是旧的」。
//
// 策略：网络优先，2.5 秒拿不到就用缓存。

const VERSION = 'v7'
const CACHE = `picture-quiz-${VERSION}`

const SHELL_PATHS = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/ui.js',
  './js/db.js',
  './js/storage.js',
  './js/image.js',
  './js/viewer.js',
  './js/crop.js',
  './js/doodle.js',
  './js/fullscreen.js',
  './js/preview.js',
  './js/thumb.js',
  './js/repo.js',
  './js/quiz.js',
  './js/ingest.js',
  './js/lists.js',
  './js/settings.js',
  './js/backup.js',
  './vendor/jszip.min.js',
  './vendor/cropper.min.js',
  './vendor/cropper.min.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
]

function versionedUrl(path) {
  const url = new URL(path, self.location.href)
  url.searchParams.set('__v', VERSION)
  return url.href
}

const SHELL = SHELL_PATHS.map(versionedUrl)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {
        // 某个文件没缓存上也不该让整个安装失败。
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
}

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>离线</title>' +
      '<body style="font:16px/1.7 system-ui;padding:40px;text-align:center">' +
      '<h2>现在没有网络</h2><p>这个页面还没有缓存过。连上网络后再打开一次即可。</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  const target = versionedUrl(request.url)
  try {
    const response = await Promise.race([fetch(target), timeout(2500)])
    if (response && response.ok) {
      cache.put(target, response.clone()).catch(() => {})
    }
    return response
  } catch {
    const cached = await cache.match(target)
    if (cached) return cached
    if (request.mode === 'navigate') {
      const shell = await cache.match(versionedUrl('./index.html'))
      if (shell) return shell
      return offlinePage()
    }
    return new Response('', { status: 504, statusText: 'offline' })
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(networkFirst(request))
})

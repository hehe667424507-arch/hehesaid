// Service Worker：让手机装到主屏幕后离线也能打开，同时保证改版后一刷新就生效。
//
// 策略：同源请求一律「网络优先」，2.5 秒拿不到就用缓存。
//   - 联网时：永远拿到最新文件（所以我改完代码，你刷新一次就是新版）
//   - 断网 / 网很差：用缓存里的旧版，不白屏
// 比「缓存优先」更适合这个项目：文件总共才 100 多 KB，网络优先不会慢。

const CACHE = 'picture-quiz-v4'

const SHELL = [
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {
        // 某个文件没缓存上（例如路径写错）也不该让整个安装失败。
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
  try {
    const response = await Promise.race([fetch(request), timeout(2500)])
    if (response && response.ok) {
      // 后台写缓存，不阻塞返回。
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html')
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

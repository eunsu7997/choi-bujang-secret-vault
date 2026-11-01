// 11단계: 오프라인 안내 페이지만 보관하는 서비스 워커입니다.
// 자료 API(/api/*)와 로그인 응답은 저장하지 않고, 기기 키나 토큰도 다루지 않습니다.
const CACHE = 'byteback-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // 화면 이동만 다룹니다. 연결이 되면 항상 서버에서 받고, 실패할 때만 오프라인 안내를 보여 줍니다.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});

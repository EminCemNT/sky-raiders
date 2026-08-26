// sky-raiders Service Worker —— 静态资源离线缓存（P0 技术品质：构建分包 + SW）
// 策略：install 预缓存外壳（./ 与 ./index.html）；activate 清理旧版本缓存；
//       fetch 缓存优先（命中即返回，未命中回源并写入缓存 —— 运行时把 ./assets/* 也缓存下来）。
// 说明：assets 产物带内容哈希，文件名在构建期才确定，故 install 不写死 assets 清单，
//       交给 fetch 缓存优先策略在首次访问时逐个缓存（等效覆盖 ./assets/*）。
const CACHE = 'sky-raiders-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(['./', './index.html']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 缓存优先，回源成功后更新缓存（stale-while-revalidate 的简化版）
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

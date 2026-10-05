/* Katharos service worker: offline shell, live-feed cache, background refresh and deadline reminders. */
/* eslint-disable no-restricted-globals */
const VERSION = '__VERSION__';
const SHELL = `katharos-shell-${VERSION}`;
const FEEDS = 'katharos-feeds';
const OCR = 'katharos-ocr';
const PRECACHE = [/*__PRECACHE__*/];

// Live sources refreshed in the background (periodic sync) — public, credible, CORS-enabled.
const FEED_URLS = [
  'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,GBP,ILS,RUB,UAH,CHF,AED,CNY,SEK,PLN',
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hpi_q?geo=CY&unit=I15_Q&purchase=TOTAL&lastTimePeriod=12',
  `https://date.nager.at/api/v3/PublicHolidays/${new Date().getFullYear()}/CY`,
  `https://date.nager.at/api/v3/PublicHolidays/${new Date().getFullYear() + 1}/CY`,
];

const OCR_FILES = [
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js',
  'vendor/tessdata/ell.traineddata.gz',
  'vendor/tessdata/eng.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // cache: 'reload' bypasses the HTTP cache so a new version never mixes old files.
      await Promise.all(
        PRECACHE.map(async (url) => {
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (!res.ok) throw new Error(`precache failed: ${url} ${res.status}`);
          await cache.put(url, res);
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('katharos-shell-') && key !== SHELL) await caches.delete(key);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'VERSION') event.source?.postMessage({ type: 'VERSION', version: VERSION });
  if (msg.type === 'CACHE_OCR_PACK') event.waitUntil(cacheOcrPack(event.source));
  if (msg.type === 'REFRESH_FEEDS') event.waitUntil(refreshFeeds());
});

async function cacheOcrPack(client) {
  const cache = await caches.open(OCR);
  let done = 0;
  for (const url of OCR_FILES) {
    if (!(await cache.match(url))) {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok) await cache.put(url, res);
    }
    done += 1;
    client?.postMessage({ type: 'OCR_PACK_PROGRESS', done, total: OCR_FILES.length });
  }
}

async function refreshFeeds() {
  const cache = await caches.open(FEEDS);
  await Promise.allSettled(
    FEED_URLS.map(async (url) => {
      const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
      if (res.ok) await cache.put(url, res);
    }),
  );
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: 'FEEDS_REFRESHED', at: Date.now() });
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App navigation: always try the network for the freshest shell, fall back to the cached one.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) return preload;
          return await Promise.race([fetch(req), timeout(3500)]);
        } catch {
          const cache = await caches.open(SHELL);
          return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // version.json must always come from the network so update checks see the truth.
    if (url.pathname.endsWith('/version.json')) return;
    event.respondWith(
      (async () => {
        const hit = (await caches.match(req, { ignoreSearch: true }));
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && url.pathname.includes('/vendor/')) {
          const cache = await caches.open(OCR);
          cache.put(req, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // Public live-data sources: network first (fresh), cached copy when offline.
  if (FEED_URLS.some((f) => req.url.startsWith(f.split('?')[0]))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(FEEDS);
        try {
          const res = await Promise.race([fetch(req), timeout(8000)]);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return (await cache.match(req)) || Response.error();
        }
      })(),
    );
  }
});

// Periodic Background Sync (installed app on Chromium): refresh live data and check deadlines
// while the app is closed. Runs on each user's own device — no central server involved.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'katharos-refresh') event.waitUntil(Promise.all([refreshFeeds(), remindDeadlines()]));
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'katharos-outbox') {
    event.waitUntil(
      self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage({ type: 'FLUSH_OUTBOX' }))),
    );
  }
});

// Reminders hold only a matter reference, a label and a date — never client names or documents.
function openReminders() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('katharos-reminders', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('reminders', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function remindDeadlines() {
  if (self.Notification?.permission !== 'granted') return;
  const db = await openReminders();
  const all = await new Promise((resolve) => {
    const req = db.transaction('reminders').objectStore('reminders').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
  const now = Date.now();
  const soon = all.filter((r) => {
    const due = Date.parse(r.due);
    return due >= now - 86400000 && due - now <= 3 * 86400000;
  });
  for (const r of soon) {
    await self.registration.showNotification('Katharos deadline', {
      body: `${r.label} — due ${r.due}`,
      tag: `deadline-${r.id}`,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: `./#/matters/${encodeURIComponent(r.matterId)}` },
    });
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || './#/';
  event.waitUntil(
    (async () => {
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of cs) {
        if ('focus' in c) {
          c.navigate?.(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

const CACHE_NAME = 'live-display-v1';

// Static assets to cache for Live Display PWA
const STATIC_ASSETS = [
    './pages/live-display.html',
    './css/live-display.css',
    './js/live-display.js',
    './manifest-live.json',
    './favicon.svg',
    './assets/icon-live-192.png',
    './assets/icon-live-512.png'
];

// Install Event - Pre-cache static UI assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Pre-caching Live Display assets');
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('[Service Worker] Asset caching partial warning:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate Event - Clean up old caches if version changes
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME && cache.startsWith('live-display-')) {
                        console.log('[Service Worker] Clearing old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Safe helper to check if a request has a cacheable HTTP/HTTPS scheme
function isCacheableRequest(request) {
    if (!request) return false;
    const urlStr = typeof request === 'string' ? request : request.url;
    if (!urlStr) return false;
    return urlStr.startsWith('http://') || urlStr.startsWith('https://');
}

// Safe helper to put a response into cache without throwing unhandled rejections
async function safeCachePut(cacheName, request, response) {
    try {
        if (!isCacheableRequest(request) || !response) return;
        const cache = await caches.open(cacheName);
        await cache.put(request, response);
    } catch (err) {
        console.warn('[Service Worker] Cache put warning:', err);
    }
}

// Fetch Event - Stale-while-revalidate for static assets, NETWORK-ONLY for Firestore/APIs
self.addEventListener('fetch', (event) => {
    // Only intercept HTTP and HTTPS GET requests; bypass non-GET completely
    if (event.request.method !== 'GET') {
        return; // Network handles directly
    }

    let url;
    try {
        url = new URL(event.request.url);
    } catch (e) {
        return;
    }

    // Exclude chrome-extension://, chrome://, devtools://, and other non-http(s) schemes
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return; // Network/browser handles directly without service worker interference
    }

    // Bypass Service Worker completely for Firestore / Firebase / API
    if (
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('identitytoolkit')
    ) {
        return; // Network handles directly
    }

    // For static assets, serve from cache first, then update cache in background
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Fetch fresh copy in background for next time
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        safeCachePut(CACHE_NAME, event.request, networkResponse.clone());
                    }
                }).catch(() => { /* offline silent handling */ });

                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    safeCachePut(CACHE_NAME, event.request, responseToCache);
                }
                return networkResponse;
            });
        }).catch((err) => {
            console.warn('[Service Worker] Fetch match fallback error:', err);
            return fetch(event.request);
        })
    );
});

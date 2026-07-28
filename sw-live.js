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

// Fetch Event - Stale-while-revalidate for static assets, NETWORK-ONLY for Firestore/APIs
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Bypass Service Worker completely for Firestore / Firebase / API / Non-GET requests
    if (
        event.request.method !== 'GET' ||
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
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse);
                        });
                    }
                }).catch(() => { /* offline silent handling */ });

                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            });
        })
    );
});

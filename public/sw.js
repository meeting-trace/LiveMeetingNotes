/**
 * Service Worker for Live Meeting Notes App
 * Handles caching and update management
 * 
 * HOW VERSION DETECTION WORKS:
 * - Vite generates unique hash for each build (e.g., index-abc123.js)
 * - When files change, hash changes → Service Worker detects new version
 * - No need to manually update version number
 */

// Cache version - will be auto-updated by build timestamp
const BUILD_TIMESTAMP = '__BUILD_TIMESTAMP__'; // Replaced at build time
const CACHE_VERSION = BUILD_TIMESTAMP !== '__BUILD_TIMESTAMP__' ? BUILD_TIMESTAMP : Date.now();
const CACHE_NAME = `live-meeting-notes-v${CACHE_VERSION}`;

// Static assets to cache (these paths are stable)
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing... Cache version:', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('[SW] Skip waiting on install - activating new version immediately');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Cache failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating... Cleaning old caches except:', CACHE_NAME);
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Delete all caches except current version
              const isOldCache = cacheName.startsWith('live-meeting-notes-v') && cacheName !== CACHE_NAME;
              if (isOldCache) {
                console.log('[SW] Deleting old cache:', cacheName);
              }
              return isOldCache;
            })
            .map((cacheName) => caches.delete(cacheName))
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients - taking control immediately');
        return self.clients.claim();
      })
  );
});

// Fetch event - Network First strategy for HTML, Cache First for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network First for HTML documents (always get latest)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the new version
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(request);
        })
    );
    return;
  }

  // Cache First for static assets (JS, CSS, images)
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(request).then((response) => {
          // Only cache successful responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Cache the fetched response
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        });
      })
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    console.log('[SW] Check update requested');
    // Send message to all clients
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'UPDATE_AVAILABLE',
          version: CACHE_NAME
        });
      });
    });
  }
});

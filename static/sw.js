// Minimal service worker: makes the app installable ("Add to home screen").
// It caches nothing on purpose: training and health data are never stored on
// the device, and every page load fetches fresh data from the server. Only when
// the server can't be reached does a navigation get a short offline note.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Training Log — offline</title>
<body style="font-family:system-ui,sans-serif;padding:24px;color:#52514e;background:#f9f9f7">
<h1 style="font-size:20px;color:#0b0b0b">Can't reach the server</h1>
<p>Training Log needs a connection to your server. Check the network and try again.</p>
<button onclick="location.reload()" style="font:inherit;padding:8px 14px">Retry</button></body>`;

self.addEventListener('fetch', (event) => {
  // only page loads; API calls, scripts and styles go straight to the network
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() =>
    new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

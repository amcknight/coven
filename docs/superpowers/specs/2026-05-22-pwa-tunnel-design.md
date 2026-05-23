# Coven — PWA + Cloudflare Tunnel Design

**Date:** 2026-05-22  
**Status:** Approved

## Goal

Make Coven reachable from any network (not just home WiFi) and installable as a standalone PWA on Android. iOS support is not blocked but not the focus.

## Approach

Option A: random Cloudflare quick tunnel (no account) + PWA manifest/service worker. A tiny wrapper script (`start.js`) ties them together so `npm run serve` is the only command needed.

## Components

### `start.js` — tunnel wrapper

Spawns `cloudflared tunnel --url http://localhost:8080` as a child process, watches its stdout/stderr for the `trycloudflare.com` URL, then spawns `node server.js` with `COVEN_URL` set to that URL. Wires `SIGINT` so Ctrl-C kills both. No new npm dependencies.

Added to `package.json` as `"serve": "node start.js"`.

### `server.js` — three changes

1. **QR URL**: `process.env.COVEN_URL || \`http://${getLanIp()}:${PORT}\`` — falls back to LAN IP when running without the tunnel (plain `npm start` still works).

2. **New routes** added to the HTTP handler:
   - `GET /manifest.json` — web app manifest, inlined as a string constant
   - `GET /sw.js` — minimal service worker, inlined as a string constant
   - `GET /icon.svg` — ember SVG icon, inlined as a string constant

   Pattern matches the existing `/qr.png` route. No new files on disk.

### `index.html` — two additions

- `<link rel="manifest" href="/manifest.json">` in `<head>`
- A `<script>` block at page end to register the service worker (`navigator.serviceWorker.register('/sw.js')`)

### PWA manifest fields

```json
{
  "name": "Coven",
  "short_name": "Coven",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#04060d",
  "background_color": "#04060d",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

### Service worker

Minimal — exists solely to satisfy Chrome's PWA installability requirement. Coven is useless offline so no caching strategy is implemented.

```javascript
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
```

### Icon

SVG served at `/icon.svg`. Ember glyph on `#04060d` background, styled to match the séance aesthetic (`--blue: #2f7bff`, `--blue-bright: #9fd0ff`).

## What does not change

- WebSocket protocol and world model are untouched
- Physics simulation loop is untouched
- `npm start` still works for plain LAN use
- The two-phone left/right hardcoding is untouched

## Install flow (Android Chrome)

1. Friend scans the QR on the start screen (or visits the tunnel URL directly)
2. After one or two visits Chrome shows an "Add to Home Screen" banner
3. Tapping installs Coven as a standalone icon — no browser chrome

## Out of scope

- Stable custom domain (mangort.com / amcknight.ca) — deferred; requires Cloudflare account + nameserver change at registrar, clean separate session
- iOS — unblocked by this work (HTTPS is the main requirement), but not tested
- Offline support — not useful; the app requires a live altar

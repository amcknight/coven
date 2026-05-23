# PWA + Cloudflare Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Coven reachable from any network via a Cloudflare quick tunnel and installable as a PWA on Android Chrome.

**Architecture:** `start.js` spawns `cloudflared` and `node server.js` together, passing the tunnel URL via `COVEN_URL` env var so the QR code always reflects the right address. Three new inline routes (`/manifest.json`, `/icon.svg`, `/sw.js`) are added to `server.js`. `index.html` links the manifest and registers the SW. No new npm dependencies.

**Tech Stack:** Node.js `child_process.spawn`, Cloudflare quick tunnel (`cloudflared` binary, installed separately), Web App Manifest, Service Worker API

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `test.js` | Modify | Add HTTP helper + tests for 3 new routes + `getPublicUrl` |
| `server.js` | Modify | Add `MANIFEST`, `ICON_SVG`, `SW_JS` constants; `getPublicUrl()`; 3 new HTTP routes; export `getPublicUrl` |
| `index.html` | Modify | Add `<link rel="manifest">`, `<meta name="theme-color">`, SW registration script |
| `start.js` | Create | Spawn `cloudflared`, extract tunnel URL, spawn `node server.js` with `COVEN_URL` |
| `package.json` | Modify | Add `"serve": "node start.js"` script |

---

## Task 1: HTTP test helper + `/manifest.json` route

**Files:**
- Modify: `test.js`
- Modify: `server.js:50-67` (constants block + HTTP handler)

- [ ] **Step 1: Add HTTP helper to `test.js`**

Add after the existing `require` lines at the top of `test.js`:

```javascript
const http = require('http');

function getRoute(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}
```

- [ ] **Step 2: Write the failing test for `/manifest.json`**

Add at the end of `test.js`:

```javascript
test('GET /manifest.json returns valid web app manifest', async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    const { status, headers, body } = await getRoute(port, '/manifest.json');
    assert.equal(status, 200);
    assert.ok(headers['content-type'].includes('json'));
    const manifest = JSON.parse(body);
    assert.equal(manifest.name, 'Coven');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

```
npm test
```

Expected: FAIL — `GET /manifest.json` test fails with status 200 but body is the HTML page (the route doesn't exist yet), causing `JSON.parse` to throw or `manifest.name` to be wrong.

- [ ] **Step 4: Add `MANIFEST` constant and route to `server.js`**

After line 50 (`let clientHtml = fs.readFileSync(HTML_PATH);`), add:

```javascript
const MANIFEST = JSON.stringify({
  name: 'Coven',
  short_name: 'Coven',
  display: 'standalone',
  start_url: '/',
  theme_color: '#04060d',
  background_color: '#04060d',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
});
```

In the HTTP handler (around line 59), add a new route before the fallthrough `res.end(clientHtml)`:

```javascript
  if (req.url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    res.end(MANIFEST);
    return;
  }
```

- [ ] **Step 5: Run tests to verify the new test passes and existing tests still pass**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add test.js server.js
git commit -m "feat: add /manifest.json route"
```

---

## Task 2: `/icon.svg` route

**Files:**
- Modify: `test.js`
- Modify: `server.js` (new constant + route)

- [ ] **Step 1: Write the failing test**

Add at the end of `test.js`:

```javascript
test('GET /icon.svg returns SVG content', async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    const { status, headers, body } = await getRoute(port, '/icon.svg');
    assert.equal(status, 200);
    assert.ok(headers['content-type'].includes('svg'));
    assert.ok(body.includes('<svg'));
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npm test
```

Expected: FAIL — the icon test fails (route returns HTML, not SVG).

- [ ] **Step 3: Add `ICON_SVG` constant and route to `server.js`**

After the `MANIFEST` constant, add:

```javascript
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#04060d"/>
  <circle cx="256" cy="256" r="120" fill="#2f7bff" opacity="0.12"/>
  <circle cx="256" cy="256" r="60" fill="#6ab4ff" opacity="0.5"/>
  <circle cx="256" cy="256" r="22" fill="#eaf3ff"/>
</svg>`;
```

In the HTTP handler, add after the `/manifest.json` route:

```javascript
  if (req.url === '/icon.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(ICON_SVG);
    return;
  }
```

- [ ] **Step 4: Run tests to verify all pass**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add test.js server.js
git commit -m "feat: add /icon.svg route"
```

---

## Task 3: `/sw.js` route

**Files:**
- Modify: `test.js`
- Modify: `server.js` (new constant + route)

- [ ] **Step 1: Write the failing test**

Add at the end of `test.js`:

```javascript
test('GET /sw.js returns service worker JavaScript', async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    const { status, headers, body } = await getRoute(port, '/sw.js');
    assert.equal(status, 200);
    assert.ok(headers['content-type'].includes('javascript'));
    assert.ok(body.includes('install'));
    assert.ok(body.includes('activate'));
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npm test
```

Expected: FAIL — sw.js test fails (route returns HTML).

- [ ] **Step 3: Add `SW_JS` constant and route to `server.js`**

After the `ICON_SVG` constant, add:

```javascript
const SW_JS = [
  "self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));",
  "self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));",
].join('\n');
```

In the HTTP handler, add after the `/icon.svg` route:

```javascript
  if (req.url === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(SW_JS);
    return;
  }
```

- [ ] **Step 4: Run tests to verify all pass**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add test.js server.js
git commit -m "feat: add /sw.js route"
```

---

## Task 4: `getPublicUrl` + `COVEN_URL` env var

**Files:**
- Modify: `test.js`
- Modify: `server.js` (new function, updated QR call, updated exports)

- [ ] **Step 1: Update the `require` line at the top of `test.js`**

Change the existing server import line from:

```javascript
const { touchToWorld, start, httpServer, VW, VH } = require('./server');
```

to:

```javascript
const { touchToWorld, start, httpServer, VW, VH, getPublicUrl } = require('./server');
```

- [ ] **Step 2: Write the failing tests**

Add at the end of `test.js`:

```javascript
test('getPublicUrl returns COVEN_URL when set', () => {
  process.env.COVEN_URL = 'https://test.trycloudflare.com';
  try {
    assert.equal(getPublicUrl(), 'https://test.trycloudflare.com');
  } finally {
    delete process.env.COVEN_URL;
  }
});

test('getPublicUrl falls back to LAN IP URL when COVEN_URL not set', () => {
  delete process.env.COVEN_URL;
  const url = getPublicUrl();
  assert.ok(url.startsWith('http://'));
  assert.ok(url.includes(':8080'));
});
```

- [ ] **Step 3: Run tests to verify they fail**

```
npm test
```

Expected: FAIL — `getPublicUrl` is not exported (TypeError: getPublicUrl is not a function).

- [ ] **Step 4: Add `getPublicUrl` to `server.js` and use it for QR generation**

After the `getLanIp` function (around line 47), add:

```javascript
function getPublicUrl() {
  return process.env.COVEN_URL || `http://${getLanIp()}:${PORT}`;
}
```

Find the `QRCode.toBuffer` call (around line 54) and change the first argument from:

```javascript
QRCode.toBuffer(`http://${getLanIp()}:${PORT}`, {
```

to:

```javascript
QRCode.toBuffer(getPublicUrl(), {
```

Update the `module.exports` at the bottom of `server.js` from:

```javascript
module.exports = { touchToWorld, start, httpServer, world, VW, VH, R };
```

to:

```javascript
module.exports = { touchToWorld, start, httpServer, world, VW, VH, R, getPublicUrl };
```

- [ ] **Step 5: Run tests to verify all pass**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add test.js server.js
git commit -m "feat: use COVEN_URL env var for QR code URL"
```

---

## Task 5: Update `index.html`

**Files:**
- Modify: `index.html:6` (head additions)
- Modify: `index.html:293` (SW registration before `</body>`)

No unit test — service worker registration is browser-only; verify manually after Task 6.

- [ ] **Step 1: Add manifest link and theme-color to `<head>`**

After the `<title>COVEN</title>` line (line 6), add:

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#04060d" />
```

- [ ] **Step 2: Add service worker registration before `</body>`**

Before the closing `</body>` tag (line 294), add:

```html
<script>
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
</script>
```

- [ ] **Step 3: Run tests to make sure nothing regressed**

```
npm test
```

Expected: all tests pass (server tests are unaffected by HTML changes).

- [ ] **Step 4: Commit**

```
git add index.html
git commit -m "feat: link PWA manifest and register service worker"
```

---

## Task 6: `start.js` tunnel wrapper + `npm run serve`

**Files:**
- Create: `start.js`
- Modify: `package.json`

No unit test — process spawning integration; verify manually by running `npm run serve`.

- [ ] **Step 1: Create `start.js`**

```javascript
const { spawn } = require('child_process');

const cf = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:8080'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let started = false;

function tryExtractUrl(text) {
  if (started) return;
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m) return;
  started = true;
  const url = m[0];
  console.log(`\n  Tunnel: ${url}\n`);
  const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: { ...process.env, COVEN_URL: url },
  });
  server.on('exit', code => process.exit(code ?? 0));
}

cf.stdout.on('data', d => tryExtractUrl(d.toString()));
cf.stderr.on('data', d => tryExtractUrl(d.toString()));

cf.on('exit', code => {
  if (!started) {
    console.error('cloudflared exited before providing a URL');
    process.exit(code ?? 1);
  }
});

process.on('SIGINT', () => {
  cf.kill();
  process.exit(0);
});
```

- [ ] **Step 2: Add `serve` script to `package.json`**

In the `"scripts"` block of `package.json`, add:

```json
"serve": "node start.js"
```

The full scripts block becomes:

```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "node --test test.js",
  "serve": "node start.js"
}
```

- [ ] **Step 3: Install `cloudflared` if not already present**

Download from https://github.com/cloudflare/cloudflared/releases and place the binary somewhere on your PATH (e.g. `C:\Windows\System32\cloudflared.exe` or anywhere in `$env:PATH`). Verify with:

```
cloudflared --version
```

Expected: prints a version string like `cloudflared version 2024.x.x`.

- [ ] **Step 4: Run `npm run serve` and verify**

```
npm run serve
```

Expected output (within ~5 seconds):

```
  Tunnel: https://some-words.trycloudflare.com

  COVEN altar is lit.  →  http://<your-LAN-ip>:8080/?side=left
```

- [ ] **Step 5: Verify the QR code shows the tunnel URL**

Open `http://localhost:8080` in a browser. The start screen QR code should now encode `https://some-words.trycloudflare.com`. Scan it with your phone (on any network) and confirm the page loads over HTTPS.

- [ ] **Step 6: Verify PWA install prompt on Android Chrome**

On your Android phone, open Chrome and navigate to the tunnel URL. After the page loads, Chrome should show an "Add to Home Screen" banner (may require a second visit or can be triggered manually via Chrome menu → Add to Home Screen). Confirm the app installs and opens in standalone mode (no browser chrome).

- [ ] **Step 7: Commit**

```
git add start.js package.json
git commit -m "feat: add start.js tunnel wrapper and npm run serve"
```

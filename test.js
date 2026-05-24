const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const http = require('http');
const { touchToWorld, start, httpServer, VW, VH, getPublicUrl } = require('./server');
const Simulation = require('./simulation');

test('Simulation.touchToWorld canonical boundary cases', () => {
  assert.equal(Simulation.touchToWorld('left', { x: 0, y: 0 }).x, 0);
  assert.equal(Simulation.touchToWorld('right', { x: 1, y: 1 }).x, Simulation.VW);
});

test('Simulation.makeWorld returns a fresh world centered', () => {
  const w = Simulation.makeWorld();
  assert.equal(w.ember.x, Simulation.VW / 2);
  assert.equal(w.ember.y, Simulation.VH / 2);
  assert.equal(w.pulse, 0);
  assert.equal(w.touch.left, null);
  assert.equal(w.touch.right, null);
});

test('Simulation.tick advances the ember and bounces off walls', () => {
  const w = Simulation.makeWorld();
  // place near the right wall, moving right fast
  w.ember.x = Simulation.VW - Simulation.R - 0.1;
  w.ember.vx = 200;
  w.ember.vy = 0;
  Simulation.tick(w, 1 / 60);
  // should have bounced off the wall — vx is now negative
  assert.ok(w.ember.vx < 0, `expected vx < 0 after bounce, got ${w.ember.vx}`);
  assert.ok(w.ember.x <= Simulation.VW - Simulation.R, 'ember stays inside');
});

test('Simulation.tick advances the pulse', () => {
  const w = Simulation.makeWorld();
  Simulation.tick(w, 1);
  // dt=1s with pulse-period=6s ⇒ pulse advances by ~1/6
  assert.ok(w.pulse > 0.15 && w.pulse < 0.18, `pulse=${w.pulse}`);
});

function getRoute(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// ---- coordinate math -------------------------------------------------

test('touchToWorld: null returns null', () => {
  assert.equal(touchToWorld('left', null), null);
  assert.equal(touchToWorld('right', null), null);
});

test('touchToWorld: left side — x=0 maps to world x=0', () => {
  const r = touchToWorld('left', { x: 0, y: 0 });
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
});

test('touchToWorld: left side — x=1 maps to world x=100 (seam)', () => {
  const r = touchToWorld('left', { x: 1, y: 0.5 });
  assert.equal(r.x, VW / 2);
  assert.equal(r.y, VH * 0.5);
});

test('touchToWorld: right side — x=0 maps to world x=100 (seam)', () => {
  const r = touchToWorld('right', { x: 0, y: 0 });
  assert.equal(r.x, VW / 2);
  assert.equal(r.y, 0);
});

test('touchToWorld: right side — x=1 maps to world x=200', () => {
  const r = touchToWorld('right', { x: 1, y: 1 });
  assert.equal(r.x, VW);
  assert.equal(r.y, VH);
});

test('touchToWorld: y is always world-height scaled', () => {
  const l = touchToWorld('left',  { x: 0.5, y: 0.25 });
  const r = touchToWorld('right', { x: 0.5, y: 0.25 });
  assert.equal(l.y, VH * 0.25);
  assert.equal(r.y, VH * 0.25);
});

// ---- integration smoke test ------------------------------------------

test('server broadcasts state within 100ms of connection', async () => {
  const { httpServer: srv, interval } = await start(0); // ephemeral port
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('no state received')), 2000);
      ws.on('message', (data) => {
        clearTimeout(timeout);
        const msg = JSON.parse(data);
        assert.equal(msg.type, 'state');
        assert.ok(typeof msg.ember.x === 'number', 'ember.x is a number');
        assert.ok(typeof msg.ember.y === 'number', 'ember.y is a number');
        assert.ok(msg.pulse >= 0 && msg.pulse < 1, 'pulse is in [0,1)');
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});

test('server records touch input from client message', async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  const { world } = require('./server');
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'input', side: 'left', active: true, x: 0.5, y: 0.5 }));
        // give the message handler a tick to process
        setTimeout(() => {
          clearTimeout(timeout);
          assert.deepEqual(world.touch.left, { x: 0.5, y: 0.5 });
          ws.close();
          resolve();
        }, 50);
      });
      ws.on('error', reject);
    });
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});

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

test('GET / contains iOS PWA meta tags + apple-touch-icon', async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    const { status, body } = await getRoute(port, '/');
    assert.equal(status, 200);
    // Standalone mode on iOS Safari
    assert.match(body, /name="apple-mobile-web-app-capable"[^>]*content="yes"/);
    // Black-translucent status bar so the dark aesthetic carries through
    assert.match(body, /name="apple-mobile-web-app-status-bar-style"/);
    // Home-screen icon (otherwise iOS shows a screenshot or default)
    assert.match(body, /rel="apple-touch-icon"/);
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});

test('GET / contains iOS install hint for non-standalone iOS users', async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    const { status, body } = await getRoute(port, '/');
    assert.equal(status, 200);
    // Hint element exists in the start screen
    assert.match(body, /id="ios-hint"/);
    // Client detects iOS via UA sniffing
    assert.match(body, /iPad\|iPhone\|iPod/);
    // Surfaces the actual user instruction
    assert.ok(body.includes('Add to Home Screen'));
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});

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

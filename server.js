/* =====================================================================
 * COVEN — Rite I: "Ember"
 * ---------------------------------------------------------------------
 * The desktop is the ALTAR (authoritative server). It owns the truth:
 * the ember's position lives here, physics ticks here. Phones are thin
 * clients — they send up their touch, they draw their slice of the world.
 *
 * Only positional data crosses the wire. No video, no heavy assets.
 *   server -> phones :  ember position + border pulse phase + both touches
 *   phones -> server :  this phone's touch (normalized 0..1)
 *
 * Two phones, hardcoded left/right (no detection yet). They form ONE
 * arena 200 wide x 100 tall (logical units). The seam sits at x=100.
 *   left  phone shows logical x [0..100]
 *   right phone shows logical x [100..200]
 * ===================================================================== */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = 8080;

// ---- The shared world (logical units, not pixels) -------------------
const VW = 200, VH = 100;          // arena size
const R = 6;                       // ember radius
const TICK = 1000 / 60;            // 60 Hz simulation

const world = {
  ember: { x: VW / 2, y: VH / 2, vx: 34, vy: 21 },  // px/sec-ish
  pulse: 0,                                          // border pulse phase 0..1
  // latest touch from each side, in LOCAL normalized coords (0..1)
  touch: { left: null, right: null },
};

// ---- HTTP: hand the same client file to every phone -----------------
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const HTML_PATH = path.join(__dirname, 'index.html');
let clientHtml = fs.readFileSync(HTML_PATH);

const MANIFEST = JSON.stringify({
  name: 'Coven',
  short_name: 'Coven',
  display: 'standalone',
  start_url: '/',
  theme_color: '#04060d',
  background_color: '#04060d',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
});

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#04060d"/>
  <circle cx="256" cy="256" r="120" fill="#2f7bff" opacity="0.12"/>
  <circle cx="256" cy="256" r="60" fill="#6ab4ff" opacity="0.5"/>
  <circle cx="256" cy="256" r="22" fill="#eaf3ff"/>
</svg>`;

const SW_JS = [
  "self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));",
  "self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));",
].join('\n');

// Generated once at startup; served at /qr.png so phones need no internet.
let qrBuffer = null;
QRCode.toBuffer(`http://${getLanIp()}:${PORT}`, {
  width: 148, margin: 2,
  color: { dark: '#9fd0ff', light: '#04060d' },
}).then(buf => { qrBuffer = buf; }).catch(() => {});

const httpServer = http.createServer((req, res) => {
  if (req.url === '/qr.png' && qrBuffer) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(qrBuffer);
    return;
  }
  if (req.url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    res.end(MANIFEST);
    return;
  }
  if (req.url === '/icon.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(ICON_SVG);
    return;
  }
  if (req.url === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(SW_JS);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(clientHtml);
});

// Hot-reload: when index.html changes on disk, refresh it and tell every client.
fs.watch(HTML_PATH, () => {
  try { clientHtml = fs.readFileSync(HTML_PATH); } catch {}
  const msg = JSON.stringify({ type: 'reload' });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
});

// ---- WebSocket: rides on the same port ------------------------------
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'input' && (msg.side === 'left' || msg.side === 'right')) {
      world.touch[msg.side] = msg.active ? { x: msg.x, y: msg.y } : null;
    }
  });
  ws.on('close', () => clients.delete(ws));
});

// Convert a side's local normalized touch (0..1) into world coords.
function touchToWorld(side, t) {
  if (!t) return null;
  const baseX = side === 'left' ? 0 : VW / 2;
  return { x: baseX + t.x * (VW / 2), y: t.y * VH };
}

// ---- The simulation loop — the heartbeat of the rite ----------------
function tick() {
  const now = Date.now();
  const dt = Math.min((now - tick.last) / 1000, 0.05); // seconds, clamped
  tick.last = now;
  const e = world.ember;

  // Touch = a repulsion field. Hold a finger down and you shove the ember.
  for (const side of ['left', 'right']) {
    const w = touchToWorld(side, world.touch[side]);
    if (!w) continue;
    const dx = e.x - w.x, dy = e.y - w.y;
    const d2 = dx * dx + dy * dy;
    const d = Math.sqrt(d2) || 0.0001;
    if (d < 55) {                       // radius of influence
      const force = Math.min(900 / (d2 + 25), 60); // capped inverse-square
      e.vx += (dx / d) * force * dt * 60;
      e.vy += (dy / d) * force * dt * 60;
    }
  }

  // Integrate.
  e.x += e.vx * dt;
  e.y += e.vy * dt;

  // Elastic bounce off the four outer walls.
  if (e.x < R) { e.x = R; e.vx = Math.abs(e.vx); }
  if (e.x > VW - R) { e.x = VW - R; e.vx = -Math.abs(e.vx); }
  if (e.y < R) { e.y = R; e.vy = Math.abs(e.vy); }
  if (e.y > VH - R) { e.y = VH - R; e.vy = -Math.abs(e.vy); }

  // Keep it lively: gentle drag + a floor/ceiling on speed.
  e.vx *= 0.999; e.vy *= 0.999;
  const sp = Math.hypot(e.vx, e.vy);
  const MIN = 28, MAX = 160;
  if (sp < MIN && sp > 0) { e.vx *= MIN / sp; e.vy *= MIN / sp; }
  if (sp > MAX) { e.vx *= MAX / sp; e.vy *= MAX / sp; }

  // Advance the border pulse (one full lap every ~6s).
  world.pulse = (world.pulse + dt / 6) % 1;

  // Broadcast the truth. Tiny payload — pure positional data.
  const payload = JSON.stringify({
    type: 'state',
    ember: { x: +e.x.toFixed(2), y: +e.y.toFixed(2) },
    pulse: +world.pulse.toFixed(4),
    touch: {
      left: touchToWorld('left', world.touch.left),
      right: touchToWorld('right', world.touch.right),
    },
    vw: VW, vh: VH, r: R,
  });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}
tick.last = Date.now();

function start(port = PORT) {
  const interval = setInterval(tick, TICK);
  return new Promise(resolve => {
    httpServer.listen(port, () => resolve({ httpServer, interval }));
  });
}

if (require.main === module) {
  start(PORT).then(() => {
    console.log(`\n  COVEN altar is lit.  →  http://<your-LAN-ip>:${PORT}/?side=left`);
    console.log(`                          http://<your-LAN-ip>:${PORT}/?side=right\n`);
  });
}

module.exports = { touchToWorld, start, httpServer, world, VW, VH, R };

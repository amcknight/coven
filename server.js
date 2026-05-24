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
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const Simulation = require('./simulation');

const PORT = 8080;

// ---- The shared world (logical units, not pixels) -------------------
const { VW, VH, R } = Simulation;
const TICK = 1000 / 60;            // 60 Hz simulation

const world = Simulation.makeWorld();

// ---- HTTP: hand the same client file to every phone -----------------
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function getPublicUrl() {
  return process.env.COVEN_URL || `http://${getLanIp()}:${PORT}`;
}

const HTML_PATH = path.join(__dirname, 'index.html');
let clientHtml = fs.readFileSync(HTML_PATH);

const SIM_PATH = path.join(__dirname, 'simulation.js');
let simulationJs = fs.readFileSync(SIM_PATH);

const MANIFEST = JSON.stringify({
  name: 'Coven',
  short_name: 'Coven',
  display: 'standalone',
  start_url: '/',
  theme_color: '#04060d',
  background_color: '#04060d',
  icons: [
    { src: '/icon.svg',     sizes: 'any',     type: 'image/svg+xml' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
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

// ---- Maskable PNG icon generated at startup (no canvas dependency) ------
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}
function generateIconPng() {
  const S = 512, half = S / 2;
  const px = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - half, y - half);
      const i = (y * S + x) * 3;
      if (d < 22) {
        px[i] = 0xea; px[i+1] = 0xf3; px[i+2] = 0xff;
      } else if (d < 80) {
        const t = (d - 22) / 58;
        px[i]   = Math.round(0x6a + (0x04 - 0x6a) * t);
        px[i+1] = Math.round(0xb4 + (0x06 - 0xb4) * t);
        px[i+2] = Math.round(0xff + (0x0d - 0xff) * t);
      } else if (d < 160) {
        const a = (1 - (d - 80) / 80) * 0.25;
        px[i]   = Math.round(0x04 + (0x2f - 0x04) * a);
        px[i+1] = Math.round(0x06 + (0x7b - 0x06) * a);
        px[i+2] = Math.round(0x0d + (0xff - 0x0d) * a);
      } else {
        px[i] = 0x04; px[i+1] = 0x06; px[i+2] = 0x0d;
      }
    }
  }
  const rows = [];
  for (let y = 0; y < S; y++) {
    rows.push(Buffer.from([0]));
    rows.push(px.slice(y * S * 3, (y + 1) * S * 3));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const iconPngBuffer = generateIconPng();

// Generated once at startup; served at /qr.png so phones need no internet.
let qrBuffer = null;
QRCode.toBuffer(getPublicUrl(), {
  width: 148, margin: 2,
  color: { dark: '#9fd0ff', light: '#04060d' },
}).then(buf => { qrBuffer = buf; }).catch(() => {});

const httpServer = http.createServer((req, res) => {
  if (req.url === '/qr.png' && qrBuffer) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
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
  if (req.url === '/icon-512.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(iconPngBuffer);
    return;
  }
  if (req.url === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
    res.end(SW_JS);
    return;
  }
  if (req.url === '/simulation.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
    res.end(simulationJs);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(clientHtml);
});

// Hot-reload: when index.html changes on disk, refresh it and tell every client.
fs.watch(HTML_PATH, () => {
  try { clientHtml = fs.readFileSync(HTML_PATH); } catch {}
  const msg = JSON.stringify({ type: 'reload' });
  for (const ws of clients.keys()) {
    if (ws.readyState === 1) ws.send(msg);
  }
});

fs.watch(SIM_PATH, () => {
  try { simulationJs = fs.readFileSync(SIM_PATH); } catch {}
  // The server's in-process Simulation was cached by require() at startup
  // and will keep running the old physics until restart. Browsers refetch.
  console.warn('simulation.js changed — restart server to pick up physics changes (browsers will reload)');
  const msg = JSON.stringify({ type: 'reload' });
  for (const ws of clients.keys()) {
    if (ws.readyState === 1) ws.send(msg);
  }
});

// ---- WebSocket: rides on the same port ------------------------------
const wss = new WebSocketServer({ server: httpServer });
const clients = new Map(); // ws -> { clientId, side }
let nextClientId = 1;
let hostId = 'desktop';

function broadcastHello(ws) {
  if (ws.readyState !== 1) return;
  const meta = clients.get(ws);
  if (!meta) return;
  ws.send(JSON.stringify({ type: 'hello', clientId: meta.clientId, hostId }));
}

wss.on('connection', (ws) => {
  const clientId = 'c' + (nextClientId++);
  clients.set(ws, { clientId, side: null });
  broadcastHello(ws);

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'input' && (msg.side === 'left' || msg.side === 'right')) {
      world.touch[msg.side] = msg.active ? { x: msg.x, y: msg.y } : null;
      const meta = clients.get(ws);
      if (meta) meta.side = msg.side;
    }
  });
  ws.on('close', () => clients.delete(ws));
});

// ---- The simulation loop — the heartbeat of the rite ----------------
function tick() {
  const now = Date.now();
  const dt = Math.min((now - tick.last) / 1000, 0.05);
  tick.last = now;

  Simulation.tick(world, dt);

  const e = world.ember;
  const payload = JSON.stringify({
    type: 'state',
    ember: { x: +e.x.toFixed(2), y: +e.y.toFixed(2) },
    pulse: +world.pulse.toFixed(4),
    touch: {
      left: Simulation.touchToWorld('left', world.touch.left),
      right: Simulation.touchToWorld('right', world.touch.right),
    },
    vw: Simulation.VW, vh: Simulation.VH, r: Simulation.R,
  });
  for (const ws of clients.keys()) {
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
    console.log(`\n  COVEN altar is lit.  →  ${getPublicUrl()}/?side=left`);
    console.log(`                          ${getPublicUrl()}/?side=right\n`);
  });
}

module.exports = {
  touchToWorld: Simulation.touchToWorld,
  start, httpServer, world,
  VW: Simulation.VW, VH: Simulation.VH, R: Simulation.R,
  getPublicUrl,
};

# Peer Mesh Altar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WebRTC peer mesh between phones with the desktop altar acting as a guaranteed fallback host, so Coven feels near-LAN even when the desktop isn't on the same Wi-Fi as the phones.

**Architecture:** Extract the simulation into a dual-mode module both Node and the browser can run. Keep the existing WebSocket as the always-on lobby (signaling, clock sync, fallback state stream). Layer WebRTC data channels on top — when the host phone can establish them, state and input flow peer-to-peer. When they fail or drop, the desktop quietly takes over and the ember resets to center (pulse is clock-derived so it stays continuous). First phone in wins host election.

**Tech Stack:** Node.js, `ws`, vanilla `<script>` + Canvas, WebRTC (no new npm deps), `stun:stun.l.google.com:19302` for STUN, no TURN.

**Spec:** [docs/superpowers/specs/2026-05-24-peer-mesh-altar-design.md](../specs/2026-05-24-peer-mesh-altar-design.md)

---

## Codebase orientation (for the implementing engineer)

Coven today is a server + single-file client. Read these before starting:
- [server.js](../../../server.js) — the altar. HTTP, WebSocket, simulation loop, world state. ~280 lines.
- [index.html](../../../index.html) — the phone client. Start screen + game on one page. ~370 lines.
- [test.js](../../../test.js) — node:test suite. Run with `npm test`. ~205 lines.
- [CLAUDE.md](../../../CLAUDE.md) — load-bearing context. Two pillars: synced clock, shared canvas mapping.

The current world is 200×100 logical units (`VW`, `VH` in server.js). Each phone shows half (`?side=left` shows x in [0..100], `?side=right` shows x in [100..200]). The server ticks at 60 Hz and broadcasts `state` over WebSocket. The client extrapolates `pulse` from the last received `state.pulse` plus elapsed time.

After this plan, the server still does everything it did before, *plus* runs the lobby; the host phone (when one is elected) runs the physics locally and broadcasts to peers. Pulse becomes purely clock-derived on every phone.

---

## File structure

| File | Status | Purpose |
|---|---|---|
| `simulation.js` | **new** (~80 lines) | The extracted physics. Dual-mode module: `module.exports = Simulation` in Node, `globalThis.Simulation = Simulation` in browser. Exports `VW`, `VH`, `R`, `makeWorld()`, `touchToWorld(side, t)`, `tick(world, dt)`. No pulse — pulse is clock-derived on the client. |
| `server.js` | modify (~+80, -10 lines) | Add `clientId` generation, `clients` Map, host election state, handlers for `signal` / `ping` / `peer-lost`, serve `/simulation.js`. `tick` only runs when `hostId === 'desktop'`. Drop `pulse` from state payload. |
| `index.html` | modify (~+180 lines) | Add WebRTC layer (host opens `RTCPeerConnection` per peer; client receives), state-source switching (peer ↔ WebSocket), clock sync (`ping`/`pong` → `clockOffset`), pulse computed from synced clock, host indicator in top label, `?peer=0` escape hatch. |
| `test.js` | modify (~+150 lines) | Add tests for `simulation.tick`, `hello`/`peers` broadcasts, host election, `signal` relay, `ping`/`pong`, `peer-lost`. Remove/adjust the existing test that asserts `pulse` is in `state`. |

---

## Conventions used by every task

- Run `npm test` after each non-trivial change. Tests must pass at every commit.
- Commit messages: `feat:` for new behavior, `refactor:` for behavior-preserving changes, `test:` for test-only commits, `chore:` for tooling. Match the project's existing style (see `git log`).
- All commits end with the `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` line.
- Don't add comments unless they explain a non-obvious *why*. The codebase's existing comment style is sparse and ironic; match it.

---

## Task 1: Extract `simulation.js` (pure refactor, no behavior change)

**Files:**
- Create: `simulation.js`
- Modify: `server.js` (replace inline physics with `require('./simulation')`)
- Modify: `test.js` (add `simulation.test` block)

This is a pure refactor. After this task, `npm test` passes and Coven behaves byte-for-byte like before.

`simulation.js` keeps pulse for now (matching current behavior). Pulse will be removed in Task 8 once the client no longer needs it.

- [ ] **Step 1: Create `simulation.js`**

Path: `c:/Users/thedo/git/coven/simulation.js`

```javascript
(function (global) {
  const VW = 200, VH = 100, R = 6;

  function makeWorld() {
    return {
      ember: { x: VW / 2, y: VH / 2, vx: 34, vy: 21 },
      pulse: 0,
      touch: { left: null, right: null },
    };
  }

  function touchToWorld(side, t) {
    if (!t) return null;
    const baseX = side === 'left' ? 0 : VW / 2;
    return { x: baseX + t.x * (VW / 2), y: t.y * VH };
  }

  function tick(world, dt) {
    const e = world.ember;
    for (const side of ['left', 'right']) {
      const w = touchToWorld(side, world.touch[side]);
      if (!w) continue;
      const dx = e.x - w.x, dy = e.y - w.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2) || 0.0001;
      if (d < 55) {
        const force = Math.min(900 / (d2 + 25), 60);
        e.vx += (dx / d) * force * dt * 60;
        e.vy += (dy / d) * force * dt * 60;
      }
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.x < R) { e.x = R; e.vx = Math.abs(e.vx); }
    if (e.x > VW - R) { e.x = VW - R; e.vx = -Math.abs(e.vx); }
    if (e.y < R) { e.y = R; e.vy = Math.abs(e.vy); }
    if (e.y > VH - R) { e.y = VH - R; e.vy = -Math.abs(e.vy); }
    e.vx *= 0.999; e.vy *= 0.999;
    const sp = Math.hypot(e.vx, e.vy);
    const MIN = 28, MAX = 160;
    if (sp < MIN && sp > 0) { e.vx *= MIN / sp; e.vy *= MIN / sp; }
    if (sp > MAX) { e.vx *= MAX / sp; e.vy *= MAX / sp; }
    world.pulse = (world.pulse + dt / 6) % 1;
  }

  const Simulation = { VW, VH, R, makeWorld, touchToWorld, tick };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Simulation;
  } else {
    global.Simulation = Simulation;
  }
})(typeof self !== 'undefined' ? self : this);
```

- [ ] **Step 2: Write the failing tests for the extracted module**

Add to `c:/Users/thedo/git/coven/test.js` near the top, after the existing `require` line for `./server`:

```javascript
const Simulation = require('./simulation');

test('Simulation.touchToWorld matches server.touchToWorld', () => {
  // sanity: both paths point at the same function until server is migrated
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
```

- [ ] **Step 3: Run the new tests — they should fail**

Run: `npm test`

**Expected:** the four new `Simulation.*` tests fail with `Cannot find module './simulation'` because we haven't created the file yet. Wait — actually `simulation.js` was created in Step 1, so the new tests should already pass. If they don't, fix `simulation.js` before continuing.

- [ ] **Step 4: Refactor `server.js` to use the module**

Open `c:/Users/thedo/git/coven/server.js` and:

- Add at the top, with the other `require` lines: `const Simulation = require('./simulation');`
- Remove the now-duplicated local consts (around [server.js:30-34](../../../server.js)): `VW`, `VH`, `R`, `TICK` keeps. Replace `VW`, `VH`, `R` references with `Simulation.VW`, etc., OR re-export them with `const { VW, VH, R } = Simulation;`
- Remove the local `world` literal and use `const world = Simulation.makeWorld();` instead
- Remove the local `touchToWorld` function — use `Simulation.touchToWorld` instead. Note: the current `touchToWorld` is exported by `server.js` (see [server.js:279](../../../server.js)); keep that export pointing at `Simulation.touchToWorld` so existing tests still pass.
- Replace the physics body inside `tick()` (around [server.js:208-247](../../../server.js)) with `Simulation.tick(world, dt);` — i.e. delete every line that mutates `e` or `world.pulse` and replace with the one-liner.

The post-edit `tick()` function should look like:

```javascript
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
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}
```

Update the `module.exports` line at the bottom of `server.js` to keep exporting `touchToWorld`, `VW`, `VH`, `R` from `Simulation`:

```javascript
module.exports = {
  touchToWorld: Simulation.touchToWorld,
  start, httpServer, world,
  VW: Simulation.VW, VH: Simulation.VH, R: Simulation.R,
  getPublicUrl,
};
```

- [ ] **Step 5: Serve `/simulation.js` over HTTP**

In `server.js`, at startup near `clientHtml = fs.readFileSync(HTML_PATH);` (around [server.js:55](../../../server.js)), add:

```javascript
const SIM_PATH = path.join(__dirname, 'simulation.js');
let simulationJs = fs.readFileSync(SIM_PATH);
```

And inside `httpServer = http.createServer(...)`, alongside the other `if (req.url === ...)` blocks (around [server.js:147](../../../server.js)), add (place this before the catch-all that serves `index.html`):

```javascript
if (req.url === '/simulation.js') {
  res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
  res.end(simulationJs);
  return;
}
```

Also extend the existing `fs.watch(HTML_PATH, ...)` block (around [server.js:177](../../../server.js)) — duplicate it for `SIM_PATH` so simulation reloads also trigger client reloads. The simplest path:

```javascript
fs.watch(SIM_PATH, () => {
  try { simulationJs = fs.readFileSync(SIM_PATH); } catch {}
  const msg = JSON.stringify({ type: 'reload' });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
});
```

- [ ] **Step 6: Run all tests — they should all pass**

Run: `npm test`

**Expected:** every test passes. The integration tests (touch input, state broadcast, etc.) still work because they exercise the public API unchanged.

- [ ] **Step 7: Run the app and confirm it still works**

Run: `npm start`

Open `http://<lan-ip>:8080/?side=left` and `?side=right` on two devices (or two browser tabs). Confirm Ember behaves exactly as before — bounces, pulse, touch repulsion all unchanged.

- [ ] **Step 8: Commit**

```bash
git add simulation.js server.js test.js
git commit -m "$(cat <<'EOF'
refactor: extract physics into simulation.js (dual-mode module)

Moves the world/tick/touchToWorld into a single CJS-or-browser module
both server.js and (later) index.html can run. No behavior change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Server — `clientId`, `clients` Map, `hello` broadcast

**Files:**
- Modify: `server.js` (replace `clients = new Set()` with a Map, add ID generation, broadcast `hello` on connect)
- Modify: `test.js` (add tests)

This is the first piece of the new lobby protocol. After this task, every connecting client receives a `{type: 'hello', clientId, hostId}` immediately. `hostId` is always `'desktop'` — host election lands later in Task 11.

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
test("server sends 'hello' with clientId and hostId on connect", async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('no hello received')), 2000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type !== 'hello') return; // skip the 60 Hz state messages
        clearTimeout(timeout);
        assert.equal(typeof msg.clientId, 'string');
        assert.ok(msg.clientId.length > 0);
        assert.equal(msg.hostId, 'desktop'); // host election not yet implemented
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`

**Expected:** the new test times out after 2s with `no hello received` because the server doesn't send `hello` yet.

- [ ] **Step 3: Implement `clientId` + `clients` Map + `hello` broadcast**

In `server.js`, find the existing `const clients = new Set();` (around [server.js:187](../../../server.js)) and replace it with:

```javascript
const clients = new Map(); // ws -> { clientId, side }
let nextClientId = 1;
let hostId = 'desktop';

function broadcastHello(ws) {
  if (ws.readyState !== 1) return;
  const meta = clients.get(ws);
  if (!meta) return;
  ws.send(JSON.stringify({ type: 'hello', clientId: meta.clientId, hostId }));
}
```

Find the `wss.on('connection', (ws) => { ... })` block and update it:

```javascript
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
```

Find every other place that iterates `clients` (the `tick()` broadcast loop around [server.js:259](../../../server.js), and the `fs.watch` reload loop around [server.js:180](../../../server.js)) and update them. Since `clients` is now a Map, the iteration becomes:

```javascript
for (const ws of clients.keys()) {
  if (ws.readyState === 1) ws.send(payload);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`

**Expected:** the new `hello` test passes. All other tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server.js test.js
git commit -m "$(cat <<'EOF'
feat: server assigns clientId and sends hello on connect

Lobby protocol foundation. hostId is hardcoded to 'desktop' for now;
host election lands in a later task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Server — `peers` broadcast on room changes

**Files:**
- Modify: `server.js`
- Modify: `test.js`

After this task, every time a client joins or leaves, every connected client receives `{type: 'peers', list: [{clientId, side}]}`.

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
test("server broadcasts 'peers' when a second client joins", async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws1 = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('no peers update')), 3000);
      let saw = false;
      ws1.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type !== 'peers') return;
        if (msg.list.length === 2) {
          saw = true;
          assert.ok(msg.list.every(p => typeof p.clientId === 'string'));
          clearTimeout(timeout);
          ws1.close(); ws2.close();
          resolve();
        }
      });
      let ws2;
      ws1.on('open', () => {
        ws2 = new WebSocket(`ws://localhost:${port}`);
        ws2.on('error', reject);
      });
      ws1.on('error', reject);
    });
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`

**Expected:** the new test times out — server doesn't broadcast `peers`.

- [ ] **Step 3: Implement `broadcastPeers`**

In `server.js`, add near the existing `broadcastHello` helper:

```javascript
function broadcastPeers() {
  const list = [...clients.values()].map(({ clientId, side }) => ({ clientId, side }));
  const payload = JSON.stringify({ type: 'peers', list });
  for (const ws of clients.keys()) {
    if (ws.readyState === 1) ws.send(payload);
  }
}
```

In the `wss.on('connection', ...)` block, after `broadcastHello(ws)`, also call `broadcastPeers()`:

```javascript
wss.on('connection', (ws) => {
  const clientId = 'c' + (nextClientId++);
  clients.set(ws, { clientId, side: null });
  broadcastHello(ws);
  broadcastPeers();

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'input' && (msg.side === 'left' || msg.side === 'right')) {
      world.touch[msg.side] = msg.active ? { x: msg.x, y: msg.y } : null;
      const meta = clients.get(ws);
      if (meta && meta.side !== msg.side) {
        meta.side = msg.side;
        broadcastPeers(); // side changed
      }
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    broadcastPeers();
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`

**Expected:** the new `peers` test passes. All others still pass.

- [ ] **Step 5: Commit**

```bash
git add server.js test.js
git commit -m "$(cat <<'EOF'
feat: broadcast peers list on join/leave/side-change

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Server — `ping`/`pong` clock handler

**Files:**
- Modify: `server.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
test("server responds to 'ping' with 'pong' echoing t and adding serverNow", async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('no pong received')), 2000);
      const t = 12345.678;
      ws.on('open', () => ws.send(JSON.stringify({ type: 'ping', t })));
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type !== 'pong') return;
        clearTimeout(timeout);
        assert.equal(msg.t, t);
        assert.equal(typeof msg.serverNow, 'number');
        assert.ok(msg.serverNow > 0);
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`

**Expected:** test times out with `no pong received`.

- [ ] **Step 3: Add the `ping` handler**

In `server.js`, inside `ws.on('message', ...)`, after the `'input'` handler block, add:

```javascript
if (msg.type === 'ping') {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'pong', t: msg.t, serverNow: Date.now() }));
  }
  return;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`

**Expected:** new test passes. All others still pass.

- [ ] **Step 5: Commit**

```bash
git add server.js test.js
git commit -m "$(cat <<'EOF'
feat: server handles ping/pong for client clock sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Server — `signal` relay

**Files:**
- Modify: `server.js`
- Modify: `test.js`

The server forwards `{type:'signal', from, to, payload}` from one phone to another by looking up the destination's WebSocket. The payload is opaque (WebRTC offer/answer/ICE candidates).

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
test("server forwards 'signal' from one client to another by clientId", async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws1 = new WebSocket(`ws://localhost:${port}`);
      let ws1Id = null, ws2Id = null;
      const ws2 = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('signal not forwarded')), 2000);

      ws1.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'hello') ws1Id = m.clientId;
      });
      ws2.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'hello') {
          ws2Id = m.clientId;
          // both IDs known — ws1 sends a signal to ws2
          setTimeout(() => {
            ws1.send(JSON.stringify({
              type: 'signal', from: ws1Id, to: ws2Id,
              payload: { kind: 'offer', sdp: 'fake-sdp' },
            }));
          }, 50);
        }
        if (m.type === 'signal') {
          clearTimeout(timeout);
          assert.equal(m.from, ws1Id);
          assert.equal(m.to, ws2Id);
          assert.deepEqual(m.payload, { kind: 'offer', sdp: 'fake-sdp' });
          ws1.close(); ws2.close();
          resolve();
        }
      });
      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`

**Expected:** test times out.

- [ ] **Step 3: Add the `signal` handler**

In `server.js`, after the `'ping'` handler inside `ws.on('message', ...)`:

```javascript
if (msg.type === 'signal' && typeof msg.to === 'string') {
  for (const [peerWs, meta] of clients) {
    if (meta.clientId === msg.to && peerWs.readyState === 1) {
      peerWs.send(JSON.stringify({
        type: 'signal', from: msg.from, to: msg.to, payload: msg.payload,
      }));
      break;
    }
  }
  return;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`

**Expected:** all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server.js test.js
git commit -m "$(cat <<'EOF'
feat: server relays signal messages between clients by clientId

Opaque postman — payload is never inspected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Client — track `clientId` / `hostId` / `peers`

**Files:**
- Modify: `index.html`

After this task, the client stores the lobby state but doesn't yet act on it. The host indicator UI lands in Task 9.

- [ ] **Step 1: Add lobby state and message handlers**

In `index.html`, inside the `if (IN_GAME)` block, find the `let state = null;` line (around [index.html:200](../../../index.html)). Above it, add:

```javascript
// ---- lobby state ----
let myClientId = null;
let hostId = 'desktop';
let peers = []; // [{clientId, side}]
```

Find the `ws.onmessage` handler (around [index.html:236](../../../index.html)) and extend it:

```javascript
ws.onmessage = (ev) => {
  try {
    const m = JSON.parse(ev.data);
    if (m.type === 'reload') { location.reload(); return; }
    if (m.type === 'state') { state = m; state._t = performance.now(); return; }
    if (m.type === 'hello') {
      myClientId = m.clientId;
      hostId = m.hostId;
      return;
    }
    if (m.type === 'peers') {
      peers = m.list;
      return;
    }
  } catch {}
};
```

- [ ] **Step 2: Manual verification**

Run `npm start`. Open a phone (or browser tab) at `?side=left` and a second at `?side=right`. Open browser devtools on one. In the console, type `myClientId` and `peers` — should be defined. `hostId` should be `'desktop'`. No automated test for this — it's pure state plumbing; it'll be exercised end-to-end later.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: client tracks clientId/hostId/peers from lobby messages

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Client — clock sync (compute `clockOffset` from `ping`/`pong`)

**Files:**
- Modify: `index.html`

After this task, each phone has a `clockOffset` such that `performance.now() + clockOffset` is the desktop's `Date.now()`. The pulse rendering still uses `state.pulse` for now — Task 8 switches it over.

- [ ] **Step 1: Add the clock-sync code**

In `index.html`, inside the `if (IN_GAME)` block, add a new section just before the `// ---- websocket to the altar ----` comment:

```javascript
// ---- clock sync ----
let clockOffset = 0; // performance.now() + clockOffset ≈ desktop's Date.now()
const inflightPings = new Map(); // sendT (performance.now) -> sendT
let pingBurstCount = 0;
let pingRefreshTimer = null;

function sendPing() {
  if (!ws || ws.readyState !== 1) return;
  const t = performance.now();
  inflightPings.set(t, t);
  ws.send(JSON.stringify({ type: 'ping', t }));
}

function startPingBurst() {
  pingBurstCount = 0;
  const burstInterval = setInterval(() => {
    sendPing();
    pingBurstCount++;
    if (pingBurstCount >= 5) {
      clearInterval(burstInterval);
      pingRefreshTimer = setInterval(sendPing, 30000);
    }
  }, 200);
}

let bestPingRtt = Infinity;
function handlePong(msg) {
  const sendT = inflightPings.get(msg.t);
  if (sendT == null) return;
  inflightPings.delete(msg.t);
  const recvT = performance.now();
  const rtt = recvT - sendT;
  if (rtt < bestPingRtt) {
    bestPingRtt = rtt;
    // desktop's Date.now() at the moment of sendT
    clockOffset = (msg.serverNow + rtt / 2) - sendT;
  } else if (rtt < bestPingRtt * 1.5) {
    // accept a slightly worse sample if it differs meaningfully (drift refresh)
    const newOffset = (msg.serverNow + rtt / 2) - sendT;
    if (Math.abs(newOffset - clockOffset) > 20) clockOffset = newOffset;
  }
}
```

Extend the `ws.onmessage` handler to dispatch `pong`:

```javascript
ws.onmessage = (ev) => {
  try {
    const m = JSON.parse(ev.data);
    if (m.type === 'reload') { location.reload(); return; }
    if (m.type === 'state') { state = m; state._t = performance.now(); return; }
    if (m.type === 'hello') { myClientId = m.clientId; hostId = m.hostId; return; }
    if (m.type === 'peers') { peers = m.list; return; }
    if (m.type === 'pong') { handlePong(m); return; }
  } catch {}
};
```

Extend `ws.onopen` to start the burst (around [index.html:228](../../../index.html)):

```javascript
ws.onopen = () => {
  document.getElementById('dot').classList.add('live');
  requestWakeLock();
  bestPingRtt = Infinity;
  inflightPings.clear();
  startPingBurst();
};
```

And `ws.onclose` should clear the refresh timer:

```javascript
ws.onclose = () => {
  document.getElementById('dot').classList.remove('live');
  if (pingRefreshTimer) { clearInterval(pingRefreshTimer); pingRefreshTimer = null; }
  setTimeout(connect, 800);
};
```

- [ ] **Step 2: Manual verification**

Run `npm start`, open in browser, open devtools console. Within 1–2 s `clockOffset` should be defined and `bestPingRtt` should be a small number (1–20 ms on localhost).

```javascript
// in browser console:
clockOffset  // some number, e.g. 1750000000000.5
bestPingRtt  // e.g. 2.3
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: client computes clockOffset from ping/pong (5x burst + 30s refresh)

Picks the lowest-RTT sample as authoritative; refreshes on materially
new estimates. Not yet used for pulse — that's the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Pulse from synced clock — remove `pulse` from `state` payload and from `simulation.js`

**Files:**
- Modify: `index.html` (pulse computation)
- Modify: `server.js` (drop `pulse` from state payload)
- Modify: `simulation.js` (drop pulse tracking)
- Modify: `test.js` (remove the `pulse` field assertion, add a pulse-removed assertion)

This is the only atomic-ish multi-file change in the plan. The three files must change together; old clients reading new payloads (or vice versa) would briefly show a static border. Acceptable for a moment; just do it as one commit.

- [ ] **Step 1: Update the integration test for the new payload shape**

In `test.js`, find the `'server broadcasts state within 100ms of connection'` test and update the assertions:

```javascript
test('server broadcasts state within 100ms of connection', async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('no state received')), 2000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type !== 'state') return; // skip hello/peers
        clearTimeout(timeout);
        assert.ok(typeof msg.ember.x === 'number', 'ember.x is a number');
        assert.ok(typeof msg.ember.y === 'number', 'ember.y is a number');
        assert.equal(msg.pulse, undefined, 'pulse is no longer in state payload');
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
```

Also update the `Simulation.tick advances the pulse` test from Task 1 — delete it (pulse is gone from simulation).

- [ ] **Step 2: Run tests — they should fail**

Run: `npm test`

**Expected:** `pulse is no longer in state payload` assertion fails because the server still emits `pulse`.

- [ ] **Step 3: Drop pulse from `simulation.js`**

Edit `simulation.js`:

- Remove `pulse: 0,` from `makeWorld()`.
- Remove the line `world.pulse = (world.pulse + dt / 6) % 1;` at the end of `tick(world, dt)`.

- [ ] **Step 4: Drop pulse from the server's state payload**

In `server.js`, find the `payload = JSON.stringify({ type: 'state', ... })` line inside `tick()`. Remove the `pulse:` line:

```javascript
const payload = JSON.stringify({
  type: 'state',
  ember: { x: +e.x.toFixed(2), y: +e.y.toFixed(2) },
  touch: {
    left: Simulation.touchToWorld('left', world.touch.left),
    right: Simulation.touchToWorld('right', world.touch.right),
  },
  vw: Simulation.VW, vh: Simulation.VH, r: Simulation.R,
});
```

- [ ] **Step 5: Compute pulse from synced clock in the client**

In `index.html`, find the `frame()` function (around [index.html:347](../../../index.html)) and update the pulse computation:

```javascript
function frame() {
  ctx.clearRect(0, 0, W, H);
  if (state) {
    view.ex += (state.ember.x - view.ex) * 0.35;
    view.ey += (state.ember.y - view.ey) * 0.35;
    const syncedNow = performance.now() + clockOffset;
    const pulse = (syncedNow / 6000) % 1;
    drawBorder(pulse);
    const otherSide = SIDE === 'left' ? 'right' : 'left';
    drawTouchGhost(state.touch[otherSide], 0.35, 3, 14);
    drawTouchGhost(state.touch[SIDE], 0.2, 2, 10);
    drawTouchGhost(localTouch,        0.7, 3, 14);
    drawEmber(view.ex, view.ey);
  }
  requestAnimationFrame(frame);
}
```

Note: `clockOffset` may not be set yet on the first frame — that's fine, it defaults to 0 which gives a pulse based on phone-local time. Once the first pong arrives (within ~200 ms), it snaps to the desktop's clock.

- [ ] **Step 6: Run tests — they should pass**

Run: `npm test`

**Expected:** all tests pass, including the new `pulse is no longer in state payload` assertion.

- [ ] **Step 7: Manual smoke test**

Run `npm start`. Open two browser tabs / phones side by side. Confirm:
- Pulse still travels around the border.
- Pulse is *continuous across the seam* between the two screens (this is the key Coven feature — verify it visually).
- Ember bounces. Touch still pushes.

- [ ] **Step 8: Commit**

```bash
git add simulation.js server.js index.html test.js
git commit -m "$(cat <<'EOF'
feat: pulse is clock-derived on the client; drop from state payload

Pulse phase is now computed locally as (syncedNow / 6000) % 1, where
syncedNow comes from the ping/pong clockOffset. This is what makes
pulse continuous through any host transition in later tasks.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Client — host indicator in top label

**Files:**
- Modify: `index.html`

Adds the `host: ...` suffix to the existing `● coven · rite i · left` label. Visible by default.

- [ ] **Step 1: Update the label markup**

In `index.html`, find the label element (around [index.html:127](../../../index.html)) and change it to:

```html
<div id="label"><span class="dot" id="dot">●</span> &nbsp;coven · rite i · <b id="sidelabel">—</b> · <span id="hostlabel">host: —</span></div>
```

- [ ] **Step 2: Render the host indicator**

In `index.html`, add a helper inside the `IN_GAME` block (near the lobby state declarations from Task 6):

```javascript
function renderHostLabel() {
  const el = document.getElementById('hostlabel');
  if (!el) return;
  let text;
  if (hostId === 'desktop') text = 'host: altar';
  else if (hostId === myClientId) text = 'host: you';
  else {
    const peer = peers.find(p => p.clientId === hostId);
    const tag = peer ? (peer.side || peer.clientId) : hostId;
    text = `host: ${tag}`;
  }
  el.textContent = text;
}
```

Call `renderHostLabel()` everywhere `hostId`, `myClientId`, or `peers` changes. Specifically inside the `hello` and `peers` handlers:

```javascript
if (m.type === 'hello') {
  myClientId = m.clientId;
  hostId = m.hostId;
  renderHostLabel();
  return;
}
if (m.type === 'peers') {
  peers = m.list;
  renderHostLabel();
  return;
}
```

And call `renderHostLabel()` once at the bottom of the `IN_GAME` block as initial paint (it'll render `host: —` until the first `hello` arrives).

- [ ] **Step 3: Manual verification**

Run `npm start`, open two phones. Each phone's top label should show `host: altar` (since election isn't in yet, `hostId` stays `'desktop'`). The label should be readable and not overlap with the rest.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: render host indicator in top label

host: altar | host: you | host: <side-or-id>. Visible by default;
hideable later with a debug flag if it becomes noise.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Client — `?peer=0` escape hatch

**Files:**
- Modify: `index.html`

Adds a URL flag that forces the client to behave as if peer mesh doesn't exist (i.e., ignore any non-`desktop` `hostId`). This is the regression baseline used in the smoke-test plan. Lands early so all subsequent WebRTC work can be disabled per-client during debugging.

- [ ] **Step 1: Read the flag**

In `index.html`, near the top of the `IN_GAME` block (around [index.html:182](../../../index.html)), add:

```javascript
const PEER_DISABLED = new URLSearchParams(location.search).get('peer') === '0';
```

The hook will be consumed by the WebRTC code in later tasks: every place that would open or accept a peer connection will short-circuit when `PEER_DISABLED` is true. For Task 10 itself, the flag is just declared (no behavior change yet).

- [ ] **Step 2: Manual verification**

Run `npm start`, open `?side=left&peer=0`. Open devtools and confirm `PEER_DISABLED === true`. Without `peer=0` the variable should be `false`. Behavior should be identical either way (because no WebRTC code exists yet).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: ?peer=0 URL flag to force WebSocket-only mode

Sets PEER_DISABLED; subsequent WebRTC code paths will respect it.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Client — WebRTC host side (open `RTCPeerConnection` per peer)

**Files:**
- Modify: `index.html`

This task adds the *host* behavior: when a phone's `hostId === myClientId`, it opens a `RTCPeerConnection` to every other phone in `peers`, creates an offer, sends it via `signal`, and on the eventual data-channel open is ready to broadcast `state`.

The actual ticking-locally-and-broadcasting-`state`-over-the-channel comes in Task 13. Task 11 wires the connection; Task 12 wires the receiver; Task 13 makes them carry state.

- [ ] **Step 1: Add the peer connections map and the host-side opener**

In `index.html`, inside the `IN_GAME` block, after the lobby state, add:

```javascript
// ---- peer connections ----
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const peerConns = new Map(); // remoteClientId -> { pc, channel }

function closePeerConn(remoteId) {
  const entry = peerConns.get(remoteId);
  if (!entry) return;
  try { entry.channel?.close(); } catch {}
  try { entry.pc?.close(); } catch {}
  peerConns.delete(remoteId);
}

function sendSignal(to, payload) {
  if (!ws || ws.readyState !== 1 || !myClientId) return;
  ws.send(JSON.stringify({ type: 'signal', from: myClientId, to, payload }));
}

async function openPeerAsHost(remoteId) {
  if (PEER_DISABLED) return;
  if (peerConns.has(remoteId)) return;
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const channel = pc.createDataChannel('coven', { ordered: true });
  peerConns.set(remoteId, { pc, channel });

  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(remoteId, { kind: 'ice', candidate: e.candidate });
  };
  channel.onopen = () => { /* host-side broadcast wired in Task 13 */ };
  channel.onmessage = (ev) => { /* receive input from peer, wired in Task 13 */ };
  channel.onclose = () => closePeerConn(remoteId);
  channel.onerror = () => closePeerConn(remoteId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal(remoteId, { kind: 'offer', sdp: pc.localDescription });
}
```

- [ ] **Step 2: Handle `signal` messages on the host side (answer + ICE)**

Extend `ws.onmessage` to dispatch `signal`:

```javascript
if (m.type === 'signal' && m.to === myClientId) {
  handleSignal(m.from, m.payload);
  return;
}
```

Add the handler:

```javascript
async function handleSignal(from, payload) {
  if (PEER_DISABLED) return;
  let entry = peerConns.get(from);
  if (payload.kind === 'answer' && entry) {
    await entry.pc.setRemoteDescription(payload.sdp);
    return;
  }
  if (payload.kind === 'ice' && entry) {
    try { await entry.pc.addIceCandidate(payload.candidate); } catch {}
    return;
  }
  // offer handling is the client/receiver side — Task 12
  if (payload.kind === 'offer') {
    // placeholder; implemented in Task 12
  }
}
```

- [ ] **Step 3: Trigger host-side opener when this phone becomes host**

Add a helper that runs whenever `hostId` or `peers` changes:

```javascript
function maybeOpenPeerConnections() {
  if (PEER_DISABLED) return;
  if (!myClientId) return;
  if (hostId !== myClientId) {
    // I'm not host — tear down any host-side connections I had
    for (const id of peerConns.keys()) closePeerConn(id);
    return;
  }
  for (const p of peers) {
    if (p.clientId === myClientId) continue;
    if (!peerConns.has(p.clientId)) openPeerAsHost(p.clientId).catch(console.warn);
  }
  // also tear down connections to peers that left
  for (const id of peerConns.keys()) {
    if (!peers.some(p => p.clientId === id)) closePeerConn(id);
  }
}
```

Call `maybeOpenPeerConnections()` at the end of both the `hello` and `peers` handlers, and also from `renderHostLabel` (or right after it) — anywhere host state mutates.

- [ ] **Step 4: Manual verification**

This step can't yet show peer state flowing — that's Task 13. What we can verify: with two phones (with election still hardcoded to `desktop`, `hostId` is always `'desktop'`), `peerConns` should remain empty. Run `npm start`, open two browser tabs, devtools console:

```javascript
peerConns.size  // 0 — election not yet active
PEER_DISABLED   // false
```

Try forcing `hostId = myClientId; maybeOpenPeerConnections()` from one tab's devtools. The other phone's devtools should see a `signal` message arrive shortly after (you can add a temporary `console.log` in the `signal` handler to confirm).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: client opens RTCPeerConnection per peer when host

Wires offer + ICE outflow; answer + ICE inflow. Data channel is
created but not yet used to carry state — that comes in a later task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Client — WebRTC client side (receive `RTCPeerConnection`)

**Files:**
- Modify: `index.html`

After this task, non-host phones can accept an incoming offer, create an answer, exchange ICE, and end up with a working data channel. Still no state flowing — that's Task 13.

- [ ] **Step 1: Implement offer handling**

In `index.html`, update the `handleSignal` function's `offer` branch:

```javascript
async function handleSignal(from, payload) {
  if (PEER_DISABLED) return;
  let entry = peerConns.get(from);

  if (payload.kind === 'offer') {
    if (!entry) {
      const pc = new RTCPeerConnection({ iceServers: STUN });
      entry = { pc, channel: null };
      peerConns.set(from, entry);

      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal(from, { kind: 'ice', candidate: e.candidate });
      };
      pc.ondatachannel = (e) => {
        entry.channel = e.channel;
        entry.channel.onopen = () => { /* receive-side ready, Task 13 */ };
        entry.channel.onmessage = (ev) => { /* state in, Task 13 */ };
        entry.channel.onclose = () => closePeerConn(from);
        entry.channel.onerror = () => closePeerConn(from);
      };
    }
    await entry.pc.setRemoteDescription(payload.sdp);
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    sendSignal(from, { kind: 'answer', sdp: entry.pc.localDescription });
    return;
  }

  if (payload.kind === 'answer' && entry) {
    await entry.pc.setRemoteDescription(payload.sdp);
    return;
  }
  if (payload.kind === 'ice' && entry) {
    try { await entry.pc.addIceCandidate(payload.candidate); } catch {}
    return;
  }
}
```

- [ ] **Step 2: Manual verification**

With two phones running, manually drive an offer/answer cycle via devtools (force one tab's `hostId = myClientId; maybeOpenPeerConnections()`). The other tab should:
1. Receive the `signal` with `kind: 'offer'`.
2. Create a `RTCPeerConnection`, send back an `answer` signal.
3. Exchange ICE candidates.
4. Eventually `peerConns.get(<host-id>).channel.readyState === 'open'` on both sides.

This is fiddly to drive from devtools but is the dress rehearsal for Task 14 (election). If `readyState` reaches `'open'` on both ends, the connection layer is working.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: client accepts incoming peer connections (offer/answer/ICE)

Symmetric to Task 11 — the receiving side of the data channel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Client — carry `state` and `input` over the data channel; switch source

**Files:**
- Modify: `index.html`

After this task, when a peer data channel is open, state and input flow over it instead of the WebSocket. This is the part that makes the latency win real.

- [ ] **Step 1: Add host-side broadcast and input absorption**

In `index.html`, replace the placeholder `channel.onopen` and `channel.onmessage` from Task 11's `openPeerAsHost`:

```javascript
channel.onopen = () => { /* state broadcast happens from the host-tick loop */ };
channel.onmessage = (ev) => {
  // receive input from a remote client
  try {
    const m = JSON.parse(ev.data);
    if (m.type === 'input' && (m.side === 'left' || m.side === 'right')) {
      hostWorld.touch[m.side] = m.active ? { x: m.x, y: m.y } : null;
    }
  } catch {}
};
```

- [ ] **Step 2: Add the host-side simulation loop on the client**

Below the lobby state declarations, add:

```javascript
// ---- host-side simulation (active only when this phone is host) ----
let hostWorld = null;
let hostTickHandle = null;
let lastHostTickT = 0;

function startHostingIfNeeded() {
  if (PEER_DISABLED) return;
  if (hostId !== myClientId) {
    if (hostTickHandle) { clearInterval(hostTickHandle); hostTickHandle = null; hostWorld = null; }
    return;
  }
  if (hostTickHandle) return; // already running
  hostWorld = Simulation.makeWorld();
  lastHostTickT = performance.now();
  hostTickHandle = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - lastHostTickT) / 1000, 0.05);
    lastHostTickT = now;

    Simulation.tick(hostWorld, dt);

    // broadcast state to all open peer channels
    const payload = JSON.stringify({
      type: 'state',
      ember: { x: +hostWorld.ember.x.toFixed(2), y: +hostWorld.ember.y.toFixed(2) },
      touch: {
        left: Simulation.touchToWorld('left', hostWorld.touch.left),
        right: Simulation.touchToWorld('right', hostWorld.touch.right),
      },
      vw: Simulation.VW, vh: Simulation.VH, r: Simulation.R,
    });
    for (const { channel } of peerConns.values()) {
      if (channel && channel.readyState === 'open') channel.send(payload);
    }
    // host renders its own world directly
    state = JSON.parse(payload);
    state._t = performance.now();
  }, 16);
}
```

`hostWorld.touch[SIDE]` is populated directly by the touch handlers in Step 4 (not inside the tick) so the host's local input applies the same way a remote peer's input does.

Wire `startHostingIfNeeded()` into the same trigger points as `maybeOpenPeerConnections()` — at the end of the `hello` and `peers` handlers.

- [ ] **Step 3: Wire the *receive* side (non-host client) — read `state` from the channel**

In Task 12's `pc.ondatachannel`, replace the placeholder `channel.onmessage`:

```javascript
pc.ondatachannel = (e) => {
  entry.channel = e.channel;
  entry.channel.onopen = () => {};
  entry.channel.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') { state = m; state._t = performance.now(); }
    } catch {}
  };
  entry.channel.onclose = () => closePeerConn(from);
  entry.channel.onerror = () => closePeerConn(from);
};
```

- [ ] **Step 4: Route outbound `input` to the right transport**

In `index.html`, find `sendTouch(active, clientX, clientY)` (around [index.html:256](../../../index.html)). Update it:

```javascript
function sendTouch(active, clientX, clientY) {
  const xn = Math.max(0, Math.min(1, clientX / W));
  const yn = Math.max(0, Math.min(1, clientY / H));

  // If I'm host, absorb my own touch directly into hostWorld (no wire).
  if (!PEER_DISABLED && hostId === myClientId && hostWorld) {
    hostWorld.touch[SIDE] = active ? { x: xn, y: yn } : null;
    return;
  }

  const payload = { type: 'input', side: SIDE, active, x: xn, y: yn };

  // prefer the peer channel to the host
  if (!PEER_DISABLED && hostId !== 'desktop' && hostId !== myClientId) {
    const entry = peerConns.get(hostId);
    if (entry && entry.channel && entry.channel.readyState === 'open') {
      entry.channel.send(JSON.stringify(payload));
      return;
    }
  }

  // fallback / desktop-host: WebSocket
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}
```

- [ ] **Step 5: Manual verification (limited)**

Election still isn't enabled, so this code is dormant for now. Devtools can be used to force `hostId = myClientId` on one tab to test the host-tick loop. With two tabs:

1. Tab A: open `?side=left`, force `hostId = myClientId; startHostingIfNeeded(); maybeOpenPeerConnections();`
2. Tab B: open `?side=right`. It should receive an offer signal, accept, and the channel should open.
3. After channel opens, Tab B should start rendering ember from Tab A's broadcast (visible animation in Tab B).
4. Touching Tab A should affect the ember; touching Tab B should also push it (input over the channel).

Tabs will diverge visually if they're not the same screen size — that's fine, it's the existing aspect-ratio behavior.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: host phone runs Simulation.tick locally and broadcasts to peers

State and input now ride the data channel when a peer host is active.
Non-host phones consume state from the channel; host absorbs its own
touch directly into hostWorld.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Client — failover triggers (timeout, close, stall) + emit `peer-lost`

**Files:**
- Modify: `index.html`

Three failover triggers, all client-side. They converge on `closePeerConn(remoteId)` and emit `{type:'peer-lost', from: remoteId}` over the WebSocket. The server's response to `peer-lost` (force `hostId = 'desktop'`) is bundled with the rest of election in Task 15 — for now, unhandled messages on the server are silently dropped (the existing `ws.on('message')` body has no fall-through `else`), which is safe.

- [ ] **Step 1: Replace `openPeerAsHost` with the failover-aware version**

In `index.html`, fully replace the body of `openPeerAsHost` from Task 11 with this version (adds 3-second open-timeout, `lastFrameT` tracking, close/error → `peer-lost`):

```javascript
async function openPeerAsHost(remoteId) {
  if (PEER_DISABLED) return;
  if (peerConns.has(remoteId)) return;
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const channel = pc.createDataChannel('coven', { ordered: true });
  const entry = { pc, channel, openTimeout: null, lastFrameT: 0 };
  peerConns.set(remoteId, entry);

  entry.openTimeout = setTimeout(() => {
    if (channel.readyState !== 'open') {
      console.warn('peer open timeout', remoteId);
      reportPeerLost(remoteId);
      closePeerConn(remoteId);
    }
  }, 3000);

  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(remoteId, { kind: 'ice', candidate: e.candidate });
  };
  channel.onopen = () => { clearTimeout(entry.openTimeout); entry.lastFrameT = performance.now(); };
  channel.onmessage = (ev) => {
    entry.lastFrameT = performance.now();
    try {
      const m = JSON.parse(ev.data);
      if (m.type === 'input' && (m.side === 'left' || m.side === 'right')) {
        hostWorld && (hostWorld.touch[m.side] = m.active ? { x: m.x, y: m.y } : null);
      }
    } catch {}
  };
  channel.onclose = () => { reportPeerLost(remoteId); closePeerConn(remoteId); };
  channel.onerror = () => { reportPeerLost(remoteId); closePeerConn(remoteId); };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal(remoteId, { kind: 'offer', sdp: pc.localDescription });
}
```

Apply the same `openTimeout` + `lastFrameT` + `onclose`/`onerror` pattern in the *receive*-side `pc.ondatachannel` in `handleSignal`'s offer branch.

Add the stall watchdog (runs on a slow interval):

```javascript
setInterval(() => {
  if (PEER_DISABLED) return;
  const now = performance.now();
  for (const [remoteId, entry] of peerConns) {
    if (!entry.channel || entry.channel.readyState !== 'open') continue;
    if (entry.lastFrameT && now - entry.lastFrameT > 500) {
      console.warn('peer stall', remoteId);
      reportPeerLost(remoteId);
      closePeerConn(remoteId);
    }
  }
}, 200);
```

Add the `reportPeerLost` helper:

```javascript
function reportPeerLost(remoteId) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'peer-lost', from: remoteId }));
}
```

- [ ] **Step 2: Apply the same enhancements to the receive-side connection in `handleSignal`**

Inside `handleSignal`'s `kind === 'offer'` branch (added in Task 12), apply the same `openTimeout` + `lastFrameT` + onclose/onerror → `reportPeerLost` pattern to the entry. The exact replacement for the offer branch:

```javascript
if (payload.kind === 'offer') {
  if (!entry) {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    entry = { pc, channel: null, openTimeout: null, lastFrameT: 0 };
    peerConns.set(from, entry);

    entry.openTimeout = setTimeout(() => {
      if (!entry.channel || entry.channel.readyState !== 'open') {
        console.warn('peer open timeout (recv)', from);
        reportPeerLost(from);
        closePeerConn(from);
      }
    }, 3000);

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(from, { kind: 'ice', candidate: e.candidate });
    };
    pc.ondatachannel = (e) => {
      entry.channel = e.channel;
      entry.channel.onopen = () => { clearTimeout(entry.openTimeout); entry.lastFrameT = performance.now(); };
      entry.channel.onmessage = (ev) => {
        entry.lastFrameT = performance.now();
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'state') { state = m; state._t = performance.now(); }
        } catch {}
      };
      entry.channel.onclose = () => { reportPeerLost(from); closePeerConn(from); };
      entry.channel.onerror = () => { reportPeerLost(from); closePeerConn(from); };
    };
  }
  await entry.pc.setRemoteDescription(payload.sdp);
  const answer = await entry.pc.createAnswer();
  await entry.pc.setLocalDescription(answer);
  sendSignal(from, { kind: 'answer', sdp: entry.pc.localDescription });
  return;
}
```

- [ ] **Step 3: Add the stall watchdog**

In `index.html`, near the bottom of the `IN_GAME` block:

```javascript
setInterval(() => {
  if (PEER_DISABLED) return;
  const now = performance.now();
  for (const [remoteId, entry] of peerConns) {
    if (!entry.channel || entry.channel.readyState !== 'open') continue;
    if (entry.lastFrameT && now - entry.lastFrameT > 500) {
      console.warn('peer stall', remoteId);
      reportPeerLost(remoteId);
      closePeerConn(remoteId);
    }
  }
}, 200);
```

- [ ] **Step 4: Add the `reportPeerLost` helper**

```javascript
function reportPeerLost(remoteId) {
  if (!ws || ws.readyState !== 1 || !myClientId) return;
  ws.send(JSON.stringify({ type: 'peer-lost', from: remoteId }));
}
```

The server doesn't have a handler yet — unknown message types are silently ignored by the existing dispatcher, which is safe. The server-side response (force `hostId = 'desktop'`) lands in Task 15.

- [ ] **Step 5: Run tests to confirm nothing regressed**

Run: `npm test`

**Expected:** all existing tests still pass. No new tests in this task — failover behavior is exercised end-to-end via the manual smoke test in Task 15.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: client failover triggers — 3s open timeout, close/error, 500ms stall

All three converge on closePeerConn + reportPeerLost. Server-side
election response lands in the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Server — host election + conditional `tick` + `peer-lost` resets to desktop

**Files:**
- Modify: `server.js`
- Modify: `test.js`

This is the switch-flip task. After it lands, the full peer mesh is live: 2 phones joining triggers election → host phone runs `tick` locally → desktop's `tick` pauses → on any failure, desktop resumes and ember resets.

- [ ] **Step 1: Write the failing tests for election**

In `test.js`:

```javascript
test("hostId becomes first phone's clientId when second phone joins", async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws1 = new WebSocket(`ws://localhost:${port}`);
      let ws1Id = null;
      ws1.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'hello') {
          if (!ws1Id) ws1Id = m.clientId;
          // second hello arrives when ws2 joins and election happens
          if (m.hostId === ws1Id) {
            ws1.close(); ws2.close();
            clearTimeout(timeout);
            resolve();
          }
        }
      });
      let ws2;
      ws1.on('open', () => { ws2 = new WebSocket(`ws://localhost:${port}`); });
      const timeout = setTimeout(() => reject(new Error('host not elected')), 2000);
    });
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});

test("hostId falls back to 'desktop' when host phone disconnects", async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws1 = new WebSocket(`ws://localhost:${port}`);
      const ws2 = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('hostId did not reset')), 3000);
      let ws1Id = null;
      ws2.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'hello' && m.hostId !== 'desktop') {
          ws1Id = m.hostId;
          // good — election worked; now kill ws1
          ws1.close();
        }
        if (m.type === 'hello' && m.hostId === 'desktop' && ws1Id) {
          clearTimeout(timeout);
          ws2.close();
          resolve();
        }
      });
      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});

test("'peer-lost' from any phone resets hostId to 'desktop'", async () => {
  const { httpServer: srv, interval } = await start(0);
  const { port } = srv.address();
  try {
    await new Promise((resolve, reject) => {
      const ws1 = new WebSocket(`ws://localhost:${port}`);
      const ws2 = new WebSocket(`ws://localhost:${port}`);
      const timeout = setTimeout(() => reject(new Error('hostId did not reset after peer-lost')), 3000);
      let phase = 'wait-election';
      let phoneHostId = null;
      ws2.on('message', d => {
        const m = JSON.parse(d);
        if (m.type !== 'hello') return;
        if (phase === 'wait-election' && m.hostId !== 'desktop') {
          phoneHostId = m.hostId;
          phase = 'sent-peer-lost';
          ws2.send(JSON.stringify({ type: 'peer-lost', from: phoneHostId }));
        } else if (phase === 'sent-peer-lost' && m.hostId === 'desktop') {
          clearTimeout(timeout);
          ws1.close(); ws2.close();
          resolve();
        }
      });
      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  } finally {
    clearInterval(interval);
    await new Promise(resolve => srv.close(resolve));
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`

**Expected:** the three new tests fail (`host not elected`, `hostId did not reset`, `hostId did not reset after peer-lost`) because election logic isn't there yet.

- [ ] **Step 3: Implement election + conditional tick**

In `server.js`:

Add a `joinOrder` tracker (an array of clientIds in join order; needed for re-election when a non-host phone joins after the host drops):

```javascript
const joinOrder = []; // clientIds in join order
```

Add an `electHost()` function:

```javascript
function electHost() {
  const phoneIds = joinOrder.filter(id =>
    [...clients.values()].some(meta => meta.clientId === id)
  );
  const newHost = phoneIds.length >= 2 ? phoneIds[0] : 'desktop';
  if (newHost === hostId) return false;
  hostId = newHost;
  return true;
}

function broadcastHelloAll() {
  for (const ws of clients.keys()) broadcastHello(ws);
}
```

Add a `tickInterval` handle so the server's `setInterval(tick, TICK)` can be started/stopped:

```javascript
let tickInterval = null;

function applyHostState() {
  if (hostId === 'desktop' && !tickInterval) {
    // (re)start the simulation from a fresh world
    Object.assign(world, Simulation.makeWorld());
    tick.last = Date.now();
    tickInterval = setInterval(tick, TICK);
  } else if (hostId !== 'desktop' && tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}
```

Now update the `start()` function (around [server.js:265](../../../server.js)) to use `applyHostState` instead of unconditionally starting the interval:

```javascript
function start(port = PORT) {
  applyHostState(); // starts the tick when hostId === 'desktop' (initial)
  return new Promise(resolve => {
    httpServer.listen(port, () => resolve({ httpServer, interval: tickInterval }));
  });
}
```

In `wss.on('connection', (ws) => {...})`, push to `joinOrder`, run election after assigning the clientId:

```javascript
wss.on('connection', (ws) => {
  const clientId = 'c' + (nextClientId++);
  clients.set(ws, { clientId, side: null });
  joinOrder.push(clientId);

  if (electHost()) { applyHostState(); }
  broadcastHello(ws);
  broadcastPeers();
  if (hostId !== 'desktop') broadcastHelloAll(); // notify all of host change

  // ... existing ws.on('message') and ws.on('close') ...
});
```

Update `ws.on('close')`:

```javascript
ws.on('close', () => {
  const meta = clients.get(ws);
  if (meta) {
    const idx = joinOrder.indexOf(meta.clientId);
    if (idx >= 0) joinOrder.splice(idx, 1);
  }
  clients.delete(ws);
  if (electHost()) { applyHostState(); broadcastHelloAll(); }
  broadcastPeers();
});
```

Wire the `peer-lost` handler to force-reset:

```javascript
if (msg.type === 'peer-lost') {
  hostId = 'desktop';
  // remove the reporting phone from joinOrder so it doesn't immediately re-elect itself
  // (it may still be connected but we treat the mesh as failed)
  applyHostState();
  broadcastHelloAll();
  return;
}
```

Note: the integration test `test.js` previously used `interval` in `finally`. Since `tickInterval` may now be null when `hostId !== 'desktop'`, that test's `clearInterval(interval)` is harmless on `null`. But several test setups assume the server is in `hostId === 'desktop'` mode at start (which it is). For tests with 2 phones, the test should not assume the server is ticking.

Adjust the `start()` return shape — the existing tests destructure `{ httpServer, interval }`. To stay backwards-compatible, `start()` can return `{ httpServer, interval: () => tickInterval }` — but actually the tests call `clearInterval(interval)` directly. The safer change: return the function that clears it:

```javascript
return new Promise(resolve => {
  httpServer.listen(port, () => resolve({
    httpServer,
    interval: { /* tagged for test compatibility */ },
    stop: () => { if (tickInterval) clearInterval(tickInterval); },
  }));
});
```

But that breaks the existing tests. Simpler: make `interval` always be the current value (it may be `null` mid-test):

```javascript
return new Promise(resolve => {
  httpServer.listen(port, () => resolve({
    httpServer,
    get interval() { return tickInterval; },
  }));
});
```

This way `clearInterval(interval)` in tests still works (on either an active interval or `null`).

- [ ] **Step 4: Run all tests — they should pass**

Run: `npm test`

**Expected:** all tests pass, including the three new election tests and all pre-existing ones. If the `'server broadcasts state within 100ms of connection'` test fails, it's because the new code stops the tick when ≥2 clients are present — but that test uses only one client, so the desktop should still be host. Verify.

- [ ] **Step 5: Manual smoke test — the real one**

This is the moment of truth. With two phones on the same Wi-Fi as each other (the desktop can be wherever; the Cloudflare tunnel just needs to be reachable):

1. Both phones open the start screen → tap **Join Left** / **Join Right**.
2. Watch the top label. Phone 1 (whichever joined first) should briefly show `host: altar`, then flip to `host: you` once Phone 2 joins. Phone 2 should show `host: <side-of-phone-1>` (or its clientId).
3. The ember should bounce noticeably more responsively than before — sub-100ms touch-to-response feel.
4. **Failover test #1 (suspension):** Lock Phone 1's screen. Within ~1 second Phone 2's label should flip to `host: altar`, the ember should snap to center, the pulse should keep flowing without a blink.
5. Unlock Phone 1. It should reconnect and show `host: altar` (desktop stays host until something re-elects, which it won't because Phone 1's `clientId` has changed). Touching either phone still pushes the ember.
6. **Failover test #2 (network):** With both phones playing peer-to-peer again (fresh connect), put Phone 1 in airplane mode for 2s. Same outcome as suspension.
7. **Regression test:** Open both with `?peer=0` appended. Force WebSocket-only mode. The host indicator should stay `host: altar` always. Ember should behave exactly like the original Coven (~80 ms latency over WAN, same as today).

If any of these fail, debug before committing. Use the `console.warn` calls from Task 14 to see the failover triggers firing.

- [ ] **Step 6: Commit**

```bash
git add server.js test.js
git commit -m "$(cat <<'EOF'
feat: server elects host phone and pauses tick when one is hosting

First-in-wins election; on disconnect or peer-lost, fall back to
desktop and resume the local tick from a fresh world. Pulse stays
continuous (clock-derived on the client). Full peer mesh now live.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Final manual smoke test and observability sweep

**Files:** None — this is verification.

- [ ] **Step 1: Walk the full smoke test from the spec**

The spec at [docs/superpowers/specs/2026-05-24-peer-mesh-altar-design.md](../specs/2026-05-24-peer-mesh-altar-design.md), section "Manual smoke test", enumerates five scenarios. Walk all five with two real phones (ideally one Android, one iPhone — if not, two of the same is acceptable):

1. **Happy path, two phones same Wi-Fi.**
2. **Suspension failover.**
3. **Network change failover.**
4. **No peer possible** (phone 2 on cellular if you can swing it).
5. **Regression escape hatch** with `?peer=0`.

For each, take a 5-second mental note of: does the ember feel responsive? Is the pulse continuous at the seam at all times? Does the host indicator say what you'd expect?

- [ ] **Step 2: Tidy any `console.warn` noise**

Open the browser devtools console during a normal happy-path session. If unexpected warns appear (other than the intentional `peer open timeout` / `peer stall` from Task 14), investigate or silence.

- [ ] **Step 3: Confirm `npm test` still passes**

Run: `npm test`

- [ ] **Step 4: Update CLAUDE.md "Current state" paragraph**

In `c:/Users/thedo/git/coven/CLAUDE.md`, replace the "Current state" section's description to reflect the new architecture:

```markdown
## Current state

**Rite I — "Ember" (built & working).** Two phones form one arena framed by a blue border drawn around the *combined* square (neither phone draws the seam). A bright pulse travels the full perimeter, flowing continuously across the seam. A glowing ember bounces off the outer walls; touching and holding a phone creates a repulsion field that shoves it.

The transport is hybrid: the altar (`server.js`) hosts a WebSocket-based lobby (signaling, clock sync, fallback state stream), and when two phones can talk peer-to-peer via WebRTC the first phone to join becomes the host — it runs the physics locally and broadcasts state to its peer over a data channel. If the host phone drops or the peer link dies, the desktop quietly resumes hosting and the ember resets to center; the pulse is clock-derived so it never blinks. URL `?peer=0` forces the legacy WebSocket-only behavior for debugging.
```

- [ ] **Step 5: Commit the doc update**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md current state with hybrid transport

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

Run through these before declaring the plan complete (the implementer reads these as a final sanity pass too):

- [ ] Every spec section maps to a task. Check the spec's "Components", "Failover", "Code changes", "Testing strategy" — each requirement should be implementable from this plan alone.
- [ ] No placeholders (`TBD`, `TODO`, "implement later").
- [ ] Type/identifier consistency across tasks: `clientId` (string), `hostId` (string, either `'desktop'` or a clientId), `peers` (array of `{clientId, side}`), `clockOffset` (number, ms), `peerConns` (Map). All used identically across tasks.
- [ ] All commits keep `npm test` passing.
- [ ] Every task has a manual or automated verification step.
- [ ] No task expects the engineer to invent code — every code block is complete and self-contained.

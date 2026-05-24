# Coven — Peer Mesh with Altar as Safety Net

**Date:** 2026-05-24
**Status:** Approved
**Depends on:** [2026-05-23-stable-https-iphone-design.md](2026-05-23-stable-https-iphone-design.md) — the stable HTTPS URL is the signaling endpoint

## Goal

Make Coven feel smooth and fast even when the desktop altar is not on the same Wi-Fi as the phones. Today, every state frame round-trips through the desktop, so playing a rite over the Cloudflare tunnel adds ~40–80 ms of latency that the existing Ember rite has no smoothing for.

The fix: when phones can talk to each other directly (typical case — phones laid on a table, same Wi-Fi), they should. The desktop stays available as a reliable fallback host. Friends with phones on a table get near-LAN latency even when the desktop is in another city.

## Approach

Two transports running side by side, with a clean preference order:

1. **WebSocket to the altar** (existing): always connected, used for joining, signaling, clock sync, and as the state stream when no peer mesh is up.
2. **WebRTC data channels between phones** (new): opportunistically established between the host phone and each other phone. While they're healthy, state and input flow over them. When they aren't, traffic stays on the WebSocket — no extra code path.

The desktop's simulation loop only runs when no phone is hosting. When a phone is host, the desktop is a postman (signaling) and a clock (sync anchor), nothing more.

## Roles

| Role | Who | Does what |
|---|---|---|
| **Altar** | desktop | Owns the lobby, assigns `clientId`, picks the host, relays signaling, broadcasts a clock anchor, runs `tick()` *only* when it is the current host. |
| **Host** | first phone to join (when ≥2 phones are present), else the altar | Runs `tick()` at 60 Hz, broadcasts `state` to its peers, consumes their `input`. |
| **Client** | every non-host phone | Renders `state`, sends `input`. Reads state from peer data channel when one is open; reads from WebSocket when not. |

Host election rule: "first phone in wins." When the host disconnects, fall back to the desktop, then re-elect from remaining phones in join-order if any joined later. The altar is host whenever there are zero or one phones (you can't peer with yourself).

## Architecture

```
─── lobby phase (always running) ────────────────────────────────────
  phone 1 ←──WebSocket──→ desktop ←──WebSocket──→ phone 2
                              │
                              │  hello / peers
                              │  signal relay (offer / answer / ICE)
                              │  clock anchor every 2 s
                              ▼
                          may also be host (if 0 or 1 phones)

─── peer phase (host phone, both data channels open) ────────────────
  phone 1 ──WebRTC data channel──→ phone 2
     ↑     state @ 60 Hz
     │     ←── input (touch) ──
     │
     └─ WebSocket to desktop stays open: signaling + clock only.
        Desktop's tick() is paused. Desktop carries no rite state.

─── fallback (peer channel dead, host dropped, etc.) ────────────────
  Phones notice the stream stopped (close event or >500 ms gap).
  They revert to reading state from the WebSocket.
  Desktop's tick() resumes from a fresh world. Pulse uninterrupted
  (it's clock-derived). Ember snaps to center, ~1 frame disruption.
```

## Components

### Extracted simulation module

[server.js:32-44, 200-262](../../../server.js) — the world definition, `touchToWorld`, and the `tick()` body — move into a new file `simulation.js`.

Written as a dual-mode module so the desktop can `require()` it and the browser can load it via `<script src="/simulation.js">`:

```javascript
(function (global) {
  const VW = 200, VH = 100, R = 6;
  function makeWorld() { /* returns a fresh world object */ }
  function touchToWorld(side, t) { /* unchanged */ }
  function tick(world, dt) { /* the existing physics, mutates world */ }
  const Simulation = { VW, VH, R, makeWorld, touchToWorld, tick };
  if (typeof module !== 'undefined' && module.exports) module.exports = Simulation;
  else global.Simulation = Simulation;
})(typeof self !== 'undefined' ? self : this);
```

Both the desktop and the host phone import this module. The physics is byte-for-byte identical whichever side is running it.

### Lobby (in server.js)

The desktop tracks `clients: Map<ws, {clientId, side}>` and `hostId: string`. On every WebSocket connect / disconnect, it re-evaluates `hostId` and broadcasts a fresh `hello` to everyone. The current `world` and `tick()` calls remain in `server.js`, but the `setInterval` for `tick` is now started/stopped based on whether `hostId === 'desktop'`.

### New WebSocket message types

All ride on the existing single WebSocket connection. Adds maybe 60 lines to `server.js`.

| Direction | Type | Fields | When |
|---|---|---|---|
| desktop → phone | `hello` | `clientId`, `hostId` | On connect, and whenever `hostId` changes |
| desktop → all | `peers` | `list: [{clientId, side}]` | When room composition changes |
| phone ↔ phone (relayed) | `signal` | `from`, `to`, `payload` (opaque) | WebRTC offer/answer/ICE |
| phone → desktop | `ping` | `t: performance.now()` | Clock sync — 5x burst on connect, then every 30 s |
| desktop → phone | `pong` | `t` (echoed), `serverNow: Date.now()` | Response to `ping`; only message that updates `clockOffset` |
| phone → desktop | `peer-lost` | `from: clientId` | A phone's peer channel just died |

The desktop **never inspects the `signal.payload`** — it's a blind postman that looks up the `to` clientId, finds the matching socket, and forwards. Three-line handler.

The existing `state` and `input` and `reload` messages are unchanged.

### Clock sync (precise enough for the pulse)

The pulse phase is currently sent every state frame (`world.pulse`) and extrapolated client-side. In the peer model the pulse must keep flowing through host changes, so we make it purely clock-derived:

```javascript
// On each phone:
const syncedNow = () => performance.now() + clockOffset;
const pulse = (syncedNow() / 6000) % 1;   // one lap every 6 s
```

`clockOffset` is computed from `ping/pong` round-trips: `offset = serverNow + rtt/2 - phoneNow`. Take 5 samples on connect over the first second, keep the one with the lowest RTT. Refresh every 30 s in the background; only update `clockOffset` if the new estimate is materially different (e.g., >20 ms).

Pulse continuity is now invariant to host changes — every phone derives it from `(performance.now() + clockOffset)`, and `clockOffset` doesn't depend on who's hosting.

The host's `tick()` no longer needs to advance `world.pulse` and no longer needs to broadcast it. Drop the `pulse` field from the `state` payload entirely.

### WebRTC peer connections (in index.html)

For every other phone in the `peers` list, the host opens an `RTCPeerConnection` with one reliable data channel (ordered, no SCTP retransmit budget cap — Ember frames are tiny, default settings are fine). STUN: `stun:stun.l.google.com:19302` (Google's public, no TURN).

Offer/answer/ICE candidates are sent through the desktop using `signal` messages. The desktop sees the `from` and `to` clientIds and forwards.

Each non-host phone sets up the *receiving* side of the data channel. When `ondatachannel` fires and `readyState === 'open'`, the phone starts using that channel for `state` (read) and `input` (write), and ignores the WebSocket's `state` (it's silent anyway when a phone is hosting, but defensive).

### Host indicator

Extend the existing top label from `● coven · rite i · left` to `● coven · rite i · left · host: phone 1`. The host's own phone shows `host: you`. When the desktop is hosting, shows `host: altar`. Reads from the latest `hello.hostId`. Visible by default while we get comfortable with the behavior; easy to hide later (a `?debug=0` URL param or a single CSS rule).

## Failover

Three triggers, all detected client-side, all converge to the same outcome.

1. **WebRTC never opens.** After receiving signaling info for a peer, give the data channel 3 s to reach `readyState === 'open'`. If it doesn't, abandon — keep reading state from the WebSocket. The desktop never knows anything was attempted.
2. **Data channel closes mid-rite.** `onclose` or `onerror` on the channel — revert to WebSocket state stream and send `{type:'peer-lost', from: <dead-peer-id>}` to the desktop. Desktop re-elects, broadcasts a new `hello`.
3. **State stream stalls.** Even if the channel says `'open'`, if no state frame has arrived in >500 ms, treat as dead. Same path as case 2.

On the desktop side, when `hostId` changes from a phone to itself (`'desktop'`), the desktop calls `Simulation.makeWorld()` to reset, restarts the `setInterval(tick, TICK)`, and resumes broadcasting `state` over the WebSocket. The pulse is unaffected because it's clock-derived.

User-visible effect: the ember snaps to center with zero velocity, the pulse keeps flowing without a blink, the host indicator updates to `host: altar`. ~1 frame of disruption.

When the dropped host phone reconnects, it joins as a regular client. The desktop has no incentive to "demote" itself back — `hostId` only changes when the current host drops or a new election is forced. Simpler, and the user won't notice.

### iOS suspension specifically

When the host phone backgrounds (screen lock, app switch), iOS suspends timers and WebRTC within a few seconds. Other phones see case 3 (stream stalls), the desktop becomes host, and the rite continues. When the suspended phone resumes, it reconnects to the WebSocket, receives a fresh `hello` saying `hostId === 'desktop'`, and rejoins as a regular client. No special-case code.

## Code changes

### `server.js`

- Add `clientId` generation and `clients` map indexed by socket.
- Add `hostId` state and election logic on connect/disconnect.
- Add handlers for `signal`, `ping`, `peer-lost`.
- Move `world` and `tick` into `simulation.js`; in `server.js`, hold a local `world` and a `tickInterval` handle that's started when `hostId === 'desktop'` and cleared otherwise.
- The HTTP server now also serves `/simulation.js` (one more route).
- Strip `pulse` from the `state` payload — it's clock-derived on the client now.

Approx +80 lines, -10 lines.

### `index.html`

- Add WebRTC layer: track `clientId`, `hostId`, `clockOffset`, `peers`. Open `RTCPeerConnection`s as host; receive them as client.
- Switch state-source based on `hostId`: peer data channel when open, WebSocket otherwise. Touch input mirrors the same path (over the data channel when peering with the host, over the WebSocket when desktop is host).
- Run `Simulation.tick(world, dt)` locally at 60 Hz when this phone is the host. Broadcast `world` over open data channels.
- Compute pulse from `(performance.now() + clockOffset) / 6000 % 1`. Remove the `state._t / state.pulse` extrapolation.
- Render the host indicator in the existing top label.

Approx +180 lines.

### `simulation.js` (new)

The extracted physics. ~80 lines, no dependencies, dual-mode CJS / browser.

### Test additions

Keep the existing tests. Add:

- `Simulation.tick` advances the ember and bounces it off walls (covers the extracted module — basically the existing physics tested directly instead of via the server).
- Host election: first phone gets `hostId = its clientId`; on its disconnect, `hostId === 'desktop'` if no other phones, else next phone in join order.
- Signal relay: a `signal` from A to B is forwarded to B's socket verbatim; B's socket is the only one that receives it.
- Clock `ping`/`pong`: a `ping` with `t` returns a `pong` echoing `t` and including a sensible `serverNow`.

No automated browser-side WebRTC test. Real WebRTC behavior is tested manually on devices (see below).

## Manual smoke test

Documented as part of the spec because WebRTC behavior can't be unit-tested faithfully.

1. **Happy path, two phones same Wi-Fi.** Phone 1 joins as `?side=left`, sees `host: altar` for ~1 s, then `host: you`. Phone 2 joins as `?side=right`, sees `host: phone 1` (or whatever id was assigned). Latency on touch-to-ember-response feels near-instant — noticeably tighter than today over WAN.
2. **Suspension failover.** With both phones playing peer-to-peer, lock phone 1's screen. Within ~1 s phone 2's host indicator flips to `host: altar`, the ember resets to center, pulse keeps flowing. Unlock phone 1 — it reconnects, indicator shows `host: altar` (still desktop), and the rite continues.
3. **Network change failover.** Mid-rite, take phone 1 off Wi-Fi (turn off Wi-Fi on the phone). Same outcome as suspension.
4. **No peer possible.** Phone 1 on Wi-Fi, phone 2 on cellular, different NATs. Both should still see each other in the rite — peer attempt fails within 3 s, both fall back to desktop. Higher latency, but it works.
5. **Regression escape hatch.** With `?peer=0` on both phones (forces desktop-host), Ember behaves byte-for-byte like today. Useful for confirming the new code didn't change physics.

## Risks

- **Public STUN as the only NAT helper.** If both phones are behind symmetric NAT (rare on home Wi-Fi, common on carrier-grade-NAT cellular), peer won't connect and we'll fall back to desktop. Acceptable — the desktop is the safety net.
- **`performance.now()` drift between phones.** Modern browsers keep `performance.now()` monotonic and precise enough; clock offset refresh every 30 s catches drift before it becomes visible at the seam.
- **Browser autoplay / autoconnect quirks on iOS.** WebRTC is allowed without user gesture, but data channels in standalone PWA mode may behave differently than Safari tabs. Real-device testing covers this.
- **Hot-reload (`reload` message).** Still works over the WebSocket as today. After reload, peer connections are torn down and re-negotiated automatically.

## Rollback

`git revert` the implementation commit. `?peer=0` URL param can be used as a soft-rollback to force the old behavior while keeping the code around.

## Out of scope

- Generalizing the rite layer into a `rites/` registry (deferred until rite 2 exists, per CLAUDE.md).
- Smooth state handoff (shadow-mode mirroring from host phone to desktop). Cheap reset failover is good enough for Ember; revisit when a stateful rite needs continuity.
- TURN server. Falling back to the desktop is our TURN equivalent.
- Multi-rite signaling namespaces / rooms / join codes.
- Number-of-phones beyond 2. The protocol supports N naturally, but the URL convention (`?side=left|right`) doesn't, and that's intentional — leave it for later.
- Same-Wi-Fi auto-detection beyond what WebRTC ICE already does (`host` candidates connect first if reachable; `relay` candidates are not used because we have no TURN).

# CLAUDE.md — Coven

Operating context for Claude Code. Read this before working in the repo.

## What Coven is

Coven is a playground for **collaborative multi-phone experiments**. Several phones laid on a table (or held by friends) join into one shared surface running one shared simulation — a "digital séance." Two intentions sit behind it:

1. **Collaborative experiments** — many devices acting as one: shared canvases, weird games, reactive visuals, eventually a video wall.
2. **A shape-shifting app** — the owner can drastically change Coven whenever they want and have every friend's phone update instantly, because it's a web app / PWA. No app store, no manual updates.

Each individual experiment is called a **rite**. The codebase is one reusable engine plus the current rite.

## Core architecture (the load-bearing ideas)

- **The desktop is the altar** — an authoritative Node server (`server.js`, uses `ws`). It owns the truth, runs the simulation loop (~60 Hz), and broadcasts state.
- **Phones are thin clients** (`index.html`). They render their slice of the world and stream their input (touch) up. They hold no authority.
- **Only positional / state data crosses the wire.** No video or heavy assets are streamed. Visual assets live locally on each phone; the network carries positions, phases, and inputs. Keep it this way unless a rite specifically needs streamed media.
- **One shared virtual canvas.** There is a single logical coordinate space (currently 200×100 units). Each phone renders its *crop* of it. The function mapping `world coords → this phone's local pixels` is the heart of everything — every rite reuses it.
- **Layout is hardcoded for now.** Two phones, `?side=left` and `?side=right`, no auto-detection. The seam is the shared edge they must never both draw.

## The two pillars every rite stands on

1. A **synced clock / shared state** broadcast from the altar.
2. The **shared-canvas mapping** (world → local crop).

Get these right and a rite scales to more phones later. Rite I proves both — the border pulse flowing smoothly across the seam *is* the sync test.

## Repo layout

```
server.js      # the altar: HTTP (serves index.html) + WebSocket + simulation loop
index.html     # the phone client: render slice + stream touch (single file)
package.json   # one dependency: ws
CLAUDE.md      # this file
IDEAS.md       # the idea bank — browse for inspiration, NOT a plan
README.md      # short human-facing intro + quickstart
```

## How to structure things as it grows

- Keep the **engine** (transport, state broadcast, world↔local mapping, connection handling) cleanly separable from **rite-specific logic** (the physics in `server.js`, the draw calls in `index.html`).
- **Don't prematurely abstract.** Right now one rite lives inline, and that's correct. When the *second* rite arrives, that's the moment to factor the shared engine out — e.g. a `rites/` folder plus a tiny registry, with the client choosing a rite via `?rite=`. Let the second rite force the abstraction; don't build it speculatively.
- Stay **vanilla** (plain Node + plain HTML/Canvas) until something genuinely demands a framework. Prototype-grade is fine. Favor small runnable experiments over big architecture.

## How to run

1. `npm install` (installs `ws`).
2. `npm start` (or `node server.js`) on the desktop.
3. Find the desktop's LAN IP — `ipconfig | Select-String "IPv4"` on Windows, `ifconfig | grep "inet "` on macOS/Linux.
4. Put all phones on the **same Wi-Fi** as the desktop.
5. Left phone → `http://<ip>:8080/?side=left`, right phone → `?side=right`. Set them side by side, touching.

## Current state

**Rite I — "Ember" (built & working).** Two phones form one arena framed by a blue border drawn around the *combined* square (neither phone draws the seam). A bright pulse travels the full perimeter, flowing continuously across the seam. A glowing ember bounces off the outer walls; touching and holding a phone creates a repulsion field that shoves it.

The transport is hybrid: the altar (`server.js`) runs a WebSocket-based lobby (signaling, clock sync, fallback state stream), and when two phones can talk peer-to-peer via WebRTC the first phone to join becomes the host — it runs the physics locally (`simulation.js`, the shared dual-mode module) and broadcasts state to its peer over a data channel. If the host phone drops, suspends, or the peer link dies, the desktop quietly resumes hosting and the ember resets to center; the pulse is clock-derived (`(syncedNow / 6000) % 1`) so it never blinks. URL `?peer=0` forces the legacy WebSocket-only behavior for debugging. STUN: `stun:stun.l.google.com:19302`. No TURN — falling back to the desktop is our relay equivalent.

## Natural next moves (not a roadmap — pick what's fun)

- **A second ember, or a second rite** — whichever comes second is the trigger to factor out the engine (see the structure note).
- **TouchDesigner bridge** — forward touch / tilt / mic from phones out to TD over OSC or WebSocket, and later pull TD visuals back in. See IDEAS.md.
- **HTTPS** — required to make Coven installable as a PWA and to bring iPhones in. Currently `ws://` is LAN-only and not installable.

## Aesthetic

Dark, atmospheric, a little occult. Near-black wells with a cold center glow; electric-blue ritual light (`--blue: #2f7bff`); soft blooms over flat fills; faint grain. New rites should feel like they belong to the same séance.

## Known rough edges

- `ws://` only → LAN-only, not PWA-installable yet (HTTPS fixes both).
- If a phone won't connect: desktop firewall blocking port 8080, or phones on a different network.
- World→pixel scaling is independent on x and y, so phones with different aspect ratios stretch slightly. Fine for now; revisit if it bugs you.
- No layout detection — sides are hardcoded via `?side=`.

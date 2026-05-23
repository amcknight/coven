# Coven — Stable HTTPS URL + iPhone Support

**Date:** 2026-05-23
**Status:** Approved
**Supersedes (partially):** [2026-05-22-pwa-tunnel-design.md](2026-05-22-pwa-tunnel-design.md) — the random-tunnel approach for `npm run serve`

## Goal

Replace the random `*.trycloudflare.com` URL with a stable HTTPS endpoint at `coven.amcknight.ca`. This unlocks two things at once:

1. **iPhone PWA support** — Safari can install the app from a real HTTPS origin
2. **Bookmarkable URL** — friends can save the link; QR codes printed once stay valid forever

The desktop still owns the altar — server runs on the home machine when Coven is being played. When the server is off, `coven.amcknight.ca` returns a Cloudflare 502 (tunnel not connected). That's fine.

## Approach

A **named Cloudflare Tunnel** (free tier) attached to `coven.amcknight.ca`. Requires moving `amcknight.ca`'s DNS to Cloudflare — keeps Squarespace + GitHub Pages working unchanged, just changes who answers DNS queries.

Subdomain rather than `amcknight.ca/coven` path so WebSocket routing stays trivial.

## Architecture

```
─── when the altar is lit ────────────────────────────────────────
  iPhone / Android ──HTTPS──► coven.amcknight.ca
                                    │
                                    ▼
                              Cloudflare edge
                                    │
                                    │ (named tunnel,
                                    │  outbound from desktop)
                                    ▼
                              localhost:8080  (server.js)

  amcknight.ca         ────────────────────────► Squarespace (unchanged)
  <subdomain for GH Pages> ─────────────────────► GitHub Pages (unchanged)

─── when the altar is dark ───────────────────────────────────────
  coven.amcknight.ca → Cloudflare 502 (acceptable; expected)
```

## One-time infrastructure setup

Manual, ~30 minutes. Done once, never again. Done by the user (Andrew) outside the codebase. These steps are also a hand-holding script for the execution session.

### Step 1 — Create Cloudflare account, add the domain

1. Sign up at [cloudflare.com](https://cloudflare.com) (free)
2. Dashboard → **Add a site** → enter `amcknight.ca` → choose **Free** plan
3. Cloudflare will scan existing DNS records — verify the Squarespace A records and the GitHub Pages CNAME (whatever subdomain points at `*.github.io`) all appear in the imported list
4. Cloudflare gives you two nameservers, e.g. `xxx.ns.cloudflare.com` and `yyy.ns.cloudflare.com`

### Step 2 — Change nameservers at Squarespace

1. Squarespace dashboard → **Domains** → `amcknight.ca` → **DNS Settings** → look for **Nameservers** or **Use Custom Nameservers**
2. Replace Squarespace's nameservers with the two Cloudflare ones from Step 1
3. Save. Propagation takes anywhere from 5 minutes to a few hours.
4. Back in Cloudflare, the dashboard will mark `amcknight.ca` as **Active** once it sees the new nameservers

Squarespace and GitHub Pages continue to work — Cloudflare is now answering DNS, but the records still point at the same origins.

### Step 3 — Install and authenticate cloudflared

`cloudflared` is already on the machine (used for the random-tunnel `npm run serve`). Authenticate it for named tunnels:

```bash
cloudflared tunnel login
```

Opens a browser. Pick `amcknight.ca`. A certificate file is saved to `~/.cloudflared/cert.pem` (or `%USERPROFILE%\.cloudflared\cert.pem` on Windows).

### Step 4 — Create the named tunnel

```bash
cloudflared tunnel create coven
```

Outputs a tunnel UUID and saves a credentials JSON file to `~/.cloudflared/<uuid>.json`. The tunnel exists in Cloudflare's system but is not connected to anything yet.

### Step 5 — Create the tunnel config file

Create `~/.cloudflared/config.yml` (or `%USERPROFILE%\.cloudflared\config.yml`):

```yaml
tunnel: coven
credentials-file: C:/Users/thedo/.cloudflared/<uuid>.json

ingress:
  - hostname: coven.amcknight.ca
    service: http://localhost:8080
  - service: http_status:404
```

Use forward slashes — YAML can mis-parse Windows backslashes inside unquoted strings.

Substitute the real `<uuid>` from Step 4. The trailing `http_status:404` is the catch-all required by cloudflared.

### Step 6 — Route DNS to the tunnel

```bash
cloudflared tunnel route dns coven coven.amcknight.ca
```

This creates the CNAME record in Cloudflare DNS automatically. Verify in the Cloudflare dashboard that `coven.amcknight.ca` exists as a CNAME pointing at `<uuid>.cfargotunnel.com` with the orange-cloud proxy enabled.

### Step 7 — Smoke test

Start the tunnel:

```bash
cloudflared tunnel run coven
```

In another terminal, start the Coven server (`node server.js`). Visit `https://coven.amcknight.ca` in a browser — should serve the start screen. Visit `?side=left` — should connect via `wss://`.

If that works, the infrastructure is done.

## Code changes

All localized to `start.js`. Roughly 15 lines of churn.

### `start.js` — current behavior

Spawns `cloudflared tunnel --url http://localhost:8080`, parses stdout for a `trycloudflare.com` URL, then spawns `node server.js` with `COVEN_URL` set to the parsed URL.

### `start.js` — new behavior

Spawn `cloudflared tunnel run coven` instead. The named tunnel doesn't print a public URL (it's already known) — so the URL is hardcoded as a constant:

```javascript
const COVEN_URL = 'https://coven.amcknight.ca';
```

Drop the stdout-parsing logic entirely. Spawn the server immediately with `COVEN_URL` set.

Keep:
- The `SIGINT` wiring that kills both child processes
- The "missing cloudflared binary" friendly error message
- The startup banner

The plain `npm start` path (no tunnel, LAN only) is untouched.

### What stays unchanged

- `server.js` — already reads `COVEN_URL` from env, already serves manifest/SW/icon, already uses the right `wss://` scheme
- `index.html` — `wss://` already triggered by `location.protocol === 'https:'`
- All physics, all rendering, the two-phone left/right hardcoding

## iPhone install flow

1. Friend opens `https://coven.amcknight.ca` in Safari (scan QR or tap link)
2. Tap **Share** → **Add to Home Screen** → **Add**
3. Coven icon appears on home screen; tapping it launches fullscreen
4. Tap the **Join Left** / **Join Right** button as usual

No app store, no manual updates — refreshing the page picks up server-pushed changes.

## Known iOS caveats

- **No `beforeinstallprompt`** — the existing `Install App` button on the start screen stays hidden on iOS. The Share → Add to Home Screen path is the only install. (Already handled gracefully — the button just doesn't appear.)
- **No Wake Lock API** — the screen may sleep during long sessions. Acceptable for now; revisit if it becomes a problem.
- **No `requestFullscreen()`** — iOS doesn't honor the JS fullscreen request, but the PWA install gives standalone display anyway, which is the same effect.

## What does not change

- The two-phone left/right hardcoding
- WebSocket protocol and the simulation loop
- The world (200×100 logical units)
- The plain `npm start` (LAN-only) path
- Squarespace site, GitHub Pages
- Any prior commits — this is purely additive

## Risks and rollback

- **DNS propagation hiccup:** Squarespace and GitHub Pages briefly resolve incorrectly during nameserver change. Mitigation: do the cutover during low-traffic time; reverting nameservers undoes everything.
- **Cloudflared running as a foreground process:** `npm run serve` keeps the tunnel alive only while the script runs. If Andrew wants always-on, that's a separate decision (run cloudflared as a Windows service) — out of scope here.
- **Free-tier rate limits:** Cloudflare Tunnel is genuinely free; no surprise billing. Bandwidth ceiling is generous for handful-of-phones use.

## Out of scope

- Always-on / hosted server (the altar staying lit when desktop is off)
- Custom paid plans, premium domains
- Layout detection, second rite, video-wall work (separate sessions)
- Migration of `amcknight.ca`'s main site away from Squarespace

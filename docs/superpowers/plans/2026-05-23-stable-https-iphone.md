# Stable HTTPS URL + iPhone Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the random `*.trycloudflare.com` URL with a stable HTTPS endpoint at `coven.amcknight.ca`, enabling iPhone PWA support and bookmarkable URLs.

**Architecture:** Move `amcknight.ca` DNS to Cloudflare (Squarespace + GitHub Pages keep working unchanged). Create a free named Cloudflare Tunnel pinned to the `coven` subdomain. Update `start.js` to launch the named tunnel instead of the random one. `server.js` and `index.html` need zero changes — they already handle `COVEN_URL` and `wss://`.

**Tech Stack:** Node.js, `ws`, `cloudflared` (already installed), Cloudflare (free tier).

**Spec:** [docs/superpowers/specs/2026-05-23-stable-https-iphone-design.md](../specs/2026-05-23-stable-https-iphone-design.md)

---

## ⚡ Resume state — 2026-05-23

This plan is mid-execution. If picking up in a fresh session, read this first.

**Done:**
- ✅ **Task 1** — Cloudflare account created, `amcknight.ca` added (Free plan), GitHub Pages A records + `_domainconnect` CNAME set to "DNS only" (gray cloud), MX/TXT kept as-is. No `www` record (not used).
- ✅ **Task 2** — Squarespace nameservers swapped from `ns-cloud-aX.googledomains.com` to Cloudflare's `kami.ns.cloudflare.com` and `tom.ns.cloudflare.com`. DNSSEC disabled (Squarespace required it for the swap; can re-enable on Cloudflare's side later if desired).
- ✅ **Task 0 (interlude)** — iOS PWA polish committed while waiting for DNS:
  - `apple-touch-icon` link + `apple-mobile-web-app-capable` / `status-bar-style` / `title` meta tags (commit `de1525b`)
  - iOS install hint on the start screen with share-icon glyph (commit `ebc6865`)
  - Tests added in [test.js](../../../test.js) cover both.

**Waiting on:**
- ✅ Nameservers propagated and Cloudflare flipped `amcknight.ca` to **Active** on 2026-05-23. `nslookup -type=NS amcknight.ca 1.1.1.1` returns `kami.ns.cloudflare.com` and `tom.ns.cloudflare.com`. Apex still resolves to GitHub Pages IPs (`185.199.x.153`) — existing site unaffected.

**Next when Active:**
- Tasks 3–7 (manual, ~15 min total): `cloudflared tunnel login` → `create coven` → write `config.yml` → `route dns` → smoke-test the tunnel.
- Task 8: rewrite `start.js` (commit and verify with `npm test`).
- Task 9: end-to-end smoke test via `npm run serve` from at least one phone (iPhone Safari install path if available).

**Reference values (used by upcoming tasks):**
- Domain: `amcknight.ca`
- Subdomain target: `coven.amcknight.ca`
- Cloudflare nameservers in use: `kami.ns.cloudflare.com`, `tom.ns.cloudflare.com`
- Tunnel name (will be created): `coven`
- `cloudflared` binary: `C:\Program Files (x86)\cloudflared\cloudflared.exe` (version 2026.5.0; may or may not be on the user's interactive PATH — verify with `cloudflared --version` from a fresh terminal)
- Config file path (will be created): `%USERPROFILE%\.cloudflared\config.yml`

---

## Notes on this plan

- **Tasks 1–7 are manual** (Cloudflare/Squarespace dashboards, terminal commands on Andrew's machine). They are not codeable. Each task has verification steps so you can confirm it worked before continuing.
- **Task 8 is the only code change** — small modification to `start.js`.
- **Task 9 is the end-to-end smoke test.**
- The existing test (`test('getPublicUrl returns COVEN_URL when set')` in [test.js](../../../test.js)) already covers the only code-level behavior change. No new tests are required.
- **DO NOT START Task 1 until you have a 30-minute window.** DNS propagation can take a while; you don't want to abandon it half-done. (You CAN safely pause between tasks once each one is verified complete.)

---

## Task 1: Create Cloudflare account and add the domain

**Files:** None — done in Cloudflare web dashboard.

- [x] **Step 1: Sign up at Cloudflare**

Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Create a free account with your email.

- [x] **Step 2: Add `amcknight.ca` to Cloudflare**

In the Cloudflare dashboard: click **Add a site** → enter `amcknight.ca` → click **Continue**.

When asked to choose a plan, select **Free** (at the bottom of the list). Click **Continue**.

- [x] **Step 3: Verify the imported DNS records**

Cloudflare will automatically scan your existing DNS at Squarespace and import the records it finds. You should see:

- One or more **A** records for `amcknight.ca` pointing at Squarespace IPs (typically `198.x.x.x` or `185.x.x.x`)
- A **CNAME** record for `www` (if you have one)
- A **CNAME** for your GitHub Pages subdomain pointing to `*.github.io` (if you have one — e.g. `andrewmcknight.github.io`)
- Possibly TXT records for domain verification

**Expected:** All records that were at Squarespace appear here. If anything is missing, click **Add record** to add it manually.

Click **Continue**.

- [x] **Step 4: Copy down the Cloudflare nameservers**

Cloudflare now shows you two nameservers, like:
```
brad.ns.cloudflare.com
dorothy.ns.cloudflare.com
```

(Your specific names will be different.) Copy both — you'll paste them into Squarespace next.

**Do not click "Done, check nameservers" yet.** First go do Task 2.

---

## Task 2: Change nameservers at Squarespace

**Files:** None — done in Squarespace dashboard.

- [x] **Step 1: Open the Squarespace DNS settings**

Squarespace dashboard → **Settings** → **Domains** → click `amcknight.ca` → find the **Nameservers** section (might be called "Use Squarespace Nameservers" toggle, or "Custom Nameservers").

- [x] **Step 2: Switch to custom nameservers**

Toggle off "Use Squarespace nameservers" (or equivalent), then enter the two Cloudflare nameservers from Task 1, Step 4.

- [x] **Step 3: Save** (DNSSEC was disabled during the swap; Squarespace required it)

Squarespace will warn that this is a big change. Confirm. Save.

- [x] **Step 4: Wait for propagation** (in flight at end of last session)

Propagation can take 5 minutes to a few hours. In a new terminal, run:

```bash
nslookup -type=NS amcknight.ca
```

**Expected (eventually):** the two `*.ns.cloudflare.com` nameservers appear. Until they do, Cloudflare won't activate the domain. **You can leave this running periodically in the background while you wait** — re-run every 5-10 minutes.

- [x] **Step 5: Confirm activation in Cloudflare**

Back in the Cloudflare dashboard, click **Done, check nameservers** (the button from Task 1). Cloudflare will check and either confirm activation immediately or send you an email when it does.

**Expected:** `amcknight.ca` shows as **Active** in the Cloudflare dashboard. Your Squarespace site and GitHub Pages should still work — visit them in a browser to confirm.

**Stop here and verify Squarespace + GitHub Pages still work before continuing.** If anything is broken, the most likely cause is a missing DNS record in Cloudflare's import. Compare against Squarespace's old DNS settings (they should still be visible there even though Squarespace isn't authoritative anymore) and add anything missing.

---

## Task 3: Authenticate cloudflared for named tunnels

**Files:** None — terminal commands. Creates `~/.cloudflared/cert.pem`.

- [ ] **Step 1: Confirm cloudflared is on PATH**

Run:
```bash
cloudflared --version
```

**Expected:** prints a version like `cloudflared version 2024.x.x`. If `command not found`, install it:
```bash
winget install Cloudflare.cloudflared
```

- [ ] **Step 2: Authenticate**

Run:
```bash
cloudflared tunnel login
```

**Expected:** Opens a browser tab asking which domain to authorize. Pick `amcknight.ca` from the list. After approval, the terminal will print something like:
```
You have successfully logged in.
...
Your origin certificate is at: C:\Users\thedo\.cloudflared\cert.pem
```

- [ ] **Step 3: Verify the cert file exists**

```powershell
Test-Path "$env:USERPROFILE\.cloudflared\cert.pem"
```

**Expected:** `True`.

---

## Task 4: Create the named tunnel

**Files:** Creates `~/.cloudflared/<uuid>.json` (credentials file).

- [ ] **Step 1: Create the tunnel**

```bash
cloudflared tunnel create coven
```

**Expected output:**
```
Tunnel credentials written to C:\Users\thedo\.cloudflared\<uuid>.json
Created tunnel coven with id <uuid>
```

- [ ] **Step 2: Note the tunnel UUID**

Copy the UUID from the output. You'll need it for the config file in Task 5.

- [ ] **Step 3: Verify the tunnel was created**

```bash
cloudflared tunnel list
```

**Expected:** A row containing `coven` and its UUID appears.

---

## Task 5: Create the tunnel config file

**Files:**
- Create: `%USERPROFILE%\.cloudflared\config.yml`

- [ ] **Step 1: Create the config file**

Path: `C:\Users\thedo\.cloudflared\config.yml`

Content (replace `<uuid>` with the actual UUID from Task 4):

```yaml
tunnel: coven
credentials-file: C:/Users/thedo/.cloudflared/<uuid>.json

ingress:
  - hostname: coven.amcknight.ca
    service: http://localhost:8080
  - service: http_status:404
```

**Note:** Use forward slashes in `credentials-file` even though it's Windows — YAML can mis-parse backslashes in unquoted strings.

- [ ] **Step 2: Validate the config**

```bash
cloudflared tunnel ingress validate
```

**Expected:**
```
Validating rules from C:\Users\thedo\.cloudflared\config.yml
OK
```

If you get an error about credentials-file not found, double-check the UUID in the path matches the one created in Task 4.

---

## Task 6: Route DNS to the tunnel

**Files:** None — modifies DNS in Cloudflare.

- [ ] **Step 1: Create the CNAME record**

```bash
cloudflared tunnel route dns coven coven.amcknight.ca
```

**Expected:**
```
Added CNAME coven.amcknight.ca which will route to this tunnel tunnelID=<uuid>
```

If you get `failed to add route: code: 1003, reason: Failed to create record: An A, AAAA, or CNAME record with that host already exists.`, it means the record already exists (perhaps from a previous attempt). Either delete it in the Cloudflare dashboard first, or use:

```bash
cloudflared tunnel route dns --overwrite-dns coven coven.amcknight.ca
```

- [ ] **Step 2: Verify in the Cloudflare dashboard**

Cloudflare → `amcknight.ca` → **DNS** → **Records**. You should see:

- Type: `CNAME`
- Name: `coven`
- Target: `<uuid>.cfargotunnel.com`
- Proxy status: orange cloud (proxied) ✓

---

## Task 7: Smoke test the tunnel manually

**Files:** None — running tunnel and server side-by-side, before integrating.

- [ ] **Step 1: Start the named tunnel in one terminal**

```bash
cloudflared tunnel run coven
```

**Expected output:** ends with something like:
```
Registered tunnel connection ... connIndex=0 ...
Registered tunnel connection ... connIndex=1 ...
```

Leave this running.

- [ ] **Step 2: Start Coven in a second terminal**

```bash
cd c:/Users/thedo/git/coven
node server.js
```

**Expected:**
```
COVEN altar is lit.  →  http://<lan-ip>:8080/?side=left
```

(The URL is still LAN-IP because `COVEN_URL` is not set yet. That's fine for this test.)

- [ ] **Step 3: Test in a browser**

Open `https://coven.amcknight.ca` on the desktop. **Expected:** the Coven start screen loads over HTTPS.

Then open `https://coven.amcknight.ca/?side=left` on a phone (any phone, any network — not just your LAN). **Expected:** the left side joins the rite, the `●` indicator at the top turns green, and the ember appears.

- [ ] **Step 4: Test on iPhone specifically (if available)**

Open `https://coven.amcknight.ca/?side=left` in Safari on an iPhone. The rite should join. Tap **Share → Add to Home Screen → Add**. Verify the app icon appears and launching it shows the rite fullscreen.

- [ ] **Step 5: Stop both processes**

Ctrl-C in both terminals. Infrastructure setup is now complete.

---

## Task 8: Update `start.js` to use the named tunnel

**Files:**
- Modify: `start.js` (full rewrite — file is only ~47 lines)

This is the only code change in the entire plan.

- [ ] **Step 1: Rewrite `start.js`**

Replace the entire contents of `c:/Users/thedo/git/coven/start.js` with:

```javascript
const { spawn } = require('child_process');

const COVEN_URL = 'https://coven.amcknight.ca';

const cf = spawn('cloudflared', ['tunnel', 'run', 'coven'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

cf.stdout.on('data', d => process.stdout.write(d));
cf.stderr.on('data', d => process.stderr.write(d));

cf.on('error', err => {
  if (err.code === 'ENOENT') {
    console.error('cloudflared not found. Install it with: winget install Cloudflare.cloudflared');
  } else {
    console.error('cloudflared error:', err.message);
  }
  process.exit(1);
});

cf.on('exit', code => {
  console.error(`cloudflared exited (code ${code ?? 0})`);
  process.exit(code ?? 1);
});

console.log(`\n  Tunnel: ${COVEN_URL}\n`);

const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  env: { ...process.env, COVEN_URL },
});
server.on('exit', code => {
  cf.kill();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  cf.kill();
  process.exit(0);
});
```

**What changed vs the old start.js:**
- Swapped `['tunnel', '--url', 'http://localhost:8080']` for `['tunnel', 'run', 'coven']` (named tunnel)
- Removed the `tryExtractUrl` URL-parsing logic (no random URL to parse)
- Hardcoded `COVEN_URL` as a constant
- Server is now spawned immediately rather than waiting for the URL to appear
- Cloudflared stdout/stderr are passed through so you still see tunnel status
- Server exit now also kills cloudflared (symmetric shutdown)

- [ ] **Step 2: Run the existing test suite**

```bash
npm test
```

**Expected:** All tests pass. The existing `getPublicUrl` tests cover the only behavior that touches `COVEN_URL`.

- [ ] **Step 3: Commit**

```bash
git add start.js
git commit -m "$(cat <<'EOF'
feat: switch start.js to named Cloudflare tunnel

Replace the random *.trycloudflare.com tunnel with a named tunnel
pinned to coven.amcknight.ca. Drop the stdout-parsing logic since
the URL is now known up front.

Requires the named tunnel "coven" to be configured in
~/.cloudflared/config.yml. See spec for setup instructions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end smoke test

**Files:** None — manual verification using the actual code path.

- [ ] **Step 1: Run `npm run serve`**

```bash
cd c:/Users/thedo/git/coven
npm run serve
```

**Expected:**
```
[cloudflared startup logs...]
Tunnel: https://coven.amcknight.ca

COVEN altar is lit.  →  https://coven.amcknight.ca/?side=left
                        https://coven.amcknight.ca/?side=right
```

- [ ] **Step 2: Visit the start screen**

Open `https://coven.amcknight.ca` in a browser. **Expected:**
- Start screen renders
- QR code appears
- The text under the QR shows `https://coven.amcknight.ca`
- Scanning the QR with another phone resolves to the same URL

- [ ] **Step 3: Join from two devices**

- Device 1 (any browser): `https://coven.amcknight.ca/?side=left`
- Device 2 (any browser): `https://coven.amcknight.ca/?side=right`

**Expected:** Both devices connect, indicator turns green, ember bounces, border pulse syncs across the seam. Touching either screen pushes the ember.

- [ ] **Step 4: iPhone install (if available)**

On iPhone Safari, visit `https://coven.amcknight.ca`. Tap **Share → Add to Home Screen → Add**. Tap the new icon on the home screen. **Expected:** Coven launches in standalone mode (no Safari chrome). Tap **Join Left** or **Join Right** — joins the rite.

- [ ] **Step 5: Stop the server**

Ctrl-C in the `npm run serve` terminal. **Expected:** both the server and cloudflared shut down cleanly within a second or two.

- [ ] **Step 6: Final commit (only if any tweaks needed)**

If Tasks 1–9 all passed without changes, you're done. If you had to tweak anything (e.g. the start.js code didn't quite work and needed adjustment), commit those tweaks now.

---

## Rollback

If anything goes wrong and you want to revert to the old random-tunnel behavior:

```bash
git revert HEAD          # reverts the start.js commit
```

The infrastructure (Cloudflare DNS, named tunnel) can stay — it's not hurting anything sitting idle. Revisit later.

If you want to roll back the DNS migration too (Squarespace nameservers), change the nameservers back at Squarespace. Cloudflare will deactivate within a few hours.

---

## Self-review against spec

- **Spec section "One-time infrastructure setup":** Covered by Tasks 1–7. ✓
- **Spec section "Code changes":** Covered by Task 8. ✓
- **Spec section "iPhone install flow":** Verified in Task 7 Step 4 and Task 9 Step 4. ✓
- **Spec section "What stays unchanged":** No tasks touch server.js, index.html, or the LAN-only `npm start` path. ✓
- **No placeholders or `TBD`s.** ✓
- **All commands are exact and copy-pasteable.** ✓

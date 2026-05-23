# Coven

A playground for collaborative multi-phone experiments. Phones laid on a table join into one shared surface running one shared simulation — a digital séance. Each experiment is a **rite**.

The desktop runs an authoritative server (the *altar*); phones are thin clients that render their slice of the world and stream their input. Only positional data crosses the wire — no video, no heavy assets.

## Quickstart

```
npm install
npm start
```

Then put your phones on the **same Wi-Fi** as the desktop and open, on each:

- left phone: `http://<desktop-LAN-ip>:8080/?side=left`
- right phone: `http://<desktop-LAN-ip>:8080/?side=right`

Set them side by side, touching. Touch and hold to push the ember; watch the blue border pulse flow across the seam.

(Find your IP with `ipconfig | Select-String "IPv4"` on Windows, or `ifconfig | grep "inet "` on macOS/Linux.)

## What's here

**Rite I — "Ember":** two phones form one bordered arena with a glowing ember you push around by touch.

See [`CLAUDE.md`](./CLAUDE.md) for architecture and conventions, and [`IDEAS.md`](./IDEAS.md) for where this could go.

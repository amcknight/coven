# IDEAS.md — the Coven idea bank

A loose, unsorted collection of things Coven *could* become. **This is not a roadmap and not a task list** — it's a well to draw from. Build whatever's exciting; ignore the rest. The only thing actually built so far is Rite I (Ember), described in `CLAUDE.md`.

## The north star

- Many phones (4, 8, 17, "a downright illegal coven of zoomers") tiled into one big surface, summoning a single image / video / world into all of them at once.
- And/or: a personal duo app that the owner reshapes constantly, with every friend's phone updating instantly because it's a PWA — no app store, no updates to install.

## Spatial layout — "where are the phones?" (hardest, most magical)

Roughly easy → hard:

- **Manual drag** — players drag tiles into the arrangement matching the table. Ugly, bulletproof. A good fallback worth always having.
- **Edge-swipe stitching** — drag a finger across the seam from one phone onto its neighbor; both detect the crossing at the same timestamp and learn which edges meet plus the offset. Best magic-to-effort ratio; handles rearrangement gracefully.
- **Overhead marker photo** — each phone shows a unique QR / fiducial; one camera above snaps a photo; computer vision recovers exact position, rotation, and scale of every screen at once. Accuracy gold standard; needs a device looking down.
- **Front-cam wave** — cameras face up; wave a marker overhead; phones that see it at the same instant triangulate their relative positions. No external device, but a real CV project and sync-sensitive.
- **Audio / ultrasonic ranging** — chirps plus time-of-flight give a distance matrix, which solves for layout. Continuous (good for phones being slid around), but hard to make robust.

## Video walls

- **Fixed video (easy, scales great):** preload the same file on every phone; sync only the *playback clock* via a master heartbeat; each phone renders its crop. The best path for "summon this clip into all of them."
- **Live reactive video (hard, gorgeous):** nothing to preload, so stream — WebRTC, sending each phone only its own tile, cropped and downscaled. Frame-sync across many live streams is the boss fight.

## TouchDesigner reactive loop

- Phones aren't just displays — they're input sources. Stream touch / tilt / mic from every phone out to TouchDesigner (OSC or WebSocket).
- TD generates reactive visuals from the crowd's collective input, and those visuals get summoned back into the wall.
- Bridge: TD ↔ desktop server (the altar) ↔ phones — the same architecture already in place, grown up.

## Games & experiences (rites)

- **Ember** *(built)* — shared ember, touch-repulsion, bounces across the two-screen field.
- **Tilt gravity** — each phone's tilt bends gravity on its half; players collaboratively keep something aloft.
- **Cross-screen creature** — a little entity wanders across all the screens and reacts to taps; a shared digital pet.
- **Fluid / particles** — a blob or particle field that flows across the seams; touch attracts or repels it.
- **Pong, for real** — actual paddles, but the ball traverses the full multi-phone arena.
- **Shared light-painting** — draw across the whole combined canvas together.
- *(Add your own — this list is meant to grow.)*

## Reach & platform

- **Android-first** (clean Chrome install prompt, more permissive APIs), iPhones later.
- **PWA install:** manifest + service worker + HTTPS → installs to the home screen, runs fullscreen, instant updates for everyone.
- **iOS caveats:** install is manual (Safari → Share → Add to Home Screen); no Web NFC or Web Bluetooth; restricted background execution. Anything living "inside the screen" works everywhere; external-hardware or always-on-background features need an iOS check first.
- **NFC is not the tool** for table layout or live multiplayer (centimeter range, tag-reader only). Use WebSocket / WebRTC for connectivity and the methods above for layout.


## Addiotional newer comments from Andrew after trying Ember. Delete this and integrate into other docs when you see this

- Would be great in fullscreen without bar at top
- Slightly different sized screens don't end up lining up
- should also detect screen resolution and adjust based on physical size
- distance between screens in pixels would be nice, because of bezels, or even buttons on the side pushing phones apart. Might be tough.
- the animation is a little stuttery
- preventing screens from going off would be nice
- I ran all this from chrome so maybe if downloaded or made a homescreen PWA it would allow these
- Should have a Start screen which lets me click Start or Ember and also lets me share QR code URL to let others join.
- Holy grail would be using cameras and/or sounds to get accurate location data between phones to detect configurations
- Would be cool if we had hot server reload for testing new changes

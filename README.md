# Velocity Rush — Neon Grand Prix

Online multiplayer 3D synthwave racing. Drift to charge nitro, then burn it down
neon highways across 6 tracks. Customize your car, share a lobby link, race up to
6 players. Runs entirely in the browser — Three.js rendering, a WebAudio
soundtrack, and **serverless peer-to-peer multiplayer over WebRTC**.

▶ **Play:** https://chezburgar.github.io/velocity-rush/

## Controls
- **Keyboard:** W/↑ gas · S/↓ brake · A/D/←/→ steer · SPACE drift · SHIFT nitro · R reset
- **Touch:** on-screen pedals (mobile)
- **Gamepad:** RT gas · LT brake · A/X drift · B/RB nitro · stick steer

## How multiplayer works (no backend)
GitHub Pages serves only static files, so there is no game server. Instead:
- The **lobby host** runs the race authority (`assets/authority.js`) in their browser.
- Players open **WebRTC data channels** directly to the host (`assets/rtc.js`).
- **Signaling** (peer discovery) uses the free PeerJS cloud broker.
- **NAT relay** (when a direct connection can't be made) uses the TURN server
  configured in **`assets/netconfig.js`**.

### Configure your TURN server
Open `assets/netconfig.js` and fill in **one** of:
- `METERED` — your metered.ca `subdomain` + `apiKey` (fetches short-lived
  credentials at runtime), or
- `STATIC_ICE` — a ready-made `iceServers` array with fixed TURN username/credential.

Without TURN configured it falls back to public STUN, which only works when both
players can reach each other directly (same network / open NAT).

## Solo
**Solo Practice** on the menu needs no network at all — full physics, all 6 tracks.

## Local dev
```
node tools/devserver.js      # serves the game at http://localhost:8321
```

## Layout
- `index.html` — all screens (menu, garage, lobby, HUD, results)
- `assets/game.js` — physics, rendering, netcode client, HUD
- `assets/authority.js` — race referee (runs in the host browser)
- `assets/rtc.js` / `assets/netconfig.js` — WebRTC transport + TURN config
- `assets/tracks.js` · `car.js` · `audio.js` · `strings.js` — world, cars, sound, text
- `server.js` — the original Cloudflare-style server (unused by the Pages build; kept for reference)

// Network configuration for the GitHub Pages (peer-to-peer WebRTC) build.
//
// Multiplayer here has NO backend server: the lobby host runs the race
// authority in their own browser, and players connect directly to the host
// over WebRTC data channels. Two things are needed:
//
//   1. SIGNALING — how peers find each other to open the connection.
//      We use PeerJS's free public cloud broker (no account needed). If you
//      run your own PeerServer, put it in PEER_SERVER below.
//
//   2. ICE / TURN — how the media path is established, and relayed when a
//      direct peer-to-peer connection can't punch through NAT/firewalls.
//      This is where your metered TURN credentials go. Fill in ONE of the
//      two modes below.

// ---- Signaling (PeerJS). null = use the free public cloud broker. ----
export const PEER_SERVER = null;
// To self-host signaling, use e.g.:
// export const PEER_SERVER = { host: "your.host", port: 443, path: "/", secure: true };

// ---- TURN / ICE — fill in ONE of these two modes ----

// MODE A (metered.ca API key): the client fetches short-lived TURN
// credentials at runtime. Put your app subdomain + API key here.
export const METERED = {
  subdomain: "",   // e.g. "yourapp"  ->  https://yourapp.metered.live
  apiKey: ""       // your metered API key
};

// MODE B (static credentials): paste a ready-made iceServers array. Use this
// if your provider gave you fixed TURN username/credential values.
export const STATIC_ICE = null;
// Example:
// export const STATIC_ICE = [
//   { urls: "stun:stun.relay.metered.ca:80" },
//   { urls: "turn:global.relay.metered.ca:80",  username: "USER", credential: "PASS" },
//   { urls: "turn:global.relay.metered.ca:443", username: "USER", credential: "PASS" },
//   { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "USER", credential: "PASS" }
// ];

// Fallback STUN so same-network testing works even before TURN is configured.
const FALLBACK_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

let _cache = null;
export async function getIceServers() {
  if (_cache) return _cache;
  if (Array.isArray(STATIC_ICE) && STATIC_ICE.length) { _cache = STATIC_ICE; return _cache; }
  if (METERED.apiKey && METERED.subdomain) {
    try {
      const r = await fetch(`https://${METERED.subdomain}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(METERED.apiKey)}`);
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) { _cache = list; return _cache; }
      }
    } catch (e) { /* fall through to STUN */ }
  }
  _cache = FALLBACK_ICE;
  return _cache;
}

export function turnConfigured() {
  return !!(STATIC_ICE || (METERED.apiKey && METERED.subdomain));
}

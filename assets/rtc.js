// WebRTC peer-to-peer transport (GitHub Pages build). No backend server:
// the lobby host runs the Authority; players open WebRTC data channels to it.
// Both wrappers expose the same interface game.js used for WebSockets:
//   { onMessage(fn), onStatus(fn), send(obj), close() }
// Signaling via PeerJS; NAT relay via the TURN servers from netconfig.js.
import { Authority } from "./authority.js";
import { getIceServers, PEER_SERVER } from "./netconfig.js";

/* global Peer */

const PREFIX = "vrush-";  // peer id namespace for hosts

function peerOpts(iceServers) {
  const o = { config: { iceServers, sdpSemantics: "unified-plan" }, debug: 1 };
  if (PEER_SERVER) Object.assign(o, PEER_SERVER);
  return o;
}

// ---------------------------------------------------------------- HOST
export async function createHost(code, playerId) {
  const iceServers = await getIceServers();
  const authority = new Authority();
  const conns = new Map();   // playerId -> DataConnection
  let closing = false;

  const net = {
    isHost: true, code,
    onMessage: () => {}, onStatus: () => {},
    send(obj) {
      // host's own inputs go straight into the authority
      if (obj && obj.t === "join") obj = Object.assign({}, obj, { _send: hostSelfSend });
      authority.receive(playerId, obj);
    },
    close() {
      closing = true;
      authority.destroy();
      for (const c of conns.values()) { try { c.close(); } catch (e) {} }
      try { peer.destroy(); } catch (e) {}
    }
  };
  const hostSelfSend = obj => { try { net.onMessage(obj); } catch (e) {} };

  const peer = new Peer(PREFIX + code, peerOpts(iceServers));

  peer.on("open", () => net.onStatus("open"));   // host now sends its local join

  peer.on("connection", conn => {
    conn.on("open", () => { /* wait for the join frame to learn the player id */ });
    conn.on("data", raw => {
      const m = decode(raw);
      if (!m) return;
      if (!conn._pid) {
        if (m.t !== "join") return;               // first frame must be join
        conn._pid = String(m.id || "").slice(0, 40) || conn.peer;
        const prev = conns.get(conn._pid);
        if (prev && prev !== conn) { try { prev.close(); } catch (e) {} }
        conns.set(conn._pid, conn);
        const remoteSend = obj => { try { if (conn.open) conn.send(obj); } catch (e) {} };
        authority.receive(conn._pid, Object.assign({}, m, { _send: remoteSend }));
      } else {
        authority.receive(conn._pid, m);
      }
    });
    const drop = () => {
      if (conn._pid && conns.get(conn._pid) === conn) {
        conns.delete(conn._pid);
        if (!closing) authority.disconnect(conn._pid);
      }
    };
    conn.on("close", drop);
    conn.on("error", drop);
  });

  peer.on("error", err => {
    if (closing) return;
    if (err && err.type === "unavailable-id") net.onStatus("taken");
    else net.onStatus("peer-error");
  });
  peer.on("disconnected", () => { if (!closing) { try { peer.reconnect(); } catch (e) {} } });

  return net;
}

// ---------------------------------------------------------------- JOINER
export async function joinHost(code, playerId) {
  const iceServers = await getIceServers();
  let closing = false, conn = null, retry = 0, queued = null;

  const net = {
    isHost: false, code,
    onMessage: () => {}, onStatus: () => {},
    send(obj) {
      if (conn && conn.open) { try { conn.send(obj); } catch (e) {} }
      else if (obj && obj.t === "join") queued = obj;   // keep the latest join to replay
    },
    close() { closing = true; try { if (conn) conn.close(); } catch (e) {} try { peer.destroy(); } catch (e) {} }
  };

  const peer = new Peer(undefined, peerOpts(iceServers));

  function dial() {
    if (closing) return;
    conn = peer.connect(PREFIX + code, { reliable: true, metadata: { id: playerId } });
    conn.on("open", () => {
      retry = 0;
      net.onStatus("open");                  // game sends its join
      if (queued) { try { conn.send(queued); } catch (e) {} }
    });
    conn.on("data", raw => { const m = decode(raw); if (m) net.onMessage(m); });
    const lost = () => {
      if (closing) return;
      net.onStatus("closed");
      const delay = Math.min(6000, 600 * Math.pow(1.6, retry++));
      setTimeout(dial, delay);
    };
    conn.on("close", lost);
    conn.on("error", lost);
  }

  peer.on("open", dial);
  peer.on("error", err => {
    if (closing) return;
    // peer-unavailable = host id not found (bad code or host offline)
    if (err && err.type === "peer-unavailable") net.onStatus("nohost");
    else net.onStatus("closed");
  });
  peer.on("disconnected", () => { if (!closing) { try { peer.reconnect(); } catch (e) {} } });

  return net;
}

function decode(raw) {
  if (raw && typeof raw === "object") return raw;      // PeerJS delivers parsed objects
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch (e) { return null; } }
  return null;
}

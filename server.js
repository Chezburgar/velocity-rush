// Velocity Rush — realtime room server. One instance per room (shard = room id).
// Referee for: seating (6 max), lobby/ready, track pick, countdown, checkpoint
// order, lap counting, finish places. Car motion is client-simulated and relayed.
import { DurableObject } from "cloudflare:workers";

const MAX_SEATS = 6;
const CP_COUNT = 16;   // must match client tracks.js
const LAPS = 3;
const SNAP_MS = 66;    // ~15 Hz state broadcast
const RACE_TIMEOUT_MS = 8 * 60 * 1000;
const AFTER_FIRST_FINISH_MS = 120 * 1000;

export class GameServer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();  // id -> player
    this.phase = "lobby";      // lobby | countdown | race | results
    this.trackIdx = 0;
    this.hostId = null;
    this.finishCount = 0;
    this.snapTimer = null;
    this.countTimers = [];
    this.raceGuard = null;
    this.finishGuard = null;
  }

  fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("velocity-rush room server", { status: 200 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    let playerId = null;

    server.addEventListener("message", ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      try {
        if (m.t === "join") { playerId = this.onJoin(server, m); return; }
        if (!playerId) return;
        const p = this.players.get(playerId);
        if (!p || p.ws !== server) return;
        this.onMsg(p, m);
      } catch (e) { /* never let a bad message kill the socket loop */ }
    });
    const drop = () => { if (playerId) this.onLeave(playerId, server); };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ------------------------------------------------------------ join/leave
  onJoin(ws, m) {
    const id = String(m.id || "").slice(0, 40);
    if (!id) return null;
    let p = this.players.get(id);
    if (p) {
      // reconnect: replace socket, keep seat & progress
      try { if (p.ws && p.ws !== ws) p.ws.close(); } catch (e) {}
      p.ws = ws;
      p.connected = true;
      p.name = cleanName(m.name) || p.name;
      if (m.car) p.car = cleanCar(m.car);
    } else {
      const seat = this.freeSeat();
      const seated = seat >= 0 && this.phase === "lobby";
      p = {
        id, ws,
        name: cleanName(m.name) || "ACE",
        car: cleanCar(m.car),
        seat: seated ? seat : -1,
        ready: false, connected: true,
        lap: 0, cp: 0, finished: false, place: 0, finishTime: 0,
        state: null, lastStateAt: 0
      };
      this.players.set(id, p);
    }
    if (!this.hostId || !this.isActive(this.hostId)) this.pickHost();
    this.sendTo(p, {
      t: "joined", you: p.id, seat: p.seat, spectator: p.seat < 0,
      phase: this.phase, track: this.trackIdx
    });
    this.broadcastRoom();
    if (this.phase === "race") this.sendTo(p, { t: "go", late: true });
    return id;
  }

  onLeave(id, ws) {
    const p = this.players.get(id);
    if (!p || (ws && p.ws !== ws)) return;
    p.connected = false;
    p.ready = false;
    if (this.phase === "lobby" || this.phase === "results") {
      this.players.delete(id);
    }
    if (![...this.players.values()].some(q => q.connected)) {
      this.resetRoom();
      return;
    }
    if (this.hostId === id) this.pickHost();
    this.broadcastRoom();
    if (this.phase === "race") this.maybeEndRace();
  }

  freeSeat() {
    const used = new Set([...this.players.values()].map(p => p.seat));
    for (let s = 0; s < MAX_SEATS; s++) if (!used.has(s)) return s;
    return -1;
  }

  isActive(id) {
    const p = this.players.get(id);
    return !!(p && p.connected && p.seat >= 0);
  }

  pickHost() {
    const seated = [...this.players.values()].filter(p => p.connected && p.seat >= 0).sort((a, b) => a.seat - b.seat);
    this.hostId = seated.length ? seated[0].id : null;
  }

  resetRoom() {
    this.players.clear();
    this.phase = "lobby";
    this.hostId = null;
    this.finishCount = 0;
    this.stopTimers();
  }

  stopTimers() {
    if (this.snapTimer) { clearInterval(this.snapTimer); this.snapTimer = null; }
    for (const t of this.countTimers) clearTimeout(t);
    this.countTimers = [];
    if (this.raceGuard) { clearTimeout(this.raceGuard); this.raceGuard = null; }
    if (this.finishGuard) { clearTimeout(this.finishGuard); this.finishGuard = null; }
  }

  // ------------------------------------------------------------ messages
  onMsg(p, m) {
    switch (m.t) {
      case "cust":
        if (this.phase === "lobby") {
          p.name = cleanName(m.name) || p.name;
          if (m.car) p.car = cleanCar(m.car);
          this.broadcastRoom();
        }
        break;
      case "ready":
        if (this.phase === "lobby" && p.seat >= 0) {
          p.ready = !!m.v;
          this.broadcastRoom();
        }
        break;
      case "track":
        if (this.phase === "lobby" && p.id === this.hostId) {
          const v = parseInt(m.v, 10);
          if (v >= 0 && v < 6) { this.trackIdx = v; this.broadcastRoom(); }
        }
        break;
      case "start":
        if (this.phase === "lobby" && p.id === this.hostId) this.tryStart(p);
        break;
      case "s":
        if (this.phase === "race" && p.seat >= 0 && !p.finished) {
          const now = Date.now();
          if (now - p.lastStateAt < 25) return; // flood guard
          p.lastStateAt = now;
          p.state = [
            num(m.x, 4000), num(m.y, 200), num(m.z, 4000),
            num(m.h, 10), num(m.sp, 200),
            m.d ? 1 : 0, m.n ? 1 : 0
          ];
        }
        break;
      case "cp":
        if (this.phase === "race" && p.seat >= 0 && !p.finished) this.onCheckpoint(p, parseInt(m.i, 10));
        break;
      case "lobby":
        if (this.phase === "results" && p.id === this.hostId) this.toLobby();
        break;
      case "ping":
        this.sendTo(p, { t: "pong", ts: m.ts });
        break;
    }
  }

  tryStart(host) {
    const seated = [...this.players.values()].filter(p => p.connected && p.seat >= 0);
    if (!seated.length) return;
    const allReady = seated.every(p => p.ready || p.id === host.id);
    if (!allReady) { this.sendTo(host, { t: "err", code: "notready" }); return; }
    this.phase = "countdown";
    for (const p of this.players.values()) {
      p.lap = 1; p.cp = 0; p.finished = false; p.place = 0; p.finishTime = 0; p.state = null;
    }
    this.finishCount = 0;
    this.broadcastRoom();
    const seq = [3, 2, 1];
    seq.forEach((n, i) => {
      this.countTimers.push(setTimeout(() => this.broadcast({ t: "count", n }), 400 + i * 1000));
    });
    this.countTimers.push(setTimeout(() => this.go(), 400 + 3000));
  }

  go() {
    this.phase = "race";
    this.raceStartAt = Date.now();
    this.broadcast({ t: "go" });
    this.broadcastRoom();
    if (this.snapTimer) clearInterval(this.snapTimer);
    this.snapTimer = setInterval(() => this.sendSnap(), SNAP_MS);
    this.raceGuard = setTimeout(() => this.endRace(), RACE_TIMEOUT_MS);
  }

  sendSnap() {
    const cars = [];
    for (const p of this.players.values()) {
      if (p.seat >= 0 && p.state) cars.push([p.seat, ...p.state]);
    }
    if (cars.length) this.broadcast({ t: "snap", ts: Date.now(), c: cars });
  }

  onCheckpoint(p, i) {
    if (isNaN(i) || i < 0 || i >= CP_COUNT) return;
    const next = (p.cp + 1) % CP_COUNT;
    if (i !== next) return; // out of order — ignore (no skipping)
    p.cp = i;
    if (i === 0) {
      p.lap++;
      if (p.lap > LAPS) {
        p.finished = true;
        p.place = ++this.finishCount;
        p.finishTime = Date.now() - this.raceStartAt;
        if (this.finishCount === 1) {
          this.finishGuard = setTimeout(() => this.endRace(), AFTER_FIRST_FINISH_MS);
        }
      }
    }
    this.broadcastProg();
    this.maybeEndRace();
  }

  maybeEndRace() {
    if (this.phase !== "race") return;
    const racing = [...this.players.values()].filter(p => p.seat >= 0 && p.connected && !p.finished);
    const finished = [...this.players.values()].filter(p => p.seat >= 0 && p.finished);
    if (racing.length === 0 && finished.length > 0) this.endRace();
  }

  endRace() {
    if (this.phase !== "race") return;
    this.phase = "results";
    this.stopTimers();
    // rank: finishers by place, then DNF by progress
    const seated = [...this.players.values()].filter(p => p.seat >= 0);
    const dnf = seated.filter(p => !p.finished).sort((a, b) => (b.lap * CP_COUNT + b.cp) - (a.lap * CP_COUNT + a.cp));
    dnf.forEach((p, i) => { p.place = this.finishCount + i + 1; });
    const results = seated
      .slice()
      .sort((a, b) => a.place - b.place)
      .map(p => ({ id: p.id, name: p.name, car: p.car, place: p.place, fin: p.finished, ft: p.finishTime }));
    this.broadcast({ t: "end", results });
    this.broadcastRoom();
  }

  toLobby() {
    this.phase = "lobby";
    for (const p of [...this.players.values()]) {
      if (!p.connected) { this.players.delete(p.id); continue; }
      p.ready = false;
      p.lap = 0; p.cp = 0; p.finished = false; p.place = 0; p.finishTime = 0; p.state = null;
      if (p.seat < 0) { const s = this.freeSeat(); if (s >= 0) p.seat = s; } // promote spectators
    }
    this.pickHost();
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ out
  roomState() {
    return {
      t: "room",
      phase: this.phase,
      host: this.hostId,
      track: this.trackIdx,
      laps: LAPS,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, car: p.car, seat: p.seat,
        ready: p.ready, connected: p.connected,
        lap: p.lap, cp: p.cp, fin: p.finished, place: p.place, ft: p.finishTime
      }))
    };
  }

  broadcastRoom() { this.broadcast(this.roomState()); }

  broadcastProg() {
    const p = [...this.players.values()]
      .filter(q => q.seat >= 0)
      .map(q => ({ id: q.id, seat: q.seat, lap: q.lap, cp: q.cp, fin: q.finished, place: q.place, ft: q.finishTime }));
    this.broadcast({ t: "prog", p });
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      try { p.ws.send(s); } catch (e) { /* dead socket -> close event will clean up */ }
    }
  }

  sendTo(p, obj) {
    try { p.ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function cleanName(n) {
  return String(n || "").replace(/[^\w \-!?.]/g, "").trim().slice(0, 12);
}
function cleanCar(c) {
  c = c || {};
  const ci = (v, n) => { v = parseInt(v, 10); return isNaN(v) ? 0 : Math.max(0, Math.min(n - 1, v)); };
  return { body: ci(c.body, 8), accent: ci(c.accent, 6), rim: ci(c.rim, 6), spoiler: ci(c.spoiler, 3), glow: ci(c.glow, 6) };
}
function num(v, lim) {
  v = +v;
  if (isNaN(v)) return 0;
  return Math.max(-lim, Math.min(lim, Math.round(v * 100) / 100));
}

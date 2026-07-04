// Race authority — ported from server.js to run in the lobby host's browser.
// Transport-agnostic: each player has a send(obj) callback. The host wires its
// own player to a local callback and remote players to WebRTC data channels.
// Referee for: seating (6 max), lobby/ready, track pick, countdown, checkpoint
// order, lap counting, finish places. Car motion is client-simulated & relayed.

const MAX_SEATS = 6;
const CP_COUNT = 16;   // must match tracks.js
const LAPS = 3;
const SNAP_MS = 66;    // ~15 Hz state broadcast
const RACE_TIMEOUT_MS = 8 * 60 * 1000;
const AFTER_FIRST_FINISH_MS = 120 * 1000;

export class Authority {
  constructor() {
    this.players = new Map();  // id -> player
    this.phase = "lobby";
    this.trackIdx = 0;
    this.hostId = null;
    this.finishCount = 0;
    this.snapTimer = null;
    this.countTimers = [];
    this.raceGuard = null;
    this.finishGuard = null;
  }

  // ---- transport hooks (called by the host wrapper) ----
  receive(id, m) {
    if (!m || typeof m.t !== "string") return;
    try {
      if (m.t === "join") { this.onJoin(id, m); return; }
      const p = this.players.get(id);
      if (!p) return;
      this.onMsg(p, m);
    } catch (e) { /* never let a bad message break the room */ }
  }
  disconnect(id) { this.onLeave(id); }

  destroy() { this.stopTimers(); this.players.clear(); }

  // ------------------------------------------------------------ join/leave
  onJoin(id, m) {
    id = String(id || "").slice(0, 40);
    if (!id) return;
    let p = this.players.get(id);
    if (p) {
      p.send = m._send || p.send;
      p.connected = true;
      p.name = cleanName(m.name) || p.name;
      if (m.car) p.car = cleanCar(m.car);
    } else {
      const seat = this.freeSeat();
      const seated = seat >= 0 && this.phase === "lobby";
      p = {
        id, send: m._send || (() => {}),
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
  }

  // register/replace a player's send channel (host wrapper calls this before join)
  setSend(id, sendFn) {
    const p = this.players.get(id);
    if (p) p.send = sendFn;
    else this._pending = this._pending || new Map(), this._pending.set(id, sendFn);
  }

  onLeave(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    p.ready = false;
    if (this.phase === "lobby" || this.phase === "results") this.players.delete(id);
    if (![...this.players.values()].some(q => q.connected)) { this.resetRoom(); return; }
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
        if (this.phase === "lobby" && p.seat >= 0) { p.ready = !!m.v; this.broadcastRoom(); }
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
          if (now - p.lastStateAt < 25) return;
          p.lastStateAt = now;
          p.state = [num(m.x, 4000), num(m.y, 200), num(m.z, 4000), num(m.h, 10), num(m.sp, 200), m.d ? 1 : 0, m.n ? 1 : 0];
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
    [3, 2, 1].forEach((n, i) => this.countTimers.push(setTimeout(() => this.broadcast({ t: "count", n }), 400 + i * 1000)));
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
    for (const p of this.players.values()) if (p.seat >= 0 && p.state) cars.push([p.seat, ...p.state]);
    if (cars.length) this.broadcast({ t: "snap", ts: Date.now(), c: cars });
  }

  onCheckpoint(p, i) {
    if (isNaN(i) || i < 0 || i >= CP_COUNT) return;
    const next = (p.cp + 1) % CP_COUNT;
    if (i !== next) return;
    p.cp = i;
    if (i === 0) {
      p.lap++;
      if (p.lap > LAPS) {
        p.finished = true;
        p.place = ++this.finishCount;
        p.finishTime = Date.now() - this.raceStartAt;
        if (this.finishCount === 1) this.finishGuard = setTimeout(() => this.endRace(), AFTER_FIRST_FINISH_MS);
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
    const seated = [...this.players.values()].filter(p => p.seat >= 0);
    const dnf = seated.filter(p => !p.finished).sort((a, b) => (b.lap * CP_COUNT + b.cp) - (a.lap * CP_COUNT + a.cp));
    dnf.forEach((p, i) => { p.place = this.finishCount + i + 1; });
    const results = seated.slice().sort((a, b) => a.place - b.place)
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
      if (p.seat < 0) { const s = this.freeSeat(); if (s >= 0) p.seat = s; }
    }
    this.pickHost();
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ out
  roomState() {
    return {
      t: "room", phase: this.phase, host: this.hostId, track: this.trackIdx, laps: LAPS,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, car: p.car, seat: p.seat, ready: p.ready, connected: p.connected,
        lap: p.lap, cp: p.cp, fin: p.finished, place: p.place, ft: p.finishTime
      }))
    };
  }
  broadcastRoom() { this.broadcast(this.roomState()); }
  broadcastProg() {
    const p = [...this.players.values()].filter(q => q.seat >= 0)
      .map(q => ({ id: q.id, seat: q.seat, lap: q.lap, cp: q.cp, fin: q.finished, place: q.place, ft: q.finishTime }));
    this.broadcast({ t: "prog", p });
  }
  broadcast(obj) {
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      try { p.send(obj); } catch (e) {}
    }
  }
  sendTo(p, obj) { try { p.send(obj); } catch (e) {} }
}

function cleanName(n) { return String(n || "").replace(/[^\w \-!?.]/g, "").trim().slice(0, 12); }
function cleanCar(c) {
  c = c || {};
  const ci = (v, n) => { v = parseInt(v, 10); return isNaN(v) ? 0 : Math.max(0, Math.min(n - 1, v)); };
  return { body: ci(c.body, 8), accent: ci(c.accent, 6), rim: ci(c.rim, 6), spoiler: ci(c.spoiler, 3), glow: ci(c.glow, 6) };
}
function num(v, lim) { v = +v; if (isNaN(v)) return 0; return Math.max(-lim, Math.min(lim, Math.round(v * 100) / 100)); }

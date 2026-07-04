// Two synthetic players run a full race against the LIVE server (netcode gate).
const ROOM = "CCT" + Math.random().toString(36).slice(2, 7).toUpperCase();
const BASE = "wss://sage-muse-295.higgsfield.gg/ws/" + ROOM;
const log = [];
const seen = new Set();
let A, B, done = false;

function note(tag, extra) {
  if (!seen.has(tag)) { seen.add(tag); log.push(tag + (extra ? " " + extra : "")); }
}
function fail(why) {
  if (done) return; done = true;
  console.log("FAIL:", why, "\n" + log.join("\n"));
  process.exit(1);
}
function finish() {
  if (done) return; done = true;
  console.log("PASS\n" + log.join("\n"));
  process.exit(0);
}
setTimeout(() => fail("timeout"), 45000);

function client(name, id) {
  const ws = new WebSocket(BASE);
  ws.onopen = () => ws.send(JSON.stringify({ t: "join", id, name, car: { body: 1, accent: 0, rim: 0, spoiler: 2, glow: 0 } }));
  return ws;
}

A = client("HOSTBOT", "bot_a_1");
A.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.t === "joined") { note("A joined seat=" + m.seat); startB(); }
  if (m.t === "room") {
    const seated = m.players.filter(p => p.seat >= 0);
    if (seated.length === 2 && m.phase === "lobby") {
      note("both seated, host=" + (m.host === "bot_a_1" ? "A" : m.host));
      const b = m.players.find(p => p.id === "bot_b_1");
      if (b && b.ready && !seen.has("started")) {
        seen.add("started");
        A.send(JSON.stringify({ t: "track", v: 3 }));
        A.send(JSON.stringify({ t: "start" }));
      }
    }
    if (m.phase === "countdown") note("countdown, track=" + m.track);
  }
  if (m.t === "count") note("count " + m.n);
  if (m.t === "go") {
    note("GO");
    A.send(JSON.stringify({ t: "s", x: 1, y: 0, z: 2, h: 0.5, sp: 30, d: 1, n: 0 }));
    // full 3 laps of checkpoints, in order
    let msgs = [];
    for (let lap = 0; lap < 3; lap++) {
      for (let i = 1; i < 16; i++) msgs.push(i);
      msgs.push(0);
    }
    let k = 0;
    const iv = setInterval(() => {
      if (k >= msgs.length) { clearInterval(iv); return; }
      A.send(JSON.stringify({ t: "cp", i: msgs[k++] }));
    }, 30);
  }
  if (m.t === "snap") {
    const seats = m.c.map(c => c[0]).sort().join(",");
    if (m.c.length >= 2) note("snap has both cars seats=" + seats);
  }
  if (m.t === "prog") {
    const me = m.p.find(p => p.id === "bot_a_1");
    if (me && me.lap === 2) note("lap 2 reached");
    if (me && me.fin) {
      note("A finished place=" + me.place);
      if (!seen.has("bclosed")) { seen.add("bclosed"); note("closing B (DNF leaves race)"); B.close(); }
    }
  }
  if (m.t === "end") {
    note("END results=" + m.results.map(r => r.name + ":" + r.place + (r.fin ? "(fin)" : "(dnf)")).join(" "));
    const w = m.results[0];
    if (w.id === "bot_a_1" && w.place === 1) finish();
    else fail("wrong winner");
  }
};
A.onerror = e => fail("A ws error " + e.message);

function startB() {
  B = client("RIVALBOT", "bot_b_1");
  B.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === "joined") {
      note("B joined seat=" + m.seat);
      B.send(JSON.stringify({ t: "ready", v: true }));
    }
    if (m.t === "go") {
      let n = 0;
      const iv = setInterval(() => {
        if (n++ > 40 || done) { clearInterval(iv); return; }
        B.send(JSON.stringify({ t: "s", x: 5 + n, y: 0, z: 3, h: 1, sp: 20, d: 0, n: 1 }));
      }, 70);
    }
  };
  B.onerror = e => fail("B ws error " + e.message);
}

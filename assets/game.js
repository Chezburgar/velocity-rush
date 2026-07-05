// Velocity Rush — main client. Arcade drift/nitro physics, 6-player netcode,
// procedural synthwave rendering. Server is the referee (server.js).
import { STR } from "./strings.js";
import { GameAudio } from "./audio.js";
import { PALETTE, sanitizeCustom, buildCar } from "./car.js";
import {
  TRACKS, CP_COUNT, ROAD_HALF, WALL_DIST,
  buildTrack, gridPose, makeGlowTex, makeFlameTex
} from "./tracks.js";
import { createHost, joinHost } from "./rtc.js";
import { turnConfigured } from "./netconfig.js";

/* global THREE */

// ---------------------------------------------------------------- setup
const IS_TOUCH = matchMedia("(pointer: coarse)").matches;
const QUALITY = IS_TOUCH ? 0 : 1;
const DPR_CAP = IS_TOUCH ? 1.25 : 1.5;
const DEV = new URLSearchParams(location.search).has("dev");

const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY === 1, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP));

const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 2200);
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", onResize);
addEventListener("orientationchange", onResize);
onResize();

const glowTex = new THREE.CanvasTexture(makeGlowTex());
const flameTex = new THREE.CanvasTexture(makeFlameTex());
const audio = new GameAudio();

// ---------------------------------------------------------------- persistent identity
function rid(n) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}
let playerId = sessionStorage.getItem("vr_pid");
if (!playerId) { playerId = "p_" + rid(12); sessionStorage.setItem("vr_pid", playerId); }
let custom = sanitizeCustom(JSON.parse(localStorage.getItem("vr_car") || "null"));
let myName = (localStorage.getItem("vr_name") || "").slice(0, 12);

// ---------------------------------------------------------------- DOM
const $ = id => document.getElementById(id);
const screens = { menu: $("screen-menu"), garage: $("screen-garage"), lobby: $("screen-lobby"), hud: $("screen-hud"), results: $("screen-results") };
function show(name) {
  for (const k in screens) screens[k].classList.toggle("on", k === name);
}
function toast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg; t.style.opacity = 1;
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.opacity = 0), ms);
}

// static strings
$("logoTitle").textContent = STR.title;
$("logoSub").textContent = STR.subtitle;
$("lbName").textContent = STR.yourName;
$("nameInput").placeholder = STR.namePlaceholder;
$("nameInput").value = myName;
$("btnGarage").textContent = STR.garage;
$("btnCreate").textContent = STR.createRoom;
$("btnJoin").textContent = STR.joinRoom;
$("joinCode").placeholder = STR.roomCode;
$("btnPractice").textContent = STR.practice;
$("hintControls").innerHTML = STR.controlsKeys + "<br>" + STR.controlsPad;
$("lbBody").textContent = STR.bodyColor;
$("lbAccent").textContent = STR.accentColor;
$("lbRim").textContent = STR.wheelColor;
$("lbGlow").textContent = STR.glowColor;
$("lbSpoiler").textContent = STR.spoiler;
$("btnGarageSave").textContent = STR.save;
$("btnCopy").textContent = STR.copy;
$("lbPlayers").textContent = STR.players;
$("btnReady").textContent = STR.ready;
$("btnStart").textContent = STR.start;
$("btnLeave").textContent = STR.back;
$("speedu").textContent = STR.kmh;
$("nitrolabel").textContent = "NITRO";
$("resTitle").textContent = STR.results;
$("btnLobbyBack").textContent = STR.backToLobby;

// ---------------------------------------------------------------- input
const BIND = {
  KeyW: "gas", ArrowUp: "gas", KeyS: "brake", ArrowDown: "brake",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  Space: "drift", ShiftLeft: "nitro", ShiftRight: "nitro", KeyN: "nitro", KeyR: "reset"
};
const held = new Set();
function isTyping(t) {
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
addEventListener("keydown", e => {
  if (isTyping(e.target)) return;   // never eat keystrokes meant for a text field
  const c = BIND[e.code];
  if (c) { held.add(c); e.preventDefault(); }
});
addEventListener("keyup", e => { const c = BIND[e.code]; if (c) held.delete(c); });

const touchHeld = new Set();
function bindTouch(id, cmd) {
  const el = $(id);
  const on = e => { e.preventDefault(); touchHeld.add(cmd); el.classList.add("on"); audio.resume(); };
  const off = e => { e.preventDefault(); touchHeld.delete(cmd); el.classList.remove("on"); };
  el.addEventListener("pointerdown", on);
  el.addEventListener("pointerup", off);
  el.addEventListener("pointercancel", off);
  el.addEventListener("pointerleave", off);
}
bindTouch("tL", "left"); bindTouch("tR", "right");
bindTouch("tGas", "gas"); bindTouch("tBrake", "brake");
bindTouch("tDrift", "drift"); bindTouch("tNitro", "nitro");
if (IS_TOUCH) $("touch").style.display = "block";

function readPad() {
  const out = { steer: 0, gas: 0, brake: 0, drift: false, nitro: false };
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.14) out.steer = -ax; // stick right = steer right (negative h)
    const bt = i => gp.buttons[i] && gp.buttons[i].pressed;
    const bv = i => (gp.buttons[i] ? gp.buttons[i].value : 0);
    out.gas = Math.max(out.gas, bv(7), bt(0) ? 1 : 0);
    out.brake = Math.max(out.brake, bv(6));
    if (bt(2) || bt(5)) out.drift = true;
    if (bt(1) || bt(4)) out.nitro = true;
    if (bt(12)) out.gas = 1;
    if (bt(13)) out.brake = 1;
    if (bt(14)) out.steer = 1;
    if (bt(15)) out.steer = -1;
  }
  return out;
}

function readControls() {
  const pad = readPad();
  const all = new Set([...held, ...touchHeld]);
  let steer = pad.steer;
  if (all.has("left")) steer = 1;
  if (all.has("right")) steer = -1;
  return {
    steer,
    gas: Math.max(pad.gas, all.has("gas") ? 1 : 0),
    brake: Math.max(pad.brake, all.has("brake") ? 1 : 0),
    drift: pad.drift || all.has("drift"),
    nitro: pad.nitro || all.has("nitro"),
    reset: all.has("reset")
  };
}

// ---------------------------------------------------------------- particles (Points pools)
class Pool {
  constructor(scene, count, color, size, blending) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.base = new THREE.Color(color);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: glowTex, vertexColors: true, transparent: true,
      blending, depthWrite: false, sizeAttenuation: true
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -999;
  }
  spawn(x, y, z, vx, vy, vz, life, tint) {
    const i = this.head; this.head = (this.head + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.max[i] = life;
    const c = tint || this.base;
    this.col.set([c.r, c.g, c.b], i * 3);
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      const c = this.base;
      this.col[k] = c.r * f; this.col[k + 1] = c.g * f; this.col[k + 2] = c.b * f;
      if (this.life[i] <= 0) this.pos[k + 1] = -999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- race world
let world = null;   // { track, scene, cars:Map(seat), pools, trackIdx }
let attract = null; // menu/garage backdrop scene

function headingOf(t) { return Math.atan2(-t.x, -t.z); }

function makeNameSprite(name, colorHex) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const x = c.getContext("2d");
  x.font = "900 34px 'Segoe UI', sans-serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = colorHex; x.shadowBlur = 14;
  x.fillStyle = "#e8eaff";
  x.fillText(name.toUpperCase(), 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(7, 1.75, 1);
  return spr;
}

function buildWorld(trackIdx) {
  disposeWorld();
  const scene = new THREE.Scene();
  const track = buildTrack(THREE, trackIdx, QUALITY);
  scene.add(track.group);
  scene.fog = new THREE.Fog(track.def.fogColor, 40, track.def.fogFar);
  const pools = {
    smoke: new Pool(scene, 140, 0x2e3a52, 2.2, THREE.AdditiveBlending),
    flame: new Pool(scene, 90, 0x66d9ff, 1.7, THREE.AdditiveBlending),
    spark: new Pool(scene, 70, 0xffa030, 1.1, THREE.AdditiveBlending),
    streak: new Pool(scene, 60, 0x8fd0ff, 0.9, THREE.AdditiveBlending)
  };
  world = { scene, track, trackIdx, cars: new Map(), pools };
  drawMiniBase(track);
  return world;
}

function disposeWorld() {
  if (!world) return;
  world.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
  world = null;
}

function addCarToWorld(seat, cust, name, isLocal) {
  const built = buildCar(THREE, cust, { glowTex, flameTex });
  world.scene.add(built.group);
  const colorHex = PALETTE.body[sanitizeCustom(cust).body];
  const entry = {
    seat, built, isLocal, name,
    color: colorHex,
    buf: [], lastH: 0,
    x: 0, y: 0, z: 0, h: 0, sp: 0, drift: false, nitro: false
  };
  if (!isLocal) {
    const spr = makeNameSprite(name || "?", colorHex);
    spr.position.y = 2.6;
    built.group.add(spr);
    entry.nameSpr = spr;
  }
  world.cars.set(seat, entry);
  return entry;
}

// ---------------------------------------------------------------- local car physics
const PHYS = {
  accel: 30, drag: 0.6, brake: 46, revMax: 13,
  steer: 2.5, maxNitroBonus: 16,
  gripLat: 8.2, driftLat: 1.7, nitroAccel: 15
};
const sim = {
  active: false, canDrive: false, finished: false,
  x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0,
  drifting: false, driftGrace: 0,
  nitro: 0, boosting: false,
  idx: 0, cp: 0, lap: 1, lapStart: 0, bestLap: 0,
  wrongTime: 0, offroad: false,
  seat: 0, sendAcc: 0, shake: 0
};

function placeAtGrid(seat) {
  const p = gridPose(world.track, seat);
  sim.x = p.x; sim.y = p.y; sim.z = p.z; sim.h = p.heading;
  sim.vx = sim.vz = 0;
  sim.idx = nearestSample(sim.x, sim.z, true);
  sim.cp = 0; sim.lap = 1;
  sim.nitro = 0; sim.drifting = false; sim.boosting = false;
  sim.finished = false; sim.wrongTime = 0;
}

function nearestSample(x, z, full) {
  const t = world.track, N = t.N;
  let best = -1, bd = Infinity;
  const check = i => {
    const s = t.samples[i];
    const dx = s.x - x, dz = s.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  };
  if (full) { for (let i = 0; i < N; i++) check(i); }
  else { for (let o = -24; o <= 24; o++) check(((sim.idx + o) % N + N) % N); }
  return best;
}

function stepLocal(dt, c) {
  const t = world.track;
  const grip = t.def.grip;
  const fx = -Math.sin(sim.h), fz = -Math.cos(sim.h);
  let speedF = sim.vx * fx + sim.vz * fz;
  let latX = sim.vx - fx * speedF, latZ = sim.vz - fz * speedF;

  if (sim.canDrive && !sim.finished) {
    // throttle / brake
    const gas = c.gas;
    const boosting = c.nitro && sim.nitro > 0.5 && speedF > 5;
    sim.boosting = boosting;
    if (boosting) sim.nitro = Math.max(0, sim.nitro - 30 * dt);
    const accel = PHYS.accel + (boosting ? PHYS.nitroAccel : 0);
    speedF += (gas * accel - PHYS.drag * speedF) * dt;
    if (c.brake > 0) {
      if (speedF > 0.5) speedF -= PHYS.brake * c.brake * dt;
      else speedF = Math.max(-PHYS.revMax, speedF - 8 * c.brake * dt);
    }
    // drift state
    const spd = Math.hypot(sim.vx, sim.vz);
    if (c.drift && speedF > 16 && Math.abs(c.steer) > 0.2) {
      sim.drifting = true; sim.driftGrace = 0.12;
    } else if (c.drift && sim.drifting) {
      sim.driftGrace = 0.12;
    } else {
      sim.driftGrace -= dt;
      if (sim.driftGrace <= 0) sim.drifting = false;
    }
    // steering
    const eff = Math.min(1, spd / 11) / (1 + spd * 0.011);
    let turn = c.steer * PHYS.steer * eff;
    if (sim.drifting) turn *= 1.55;
    sim.h += turn * dt;
    // nitro charge from lateral slip while drifting
    const latSpd = Math.hypot(latX, latZ);
    if (sim.drifting && latSpd > 3.5) sim.nitro = Math.min(100, sim.nitro + 20 * dt);
  } else {
    // coast after finish / before start
    speedF += -PHYS.drag * speedF * dt * 2;
    sim.drifting = false; sim.boosting = false;
  }

  // lateral damping (drift = keep sliding)
  const lat = sim.drifting ? PHYS.driftLat : PHYS.gripLat;
  const damp = Math.exp(-lat * grip * dt);
  latX *= damp; latZ *= damp;

  // clamp top speed
  const maxSp = 52 + (sim.boosting ? PHYS.maxNitroBonus : 0);
  speedF = Math.min(maxSp, speedF);

  sim.vx = fx * speedF + latX;
  sim.vz = fz * speedF + latZ;
  sim.x += sim.vx * dt;
  sim.z += sim.vz * dt;

  // track constraint
  sim.idx = nearestSample(sim.x, sim.z, false);
  const s = t.samples[sim.idx], n = t.normals[sim.idx], tg = t.tangents[sim.idx];
  const dx = sim.x - s.x, dz = sim.z - s.z;
  const d = dx * n.x + dz * n.z;
  const limit = WALL_DIST - 1.1;
  if (Math.abs(d) > limit) {
    const sign = Math.sign(d);
    sim.x -= n.x * (d - sign * limit);
    sim.z -= n.z * (d - sign * limit);
    const vn = sim.vx * n.x + sim.vz * n.z;
    if (vn * sign > 0) {
      sim.vx -= n.x * vn * 1.35;
      sim.vz -= n.z * vn * 1.35;
      const impact = Math.abs(vn);
      if (impact > 6) {
        audio.crash(Math.min(1, impact / 30));
        sim.shake = Math.min(0.9, impact / 26);
        for (let i = 0; i < 10; i++) {
          world.pools.spark.spawn(sim.x + n.x * sign, sim.y + 0.5, sim.z + n.z * sign,
            (Math.random() - 0.5) * 10 - n.x * sign * 6, Math.random() * 6, (Math.random() - 0.5) * 10 - n.z * sign * 6, 0.4);
        }
      }
    }
  }
  sim.offroad = Math.abs(d) > ROAD_HALF + 0.6;
  if (sim.offroad) {
    sim.vx *= Math.exp(-1.5 * dt);
    sim.vz *= Math.exp(-1.5 * dt);
  }
  // height follow
  sim.y += (s.y - sim.y) * Math.min(1, 12 * dt);

  // wrong way
  const along = sim.vx * tg.x + sim.vz * tg.z;
  if (sim.canDrive && !sim.finished && along < -4) sim.wrongTime += dt;
  else sim.wrongTime = 0;

  // checkpoints
  const cpNow = Math.floor(sim.idx / t.cpStep) % CP_COUNT;
  const nextCp = (sim.cp + 1) % CP_COUNT;
  if (cpNow === nextCp && along > 0) {
    sim.cp = cpNow;
    if (net) net.send({ t: "cp", i: cpNow });
    if (cpNow === 0) {
      const now = performance.now();
      const lapMs = now - sim.lapStart;
      if (sim.lap >= 1 && (!sim.bestLap || lapMs < sim.bestLap)) sim.bestLap = lapMs;
      sim.lapStart = now;
      sim.lap++;
      if (practice && sim.lap > world.track.def.laps) {
        finishPractice();
      } else if (sim.lap <= world.track.def.laps) {
        audio.lapChime();
        if (sim.lap === world.track.def.laps) flashNotice(STR.finalLap, 1800);
      }
    }
  }

  // reset onto track
  if (c.reset && sim.canDrive && !sim.finished) {
    const back = t.samples[sim.idx];
    sim.x = back.x; sim.z = back.z; sim.y = back.y;
    sim.h = headingOf(t.tangents[sim.idx]);
    sim.vx = sim.vz = 0;
  }

  // soft car-car collision (cosmetic)
  for (const [, e] of world.cars) {
    if (e.isLocal) continue;
    const ddx = sim.x - e.x, ddz = sim.z - e.z;
    const dd = Math.hypot(ddx, ddz);
    if (dd > 0.01 && dd < 3.0) {
      const push = (3.0 - dd) * 0.5;
      sim.x += (ddx / dd) * push;
      sim.z += (ddz / dd) * push;
      sim.vx += (ddx / dd) * push * 2;
      sim.vz += (ddz / dd) * push * 2;
    }
  }

  // net send ~15Hz
  sim.sendAcc += dt;
  if (net && sim.sendAcc >= 0.066) {
    sim.sendAcc = 0;
    net.send({
      t: "s", x: sim.x, y: sim.y, z: sim.z, h: sim.h,
      sp: Math.hypot(sim.vx, sim.vz), d: sim.drifting ? 1 : 0, n: sim.boosting ? 1 : 0
    });
  }
}

// ---------------------------------------------------------------- visuals per frame
const camPos = new THREE.Vector3(0, 6, 10);
let camFov = 68;

function updateCarVisual(e, dt, speed) {
  const b = e.built;
  b.group.position.set(e.x, e.y, e.z);
  b.group.rotation.y = e.h;
  // wheels
  const spin = speed * dt * 2.4;
  for (const w of b.wheels) w.children.forEach(m => (m.rotation.x -= spin));
  // flames
  const f = e.nitro ? 0.85 : 0;
  b.flameL.material.opacity += (f - b.flameL.material.opacity) * Math.min(1, dt * 14);
  b.flameR.material.opacity = b.flameL.material.opacity;
  if (e.nitro) {
    const sc = 0.8 + Math.random() * 0.5;
    b.flameL.scale.set(sc, sc * (1 + Math.random() * 0.4), 1);
    b.flameR.scale.set(sc, sc * (1 + Math.random() * 0.4), 1);
  }
  // glow pulse
  b.glowMat.opacity = 0.42 + Math.sin(performance.now() * 0.006 + e.seat) * 0.12;
}

function emitCarParticles(e, dt) {
  if (!world) return;
  const fx = -Math.sin(e.h), fz = -Math.cos(e.h);
  const rx = -fz, rz = fx;
  if (e.drift && e.sp > 10) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.7) {
        world.pools.smoke.spawn(
          e.x + rx * side * 0.95 - fx * 1.5, e.y + 0.25, e.z + rz * side * 0.95 - fz * 1.5,
          (Math.random() - 0.5) * 2 - fx * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2 - fz * 2, 0.85);
      }
    }
  }
  if (e.nitro) {
    world.pools.flame.spawn(
      e.x - fx * 2.6, e.y + 0.45, e.z - fz * 2.6,
      -fx * (6 + Math.random() * 4), 0.5, -fz * (6 + Math.random() * 4), 0.35);
  }
}

function updateRemotes(renderTs, dt) {
  for (const [, e] of world.cars) {
    if (e.isLocal) continue;
    const buf = e.buf;
    while (buf.length > 2 && buf[1].ts <= renderTs) buf.shift();
    if (buf.length >= 2) {
      const a = buf[0], b = buf[1];
      const span = Math.max(1, b.ts - a.ts);
      const f = Math.max(0, Math.min(1.25, (renderTs - a.ts) / span));
      e.x = a.x + (b.x - a.x) * f;
      e.y = a.y + (b.y - a.y) * f;
      e.z = a.z + (b.z - a.z) * f;
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      e.h = a.h + dh * f;
      e.sp = a.sp + (b.sp - a.sp) * f;
      e.drift = b.d === 1; e.nitro = b.n === 1;
    } else if (buf.length === 1) {
      const a = buf[0];
      e.x = a.x; e.y = a.y; e.z = a.z; e.h = a.h; e.sp = a.sp;
      e.drift = a.d === 1; e.nitro = a.n === 1;
    }
    updateCarVisual(e, dt, e.sp);
    emitCarParticles(e, dt);
  }
}

function updateCamera(dt, spectate) {
  let tx, ty, tz, th, tsp, boost;
  if (spectate) {
    let target = null;
    for (const [, e] of world.cars) { if (!e.isLocal) { target = e; break; } }
    if (!target) {
      const s = world.track.samples[0];
      camera.position.set(s.x + 30, 40, s.z + 30);
      camera.lookAt(s.x, 0, s.z);
      return;
    }
    tx = target.x; ty = target.y; tz = target.z; th = target.h; tsp = target.sp; boost = target.nitro;
  } else {
    tx = sim.x; ty = sim.y; tz = sim.z; th = sim.h;
    tsp = Math.hypot(sim.vx, sim.vz); boost = sim.boosting;
  }
  const fx = -Math.sin(th), fz = -Math.cos(th);
  const dist = 7.4 + tsp * 0.05;
  const want = new THREE.Vector3(tx - fx * dist, ty + 3.1 + tsp * 0.012, tz - fz * dist);
  camPos.lerp(want, Math.min(1, dt * 5.2));
  let sx = 0, sy = 0;
  if (sim.shake > 0.005) {
    sx = (Math.random() - 0.5) * sim.shake;
    sy = (Math.random() - 0.5) * sim.shake;
    sim.shake *= Math.exp(-6 * dt);
  }
  camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z);
  camera.lookAt(tx + fx * 5.5, ty + 1.1, tz + fz * 5.5);
  const wantFov = boost ? 84 : 68 + tsp * 0.12;
  camFov += (wantFov - camFov) * Math.min(1, dt * 6);
  camera.fov = camFov;
  camera.updateProjectionMatrix();
  $("vignette").style.opacity = boost ? 1 : 0;
}

// ---------------------------------------------------------------- minimap
const miniC = $("minimap");
const miniX = miniC.getContext("2d");
const miniBase = document.createElement("canvas");
miniBase.width = miniBase.height = 264;

function drawMiniBase(track) {
  const x = miniBase.getContext("2d");
  x.clearRect(0, 0, 264, 264);
  x.strokeStyle = "rgba(0,229,255,0.9)";
  x.shadowColor = "#00e5ff"; x.shadowBlur = 8;
  x.lineWidth = 7; x.lineJoin = "round";
  x.beginPath();
  track.mini.forEach(([mx, mz], i) => {
    const px = 16 + mx * 232, pz = 16 + mz * 232;
    i === 0 ? x.moveTo(px, pz) : x.lineTo(px, pz);
  });
  x.closePath(); x.stroke();
  x.shadowBlur = 0;
  x.strokeStyle = "rgba(5,8,16,0.9)"; x.lineWidth = 3.4; x.stroke();
}

function drawMini() {
  miniX.clearRect(0, 0, 264, 264);
  miniX.drawImage(miniBase, 0, 0);
  const dot = (p, color, big) => {
    const [mx, mz] = world.track.miniOf(p);
    miniX.fillStyle = color;
    miniX.shadowColor = color; miniX.shadowBlur = 6;
    miniX.beginPath();
    miniX.arc(16 + mx * 232, 16 + mz * 232, big ? 6 : 4.4, 0, Math.PI * 2);
    miniX.fill();
    miniX.shadowBlur = 0;
  };
  for (const [, e] of world.cars) if (!e.isLocal) dot(e, e.color, false);
  if (!spectator) dot({ x: sim.x, z: sim.z }, "#ffffff", true);
}

// ---------------------------------------------------------------- HUD
function fmtTime(ms) {
  if (!ms || ms < 0) ms = 0;
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), d = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}
let raceStartTime = 0;
let noticeTimer = 0;
function flashNotice(txt, ms) {
  $("notice").textContent = txt;
  noticeTimer = ms / 1000;
}

function myRacePosition() {
  if (!world || spectator) return 1;
  const t = world.track;
  const progress = [];
  const mine = (roomState && progOf(playerId)) || { lap: sim.lap, cp: sim.cp, fin: false, place: 0 };
  for (const p of (roomState ? roomState.players : [])) {
    if (p.seat < 0) continue;
    let idx = 0;
    if (p.id === playerId) idx = sim.idx;
    else {
      const e = world.cars.get(p.seat);
      idx = e ? nearestOf(t, e.x, e.z) : 0;
    }
    const pr = p.id === playerId ? { lap: sim.lap, cp: sim.cp } : p;
    progress.push({
      id: p.id, fin: p.fin, place: p.place,
      score: p.fin ? 1e9 - p.place : (pr.lap * 100000 + pr.cp * 2000 + (idx % t.cpStep))
    });
  }
  if (!progress.length) return 1;
  progress.sort((a, b) => b.score - a.score);
  const i = progress.findIndex(p => p.id === playerId);
  void mine;
  return i < 0 ? 1 : i + 1;
}
function nearestOf(t, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < t.N; i += 4) {
    const s = t.samples[i];
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function progOf(id) {
  if (!roomState) return null;
  return roomState.players.find(p => p.id === id);
}

function updateHUD(dt) {
  const spd = Math.round(Math.hypot(sim.vx, sim.vz) * 3.6);
  $("speed").textContent = spectator ? "" : spd;
  $("speed").style.color = sim.boosting ? "#b44bff" : "#e8eaff";
  $("nitrofill").style.width = sim.nitro.toFixed(0) + "%";
  const laps = world ? world.track.def.laps : 3;
  $("lapPill").innerHTML = spectator ? STR.spectating :
    `${STR.lap} <b>${Math.min(sim.lap, laps)}/${laps}</b>`;
  if (raceStartTime) $("timer").textContent = fmtTime(performance.now() - raceStartTime);
  if (practice) $("posPill").style.display = "none";
  else {
    $("posPill").style.display = "";
    const pos = myRacePosition();
    $("posPill").innerHTML = `${STR.pos} <b>${pos}/${seatedCount()}</b>`;
  }
  if (noticeTimer > 0) {
    noticeTimer -= dt;
    if (noticeTimer <= 0) $("notice").textContent = "";
  } else if (sim.wrongTime > 1.1) {
    $("notice").textContent = STR.wrongWay;
  } else if ($("notice").textContent === STR.wrongWay) {
    $("notice").textContent = "";
  }
  drawMini();
}
function seatedCount() {
  if (!roomState) return 1;
  return roomState.players.filter(p => p.seat >= 0).length;
}

// ---------------------------------------------------------------- network / rooms
let net = null;
let roomState = null;
let spectator = false;
let practice = false;
let joinedRoomId = null;
let tsOffset = 0; // serverTs - perf.now

let netSeq = 0;   // guards against a stale async transport resolving after we moved on

async function joinRoom(code, asHost) {
  leaveRoom();
  const seq = ++netSeq;
  joinedRoomId = code.toUpperCase();
  history.replaceState(null, "", `?room=${joinedRoomId}`);
  let transport;
  try {
    transport = asHost ? await createHost(joinedRoomId, playerId) : await joinHost(joinedRoomId, playerId);
  } catch (e) {
    toast("Network unavailable");
    return;
  }
  if (seq !== netSeq) { transport.close(); return; } // superseded while awaiting
  net = transport;
  net.onMessage = onNetMsg;
  net.onStatus = st => {
    if (st === "open") net.send({ t: "join", id: playerId, name: myName, car: custom });
    else if (st === "taken") { toast("Lobby code taken — try again"); leaveRoom(); backToMenu(); }
    else if (st === "nohost") toast(STR.errNoRoom, 4000);
    else if (st === "closed" && (mode === "lobby" || mode === "race")) toast(STR.disconnected, 4000);
  };
}

function leaveRoom() {
  netSeq++;
  if (net) { net.close(); net = null; }
  roomState = null; spectator = false; joinedRoomId = null;
  history.replaceState(null, "", location.pathname);
}

function backToMenu() {
  show("menu"); mode = "menu";
  buildAttract((Math.random() * TRACKS.length) | 0);
}

function onNetMsg(m) {
  switch (m.t) {
    case "joined":
      spectator = m.seat < 0;
      sim.seat = m.seat;
      if (m.t === "joined" && m.late) {} // late info arrives via room
      break;
    case "room": onRoom(m); break;
    case "count":
      $("center").textContent = m.n;
      audio.beep(false);
      break;
    case "go": onGo(m); break;
    case "snap": onSnap(m); break;
    case "prog": onProg(m); break;
    case "end": onEnd(m); break;
    case "err":
      if (m.code === "notready") toast(STR.needReady);
      break;
  }
}

function onRoom(m) {
  const prevPhase = roomState ? roomState.phase : null;
  roomState = m;
  const me = m.players.find(p => p.id === playerId);
  if (me) { spectator = me.seat < 0; sim.seat = me.seat; }
  if (m.phase === "lobby") {
    if (mode !== "lobby" && mode !== "garage") enterLobbyUI();
    if (mode !== "garage") {
      renderLobby();
      if (!attractWorldMatches(m.track)) buildAttract(m.track);
    }
  } else if (m.phase === "countdown" && prevPhase !== "countdown") {
    startRaceScene();
  } else if (m.phase === "race" && mode !== "race") {
    startRaceScene();
    beginDriving(true); // late join / reconnect mid-race
  }
}

function onGo(m) {
  if (m.late) return;
  beginDriving(false);
}

function beginDriving(late) {
  raceStartTime = performance.now();
  sim.lapStart = raceStartTime;
  sim.canDrive = !spectator;
  sim.active = true;
  if (!late) {
    $("center").textContent = STR.go;
    audio.beep(true);
    setTimeout(() => { if ($("center").textContent === STR.go) $("center").textContent = ""; }, 900);
  } else {
    $("center").textContent = "";
  }
  audio.engineStart();
  show("hud");
  mode = "race";
}

function onSnap(m) {
  if (!world) return;
  tsOffset = tsOffset === 0 ? m.ts - performance.now() : tsOffset * 0.95 + (m.ts - performance.now()) * 0.05;
  for (const c of m.c) {
    const [seat, x, y, z, h, sp, d, n] = c;
    if (seat === sim.seat && !spectator) continue;
    let e = world.cars.get(seat);
    if (!e) {
      const p = roomState && roomState.players.find(q => q.seat === seat);
      e = addCarToWorld(seat, p ? p.car : {}, p ? p.name : "?", false);
    }
    e.buf.push({ ts: m.ts, x, y, z, h, sp, d, n });
    if (e.buf.length > 20) e.buf.splice(0, e.buf.length - 20);
  }
}

function onProg(m) {
  if (!roomState) return;
  for (const p of m.p) {
    const rp = roomState.players.find(q => q.id === p.id);
    if (rp) Object.assign(rp, p);
    if (p.id === playerId && p.fin && !sim.finished) {
      sim.finished = true;
      sim.canDrive = false;
      flashNotice(STR.finished, 2500);
      audio.fanfare();
    }
  }
}

function onEnd(m) {
  audio.engineStop();
  sim.active = false; sim.canDrive = false;
  showResults(m.results);
}

// ---------------------------------------------------------------- screens & flow
let mode = "menu";

function saveIdentity() {
  const v = $("nameInput").value.trim().slice(0, 12);
  myName = v || STR.namePlaceholder;
  localStorage.setItem("vr_name", myName);
}

$("btnCreate").onclick = () => {
  audio.init(); audio.click(); saveIdentity();
  joinRoom(rid(5), true);
  enterLobbyUI();
};
$("btnJoin").onclick = () => {
  audio.init(); audio.click(); saveIdentity();
  const code = $("joinCode").value.trim().toUpperCase();
  if (!code) return toast(STR.errNoRoom);
  joinRoom(code, false);
  enterLobbyUI();
};
$("btnPractice").onclick = () => {
  audio.init(); audio.click(); saveIdentity();
  practice = true;
  leaveRoom();
  const idx = (Math.random() * TRACKS.length) | 0;
  buildWorld(idx);
  const me = addCarToWorld(0, custom, myName, true);
  me.isLocal = true;
  spectator = false; sim.seat = 0;
  placeAtGrid(0);
  toast(STR.trackNames[idx]);
  show("hud");
  mode = "race";
  runLocalCountdown();
};
$("btnGarage").onclick = () => {
  audio.init(); audio.click(); saveIdentity();
  enterGarage();
};
$("btnGarageSave").onclick = () => {
  audio.click();
  localStorage.setItem("vr_car", JSON.stringify(custom));
  if (net) net.send({ t: "cust", name: myName, car: custom });
  exitGarage();
};
$("btnLeave").onclick = () => {
  audio.click();
  leaveRoom();
  show("menu"); mode = "menu";
  buildAttract((Math.random() * TRACKS.length) | 0);
};
$("btnCopy").onclick = async () => {
  audio.click();
  const url = `${location.origin}${location.pathname}?room=${joinedRoomId}`;
  try {
    await navigator.clipboard.writeText(url);
    $("btnCopy").textContent = STR.copied;
    setTimeout(() => ($("btnCopy").textContent = STR.copy), 1400);
  } catch (e) {
    prompt(STR.invite, url);
  }
};
$("btnReady").onclick = () => {
  audio.click();
  if (!net || !roomState) return;
  const me = roomState.players.find(p => p.id === playerId);
  net.send({ t: "ready", v: !(me && me.ready) });
};
$("btnStart").onclick = () => { audio.click(); if (net) net.send({ t: "start" }); };
$("trkPrev").onclick = () => { audio.click(); cycleTrack(-1); };
$("trkNext").onclick = () => { audio.click(); cycleTrack(1); };
$("btnLobbyBack").onclick = () => {
  audio.click();
  if (practice) {
    practice = false;
    show("menu"); mode = "menu";
    buildAttract((Math.random() * TRACKS.length) | 0);
  } else if (net && roomState && roomState.host === playerId) {
    net.send({ t: "lobby" });
  }
};
let muted = false;
$("muteBtn").onclick = () => {
  audio.init();
  muted = !muted;
  audio.setMuted(muted);
  $("muteBtn").style.opacity = muted ? 0.4 : 1;
};
addEventListener("pointerdown", () => { audio.init(); audio.resume(); }, { once: false });

function cycleTrack(d) {
  if (!net || !roomState || roomState.host !== playerId) return;
  const v = ((roomState.track + d) % 6 + 6) % 6;
  net.send({ t: "track", v });
}

function enterLobbyUI() {
  show("lobby");
  mode = "lobby";
  $("roomCode").textContent = joinedRoomId || "-----";
  renderLobby();
}

function renderLobby() {
  if (!roomState) {
    $("lobbyStatus").textContent = STR.waitingPlayers;
    return;
  }
  const isHost = roomState.host === playerId;
  $("trkName").textContent = STR.trackNames[roomState.track];
  $("trkBlurb").textContent = STR.trackBlurbs[roomState.track];
  $("trkPrev").style.visibility = isHost ? "visible" : "hidden";
  $("trkNext").style.visibility = isHost ? "visible" : "hidden";
  const list = $("plist");
  list.innerHTML = "";
  const bySeat = new Map();
  roomState.players.forEach(p => { if (p.seat >= 0) bySeat.set(p.seat, p); });
  for (let s = 0; s < 6; s++) {
    const p = bySeat.get(s);
    const div = document.createElement("div");
    if (!p) {
      div.className = "pcard empty";
      div.textContent = "— OPEN —";
    } else {
      div.className = "pcard";
      const color = PALETTE.body[sanitizeCustom(p.car).body];
      div.innerHTML =
        `<div class="dot" style="background:${color};color:${color}"></div>` +
        `<div class="nm">${esc(p.name)}${p.id === playerId ? " ★" : ""}</div>` +
        (p.id === roomState.host ? `<div class="hostTag">${STR.host}</div>` : "") +
        (p.ready ? `<div class="rdy">${STR.ready}</div>` : "");
      if (!p.connected) div.style.opacity = 0.35;
    }
    list.appendChild(div);
  }
  const me = roomState.players.find(p => p.id === playerId);
  $("btnReady").textContent = me && me.ready ? STR.unready : STR.ready;
  $("btnReady").style.display = spectator ? "none" : "";
  const seated = roomState.players.filter(p => p.seat >= 0 && p.connected);
  const allReady = seated.every(p => p.ready || p.id === roomState.host);
  $("btnStart").style.display = isHost ? "" : "none";
  $("btnStart").classList.toggle("dim", !allReady);
  $("lobbyStatus").textContent = spectator ? STR.spectating :
    (isHost ? (allReady ? "" : STR.needReady) : (seated.length < 2 ? STR.waitingPlayers : STR.waitingHost));
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function startRaceScene() {
  practice = false;
  buildWorld(roomState.track);
  for (const p of roomState.players) {
    if (p.seat < 0) continue;
    const isMe = p.id === playerId && !spectator;
    const e = addCarToWorld(p.seat, p.car, p.name, isMe);
    if (!isMe) {
      const g = gridPose(world.track, p.seat);
      e.x = g.x; e.y = g.y; e.z = g.z; e.h = g.heading;
      updateCarVisual(e, 0.016, 0);
    }
  }
  if (!spectator) placeAtGrid(sim.seat);
  sim.active = true; sim.canDrive = false; sim.finished = false;
  raceStartTime = 0;
  $("center").textContent = "";
  $("notice").textContent = "";
  show("hud");
  mode = "race";
  audio.engineStart();
}

function runLocalCountdown() {
  sim.active = true; sim.canDrive = false;
  placeAtGrid(0);
  audio.engineStart();
  let n = 3;
  const tick = () => {
    if (n > 0) {
      $("center").textContent = n;
      audio.beep(false);
      n--; setTimeout(tick, 1000);
    } else {
      $("center").textContent = STR.go;
      audio.beep(true);
      raceStartTime = performance.now();
      sim.lapStart = raceStartTime;
      sim.canDrive = true;
      setTimeout(() => { if ($("center").textContent === STR.go) $("center").textContent = ""; }, 900);
    }
  };
  setTimeout(tick, 500);
}

function finishPractice() {
  sim.finished = true; sim.canDrive = false;
  audio.fanfare(); audio.engineStop();
  const total = performance.now() - raceStartTime;
  showResults([{ id: playerId, name: myName, car: custom, place: 1, fin: true, ft: total }]);
}

function showResults(results) {
  const box = $("standings");
  box.innerHTML = "";
  results.forEach(r => {
    const div = document.createElement("div");
    div.className = "srow" + (r.place === 1 ? " first" : "");
    const color = PALETTE.body[sanitizeCustom(r.car).body];
    div.innerHTML =
      `<div class="pl">${STR.place[Math.min(5, r.place - 1)] || r.place}</div>` +
      `<div class="dot" style="background:${color};color:${color}"></div>` +
      `<div class="nm">${esc(r.name)}${r.id === playerId ? " ★" : ""}</div>` +
      `<div class="tm">${r.fin ? fmtTime(r.ft) : STR.dnf}</div>`;
    box.appendChild(div);
  });
  const amHost = practice || (roomState && roomState.host === playerId);
  $("btnLobbyBack").style.display = amHost ? "" : "none";
  $("resHint").textContent = amHost ? (sim.bestLap ? `${STR.best}: ${fmtTime(sim.bestLap)}` : "") : STR.waitingRematch;
  show("results");
  mode = "results";
}

// ---------------------------------------------------------------- attract backdrop
let attractIdx = -1, attractT = 0;
function attractWorldMatches(idx) { return world && world._attract && attractIdx === idx; }
function buildAttract(idx) {
  buildWorld(idx);
  world._attract = true;
  attractIdx = idx;
  attractT = 0;
  attractInit = false;   // re-snap camera to the new track
  // a couple of ghost cars cruising for life
  const g1 = addCarToWorld(90, { body: 1, accent: 1, rim: 0, spoiler: 2, glow: 0 }, "", false);
  const g2 = addCarToWorld(91, { body: 0, accent: 0, rim: 1, spoiler: 1, glow: 1 }, "", false);
  g1._ghost = 0; g2._ghost = 0.035;
}
const attractCam = new THREE.Vector3();
const attractLook = new THREE.Vector3();
let attractInit = false;
function updateAttract(dt) {
  if (!world || !world._attract) return;
  attractT += dt * 0.008;
  const t = world.track;
  const N = t.N;
  // continuous sampler: lerp between adjacent track samples (no discrete snapping)
  const at = f => {
    const x = ((((f % 1) + 1) % 1)) * N;
    const i0 = Math.floor(x) % N, i1 = (i0 + 1) % N, fr = x - Math.floor(x);
    const a = t.samples[i0], b = t.samples[i1];
    return { x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr, z: a.z + (b.z - a.z) * fr };
  };
  const p = at(attractT);
  const p2 = at(attractT + 0.02);
  const camTarget = { x: p.x, y: p.y + 7, z: p.z };
  const lookTarget = { x: p2.x, y: p2.y + 2.5, z: p2.z };
  if (!attractInit) {
    attractCam.set(camTarget.x, camTarget.y, camTarget.z);
    attractLook.set(lookTarget.x, lookTarget.y, lookTarget.z);
    attractInit = true;
  }
  const k = Math.min(1, dt * 3.5);
  attractCam.lerp(camTarget, k);
  attractLook.lerp(lookTarget, k);
  camera.position.copy(attractCam);
  camera.lookAt(attractLook);
  camera.fov = 72; camera.updateProjectionMatrix();
  for (const [, e] of world.cars) {
    if (e._ghost === undefined) continue;
    const f = attractT * 3 + e._ghost;
    const a = at(f), b = at(f + 0.008);
    e.x = a.x; e.y = a.y; e.z = a.z;
    e.h = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    e.sp = 30;
    updateCarVisual(e, dt, 30);
  }
}

// ---------------------------------------------------------------- garage
let garage = null;
function enterGarage() {
  disposeWorld();
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060d, 20, 90);
  scene.background = new THREE.Color(0x05060d);
  const grid = new THREE.GridHelper(80, 40, 0x00e5ff, 0x0b1a26);
  grid.position.y = 0;
  scene.add(grid);
  scene.add(new THREE.HemisphereLight(0x4a3a8a, 0x080410, 1.1));
  const key = new THREE.DirectionalLight(0x00e5ff, 0.8); key.position.set(5, 8, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff2d78, 0.9); rim.position.set(-6, 4, -6); scene.add(rim);
  garage = { scene, car: null, spin: 0 };
  rebuildGarageCar();
  buildGarageUI();
  show("garage");
  mode = "garage";
}
function rebuildGarageCar() {
  if (!garage) return;
  if (garage.car) {
    garage.scene.remove(garage.car.group);
  }
  garage.car = buildCar(THREE, custom, { glowTex, flameTex });
  garage.scene.add(garage.car.group);
}
function exitGarage() {
  garage = null;
  if (net && mode !== "race") { enterLobbyUI(); buildAttract(roomState ? roomState.track : 0); }
  else { show("menu"); mode = "menu"; buildAttract((Math.random() * TRACKS.length) | 0); }
}
function buildGarageUI() {
  const mk = (contId, key, colors) => {
    const cont = $(contId);
    cont.innerHTML = "";
    colors.forEach((col, i) => {
      const d = document.createElement("div");
      d.className = "chip" + (custom[key] === i ? " sel" : "");
      d.style.background = col; d.style.color = col;
      d.onclick = () => { audio.click(); custom[key] = i; buildGarageUI(); rebuildGarageCar(); };
      cont.appendChild(d);
    });
  };
  mk("chipsBody", "body", PALETTE.body);
  mk("chipsAccent", "accent", PALETTE.accent);
  mk("chipsRim", "rim", PALETTE.rim);
  mk("chipsGlow", "glow", PALETTE.glow);
  const seg = $("segSpoiler");
  seg.innerHTML = "";
  STR.spoilerNames.forEach((nm, i) => {
    const b = document.createElement("button");
    b.className = "btn" + (custom.spoiler === i ? " sel" : "");
    b.textContent = nm;
    b.onclick = () => { audio.click(); custom.spoiler = i; buildGarageUI(); rebuildGarageCar(); };
    seg.appendChild(b);
  });
}

// ---------------------------------------------------------------- main loop
const STEP = 1 / 60;
let acc = 0, last = performance.now(), paused = false;
let fpsFrames = 0, fpsAt = last;
addEventListener("blur", () => (paused = true));
addEventListener("focus", () => { paused = false; last = performance.now(); });
if (DEV) $("dev").style.display = "block";

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) return;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;

  if (mode === "race" && world && !world._attract) {
    acc += dt;
    const c = readControls();
    while (acc >= STEP) {
      if (sim.active && !spectator) stepLocal(STEP, c);
      acc -= STEP;
    }
    // local car visuals
    if (!spectator) {
      const me = world.cars.get(sim.seat);
      if (me) {
        me.x = sim.x; me.y = sim.y; me.z = sim.z; me.h = sim.h;
        me.sp = Math.hypot(sim.vx, sim.vz);
        me.drift = sim.drifting; me.nitro = sim.boosting;
        updateCarVisual(me, dt, me.sp);
        emitCarParticles(me, dt);
        // drift body roll
        me.built.group.rotation.z = THREE.MathUtils.lerp(
          me.built.group.rotation.z, sim.drifting ? -0.09 * Math.sign(c.steer || 1) : 0, dt * 6);
      }
      audio.engine(Math.min(1, me ? me.sp / 68 : 0), c.gas, sim.drifting, sim.boosting, dt);
    }
    const renderTs = performance.now() + tsOffset - 130;
    if (net) updateRemotes(renderTs, dt);
    for (const k in world.pools) world.pools[k].update(dt);
    updateCamera(dt, spectator);
    updateHUD(dt);
  } else if (world && world._attract) {
    updateAttract(dt);
    for (const k in world.pools) world.pools[k].update(dt);
  } else if (mode === "garage" && garage) {
    garage.spin += dt * 0.5;
    garage.car.group.rotation.y = garage.spin;
    const r = 8.2;
    camera.position.set(Math.sin(0.6) * r, 2.6, Math.cos(0.6) * r);
    camera.lookAt(0, -1.9, 0);
    camera.fov = 50; camera.updateProjectionMatrix();
  }

  const scene = mode === "garage" && garage ? garage.scene : (world ? world.scene : null);
  if (scene) renderer.render(scene, camera);

  if (DEV) {
    fpsFrames++;
    if (now - fpsAt > 500) {
      const fps = Math.round(fpsFrames * 1000 / (now - fpsAt));
      fpsFrames = 0; fpsAt = now;
      $("dev").textContent = `${fps} fps\ncalls ${renderer.info.render.calls}\ntris ${renderer.info.render.triangles}`;
    }
  }
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- boot
const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) {
  $("joinCode").value = urlRoom.toUpperCase();
  if (myName) {
    joinRoom(urlRoom, false);
    enterLobbyUI();
  }
}
buildAttract((Math.random() * TRACKS.length) | 0);
show(mode === "lobby" ? "lobby" : "menu");

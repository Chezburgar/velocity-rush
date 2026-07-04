// Six synthwave circuits: spline layouts, themes, procedural textures, instanced scenery.
// All scenery placement is seeded so every client sees the identical world.

export const CP_COUNT = 16;      // checkpoints per lap (must match server.js)
export const ROAD_HALF = 7;      // half road width
export const SHOULDER = 4;       // slow zone beyond road edge
export const WALL_DIST = ROAD_HALF + SHOULDER; // hard barrier
const SAMPLES = 640;             // spline samples per track

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- themes
export const TRACKS = [
  {
    id: "neon_bay", grip: 1.0, laps: 3,
    sky: ["#05010f", "#1a0b3a", "#ff2d78"], fogColor: 0x0a0620, fogFar: 620,
    hemi: [0x3a2a6a, 0x060410, 0.9], dir: [0x8f7fff, 0.5],
    signal: 0x00e5ff, grid: "#0b3a44", ground: "#04070d",
    sun: { c1: "#ff9a3c", c2: "#ff2d78", size: 220, y: 60, dist: 1300 },
    stars: true, props: "bay",
    pts: [[0,-260],[180,-240],[300,-140],[330,20],[260,160],[140,220],[0,180],[-120,230],[-260,170],[-320,20],[-280,-140],[-150,-230]]
  },
  {
    id: "grid_city", grip: 1.0, laps: 3,
    sky: ["#020208", "#180b2e", "#b44bff"], fogColor: 0x0a0518, fogFar: 560,
    hemi: [0x4a2a7a, 0x05030c, 0.85], dir: [0xff5fd2, 0.45],
    signal: 0xff2d78, grid: "#3a0b34", ground: "#05030a",
    sun: null, stars: true, props: "city",
    pts: [[0,-300],[220,-300],[300,-180],[240,-60],[300,60],[300,220],[140,300],[-40,240],[-180,300],[-320,220],[-300,40],[-180,-40],[-300,-160],[-200,-300]]
  },
  {
    id: "sunset_mesa", grip: 1.0, laps: 3,
    sky: ["#0d0126", "#4a1042", "#ff6a2d"], fogColor: 0x2a0a24, fogFar: 700,
    hemi: [0x6a2a3a, 0x0a0410, 1.0], dir: [0xffa03c, 0.7],
    signal: 0xffa03c, grid: "#3a1a0b", ground: "#0a0508",
    sun: { c1: "#ffd23c", c2: "#ff2d78", size: 340, y: 100, dist: 1300 },
    stars: false, props: "mesa",
    pts: [[0,-350,0],[250,-320,2],[400,-150,6],[380,80,10],[240,240,6],[40,300,2],[-160,260,0],[-300,120,4],[-380,-80,8],[-300,-260,4],[-120,-340,0]]
  },
  {
    id: "ice_circuit", grip: 0.72, laps: 3,
    sky: ["#01040f", "#0a2038", "#7fdfff"], fogColor: 0x081826, fogFar: 580,
    hemi: [0x3a6a8a, 0x040810, 1.0], dir: [0xbfefff, 0.6],
    signal: 0x7fdfff, grid: "#0b2a3a", ground: "#060a12",
    sun: null, stars: true, aurora: true, props: "ice",
    pts: [[0,-220],[150,-200],[220,-90],[140,0],[220,100],[140,200],[0,160],[-140,210],[-230,110],[-140,20],[-220,-80],[-140,-180]]
  },
  {
    id: "laser_jungle", grip: 1.0, laps: 3,
    sky: ["#010806", "#07160e", "#14b060"], fogColor: 0x05180e, fogFar: 540,
    hemi: [0x2a6a4a, 0x030806, 0.9], dir: [0x7fffb0, 0.5],
    signal: 0x3cff8f, grid: "#0b3a22", ground: "#030a06",
    sun: null, stars: true, fireflies: true, props: "jungle",
    pts: [[0,-380],[200,-360],[330,-260],[280,-120],[380,0],[320,140],[180,200],[200,320],[40,380],[-140,330],[-120,200],[-280,160],[-380,20],[-300,-120],[-340,-260],[-180,-330]]
  },
  {
    id: "volcanic_core", grip: 1.0, laps: 3,
    sky: ["#0a0104", "#38060e", "#ff4020"], fogColor: 0x200608, fogFar: 520,
    hemi: [0x6a2a1a, 0x0a0304, 0.95], dir: [0xff6a3c, 0.65],
    signal: 0xff4020, grid: "#3a0e0b", ground: "#0a0405",
    sun: null, stars: false, embers: true, props: "volcano",
    pts: [[0,-300,0],[200,-280,5],[320,-160,12],[340,40,18],[240,200,12],[60,280,6],[-120,240,2],[-100,120,8],[-260,60,14],[-340,-80,10],[-260,-220,4],[-100,-260,0]]
  }
];

// ---------------------------------------------------------------- canvas textures
export function makeGlowTex(inner = "#ffffff", outer = "rgba(0,0,0,0)") {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(0.4, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
}

export function makeFlameTex() {
  const c = document.createElement("canvas"); c.width = 32; c.height = 64;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.25, "rgba(120,220,255,0.9)");
  g.addColorStop(0.6, "rgba(255,140,40,0.7)");
  g.addColorStop(1, "rgba(255,40,20,0)");
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(16, 26, 12, 26, 0, 0, Math.PI * 2);
  x.fill();
  return c;
}

function makeRoadTex(THREE, signalHex, rng) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const x = c.getContext("2d");
  x.fillStyle = "#0b0d16"; x.fillRect(0, 0, 256, 256);
  // asphalt speckle
  for (let i = 0; i < 900; i++) {
    x.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.25)";
    x.fillRect((rng() * 256) | 0, (rng() * 256) | 0, 2, 2);
  }
  const sig = "#" + signalHex.toString(16).padStart(6, "0");
  // edge neon strips with glow (drawn wide+faint then narrow+bright)
  for (const ex of [6, 250]) {
    x.fillStyle = sig; x.globalAlpha = 0.22; x.fillRect(ex - 8, 0, 16, 256);
    x.globalAlpha = 1; x.fillRect(ex - 2, 0, 4, 256);
  }
  // center dashes
  x.globalAlpha = 0.5; x.fillStyle = "#e8eaff";
  for (let y = 0; y < 256; y += 64) x.fillRect(126, y, 4, 30);
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function makeGridTex(THREE, lineColor, bg) {
  const c = document.createElement("canvas"); c.width = 128; c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = lineColor; x.lineWidth = 3; x.globalAlpha = 0.35;
  x.strokeRect(-2, -2, 132, 132);
  x.globalAlpha = 1; x.lineWidth = 1.4;
  x.beginPath(); x.moveTo(0, 0.5); x.lineTo(128, 0.5); x.moveTo(0.5, 0); x.lineTo(0.5, 128); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeWindowTex(THREE, rng) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = "#05060c"; x.fillRect(0, 0, 64, 128);
  const cols = ["#00e5ff", "#ff2d78", "#ffd23c", "#b44bff", "#e8eaff"];
  for (let j = 6; j < 122; j += 10) for (let i = 4; i < 60; i += 10) {
    if (rng() < 0.42) {
      x.fillStyle = cols[(rng() * cols.length) | 0];
      x.globalAlpha = 0.35 + rng() * 0.6;
      x.fillRect(i, j, 5, 6);
    }
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeSunTex(c1, c2) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  x.fillStyle = g;
  x.beginPath(); x.arc(128, 128, 124, 0, Math.PI * 2); x.fill();
  // retro scanline gaps in the lower half
  x.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 7; i++) {
    const y = 140 + i * 16;
    x.fillRect(0, y, 256, 3 + i * 1.2);
  }
  return c;
}

// ---------------------------------------------------------------- track builder
export function buildTrack(THREE, idx, quality) {
  const def = TRACKS[idx];
  const rng = mulberry32(1337 + idx * 7919);
  const group = new THREE.Group();

  const pts = def.pts.map(p => new THREE.Vector3(p[0], p[2] || 0, p[1]));
  const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
  const samples = curve.getSpacedPoints(SAMPLES); // SAMPLES+1 pts, last == first
  samples.pop();
  const N = samples.length;
  const tangents = [], normals = [];
  for (let i = 0; i < N; i++) {
    const t = samples[(i + 1) % N].clone().sub(samples[(i - 1 + N) % N]).normalize();
    tangents.push(t);
    normals.push(new THREE.Vector3(-t.z, 0, t.x)); // left-hand perpendicular
  }
  const segLen = curve.getLength() / N;

  // --- road ribbon
  const roadGeo = ribbon(THREE, samples, normals, -ROAD_HALF, ROAD_HALF, 0.02, segLen);
  const roadTex = makeRoadTex(THREE, def.signal, rng);
  roadTex.repeat.set(1, 1);
  const road = new THREE.Mesh(roadGeo, new THREE.MeshBasicMaterial({ map: roadTex }));
  group.add(road);

  // --- edge glow ribbons
  const sigColor = new THREE.Color(def.signal);
  for (const [a, b] of [[-ROAD_HALF - 0.9, -ROAD_HALF + 0.15], [ROAD_HALF - 0.15, ROAD_HALF + 0.9]]) {
    const glowGeo = ribbon(THREE, samples, normals, a, b, 0.06, segLen);
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: sigColor, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    group.add(glow);
  }

  // --- barrier walls (vertical ribbons at wall distance)
  for (const side of [-1, 1]) {
    const wallGeo = wallRibbon(THREE, samples, normals, side * WALL_DIST, 1.4, segLen);
    const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({
      color: sigColor, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    group.add(wall);
    // wall top light line
    const topGeo = wallTopLine(THREE, samples, normals, side * WALL_DIST, 1.4);
    const top = new THREE.LineLoop(topGeo, new THREE.LineBasicMaterial({
      color: sigColor, transparent: true, opacity: 0.9
    }));
    group.add(top);
  }

  // --- ground + sky
  const groundTex = makeGridTex(THREE, def.grid, def.ground);
  groundTex.repeat.set(160, 160);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6400, 6400),
    new THREE.MeshBasicMaterial({ map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  group.add(ground);

  const skyGeo = new THREE.SphereGeometry(1500, 24, 12);
  const skyCanvas = document.createElement("canvas"); skyCanvas.width = 4; skyCanvas.height = 256;
  const sx = skyCanvas.getContext("2d");
  const sg = sx.createLinearGradient(0, 0, 0, 256);
  sg.addColorStop(0, def.sky[0]); sg.addColorStop(0.60, def.sky[1]); sg.addColorStop(0.735, def.sky[2]); sg.addColorStop(0.78, def.sky[1]); sg.addColorStop(1, def.sky[0]);
  sx.fillStyle = sg; sx.fillRect(0, 0, 4, 256);
  const skyMat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(skyCanvas), side: THREE.BackSide, fog: false, depthWrite: false
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -10;
  group.add(sky);

  if (def.stars) {
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i++) {
      const th = rng() * Math.PI * 2, ph = rng() * Math.PI * 0.42;
      sp[i * 3] = 1400 * Math.sin(ph) * Math.cos(th);
      sp[i * 3 + 1] = 1400 * Math.cos(ph) * 0.6 + 120;
      sp[i * 3 + 2] = 1400 * Math.sin(ph) * Math.sin(th);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcfe8ff, size: 2.2, sizeAttenuation: false, fog: false,
      transparent: true, opacity: 0.8
    }));
    group.add(stars);
  }

  if (def.sun) {
    const sunTex = new THREE.CanvasTexture(makeSunTex(def.sun.c1, def.sun.c2));
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(def.sun.size, def.sun.size),
      new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false })
    );
    sun.position.set(0, def.sun.y, -def.sun.dist);
    sun.renderOrder = -9;
    group.add(sun);
  }

  if (def.aurora) {
    const aGeo = new THREE.PlaneGeometry(2600, 300, 32, 1);
    const ap = aGeo.attributes.position;
    for (let i = 0; i < ap.count; i++) ap.setZ(i, Math.sin(ap.getX(i) * 0.004) * 120);
    const aurora = new THREE.Mesh(aGeo, new THREE.MeshBasicMaterial({
      color: 0x3cff8f, transparent: true, opacity: 0.12, fog: false,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    aurora.position.set(0, 420, -700);
    aurora.rotation.x = 0.35;
    group.add(aurora);
  }

  // --- lighting
  const hemi = new THREE.HemisphereLight(def.hemi[0], def.hemi[1], def.hemi[2]);
  group.add(hemi);
  const dir = new THREE.DirectionalLight(def.dir[0], def.dir[1]);
  dir.position.set(-200, 300, -100);
  group.add(dir);
  const amb = new THREE.AmbientLight(0x1a1a2e, 0.7);
  group.add(amb);

  // --- pylons along the track (all themes) — motion cues + glow
  addPylons(THREE, group, samples, normals, sigColor, rng, quality);

  // --- theme scenery
  addProps(THREE, group, def, samples, rng, quality);

  // --- start gantry
  addGantry(THREE, group, samples, normals, tangents, sigColor);

  // checkpoint sample indices (cp k spans sample floor(k*N/CP))
  const cpStep = N / CP_COUNT;

  // minimap polyline (normalized 0..1)
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of samples) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const spanX = maxX - minX, spanZ = maxZ - minZ, span = Math.max(spanX, spanZ);
  const mini = samples.map(p => [
    (p.x - minX + (span - spanX) / 2) / span,
    (p.z - minZ + (span - spanZ) / 2) / span
  ]);
  const miniOf = p => [
    (p.x - minX + (span - spanX) / 2) / span,
    (p.z - minZ + (span - spanZ) / 2) / span
  ];

  return { def, group, samples, tangents, normals, segLen, N, cpStep, mini, miniOf, curveLen: curve.getLength() };
}

function ribbon(THREE, samples, normals, offA, offB, y, segLen) {
  const N = samples.length;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const s = samples[i % N], n = normals[i % N];
    const a = 2 * i, b = 2 * i + 1;
    pos[a * 3] = s.x + n.x * offA; pos[a * 3 + 1] = s.y + y; pos[a * 3 + 2] = s.z + n.z * offA;
    pos[b * 3] = s.x + n.x * offB; pos[b * 3 + 1] = s.y + y; pos[b * 3 + 2] = s.z + n.z * offB;
    const v = i * segLen / 12;
    uv[a * 2] = 0; uv[a * 2 + 1] = v;
    uv[b * 2] = 1; uv[b * 2 + 1] = v;
    if (i < N) idx.push(a, b, a + 2, b, b + 2, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function wallRibbon(THREE, samples, normals, off, h, segLen) {
  const N = samples.length;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const s = samples[i % N], n = normals[i % N];
    const a = 2 * i, b = 2 * i + 1;
    pos[a * 3] = s.x + n.x * off; pos[a * 3 + 1] = s.y; pos[a * 3 + 2] = s.z + n.z * off;
    pos[b * 3] = s.x + n.x * off; pos[b * 3 + 1] = s.y + h; pos[b * 3 + 2] = s.z + n.z * off;
    if (i < N) idx.push(a, b, a + 2, b, b + 2, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function wallTopLine(THREE, samples, normals, off, h) {
  const N = samples.length;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const s = samples[i], n = normals[i];
    pos[i * 3] = s.x + n.x * off; pos[i * 3 + 1] = s.y + h; pos[i * 3 + 2] = s.z + n.z * off;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

function addPylons(THREE, group, samples, normals, sigColor, rng, quality) {
  const N = samples.length;
  const step = 26;
  const count = Math.floor(N / step);
  const postGeo = new THREE.CylinderGeometry(0.12, 0.16, 5, 5);
  const postMat = new THREE.MeshBasicMaterial({ color: 0x141824 });
  const orbGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const orbMat = new THREE.MeshBasicMaterial({ color: sigColor });
  const posts = new THREE.InstancedMesh(postGeo, postMat, count);
  const orbs = new THREE.InstancedMesh(orbGeo, orbMat, count);
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const i = k * step, side = k % 2 === 0 ? 1 : -1;
    const s = samples[i], n = normals[i];
    const x = s.x + n.x * (WALL_DIST + 2.2), z = s.z + n.z * (WALL_DIST + 2.2);
    m.makeTranslation(x, s.y + 2.5, z);
    posts.setMatrixAt(k, m);
    m.makeTranslation(x, s.y + 5.2, z);
    orbs.setMatrixAt(k, m);
    void side;
  }
  group.add(posts); group.add(orbs);
}

function farEnoughFromTrack(samples, x, z, minD) {
  const min2 = minD * minD;
  for (let i = 0; i < samples.length; i += 6) {
    const dx = samples[i].x - x, dz = samples[i].z - z;
    if (dx * dx + dz * dz < min2) return false;
  }
  return true;
}

function scatter(samples, rng, count, dMin, dMax, clearance) {
  const out = [];
  let guard = count * 14;
  while (out.length < count && guard-- > 0) {
    const i = (rng() * samples.length) | 0;
    const s = samples[i];
    const ang = rng() * Math.PI * 2;
    const d = dMin + rng() * (dMax - dMin);
    const x = s.x + Math.cos(ang) * d, z = s.z + Math.sin(ang) * d;
    if (farEnoughFromTrack(samples, x, z, clearance)) out.push([x, z, rng]);
  }
  return out;
}

function addProps(THREE, group, def, samples, rng, quality) {
  const q = quality === 0 ? 0.55 : 1;
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3(), pos = new THREE.Vector3();

  if (def.props === "bay") {
    const spots = scatter(samples, rng, Math.floor(90 * q), 16, 90, 14);
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 9, 5);
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x0d2a38 });
    const frondGeo = new THREE.BoxGeometry(0.35, 0.1, 4.2);
    const frondMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length * 5);
    let f = 0;
    spots.forEach(([x, z], i) => {
      const lean = (rng() - 0.5) * 0.25;
      qt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean);
      m.compose(pos.set(x, 4.5, z), qt, sc.set(1, 1, 1));
      trunks.setMatrixAt(i, m);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rng();
        qt.setFromAxisAngle(up, a);
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5);
        qt.multiply(tilt);
        m.compose(pos.set(x + Math.sin(a) * 1.6, 9 + rng() * 0.4, z + Math.cos(a) * 1.6), qt, sc.set(1, 1, 1));
        fronds.setMatrixAt(f++, m);
      }
    });
    group.add(trunks); group.add(fronds);
  }

  if (def.props === "city") {
    const spots = scatter(samples, rng, Math.floor(130 * q), 26, 150, 22);
    const winTex = makeWindowTex(THREE, rng);
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0);
    const bMat = new THREE.MeshBasicMaterial({ map: winTex });
    const roofMat = new THREE.MeshBasicMaterial({ color: 0xff2d78 });
    const roofGeo = new THREE.BoxGeometry(1, 0.02, 1);
    const buildings = new THREE.InstancedMesh(bGeo, bMat, spots.length);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, spots.length);
    spots.forEach(([x, z], i) => {
      const w = 10 + rng() * 16, h = 22 + rng() * 75, d = 10 + rng() * 16;
      qt.setFromAxisAngle(up, (rng() * 4 | 0) * Math.PI / 2);
      m.compose(pos.set(x, 0, z), qt, sc.set(w, h, d));
      buildings.setMatrixAt(i, m);
      m.compose(pos.set(x, h + 0.2, z), qt, sc.set(w * 1.02, 1, d * 1.02));
      roofs.setMatrixAt(i, m);
    });
    group.add(buildings); group.add(roofs);
  }

  if (def.props === "mesa") {
    const spots = scatter(samples, rng, Math.floor(60 * q), 40, 200, 34);
    const mGeo = new THREE.CylinderGeometry(0.55, 1, 1, 7);
    mGeo.translate(0, 0.5, 0);
    const mMat = new THREE.MeshLambertMaterial({ color: 0x2a1220, emissive: 0x38100a, emissiveIntensity: 0.5 });
    const mesas = new THREE.InstancedMesh(mGeo, mMat, spots.length);
    spots.forEach(([x, z], i) => {
      const r = 16 + rng() * 34, h = 14 + rng() * 30;
      qt.setFromAxisAngle(up, rng() * Math.PI);
      m.compose(pos.set(x, 0, z), qt, sc.set(r, h, r));
      mesas.setMatrixAt(i, m);
    });
    group.add(mesas);
    // cacti near the road
    const cSpots = scatter(samples, rng, Math.floor(40 * q), 14, 40, 13);
    const cGeo = new THREE.CylinderGeometry(0.3, 0.35, 4, 5);
    cGeo.translate(0, 2, 0);
    const cMat = new THREE.MeshBasicMaterial({ color: 0x0d5a3a });
    const cacti = new THREE.InstancedMesh(cGeo, cMat, cSpots.length);
    cSpots.forEach(([x, z], i) => {
      m.compose(pos.set(x, 0, z), qt.setFromAxisAngle(up, rng()), sc.set(1, 0.8 + rng() * 0.6, 1));
      cacti.setMatrixAt(i, m);
    });
    group.add(cacti);
  }

  if (def.props === "ice") {
    const spots = scatter(samples, rng, Math.floor(110 * q), 15, 110, 13);
    const cGeo = new THREE.OctahedronGeometry(1, 0);
    cGeo.translate(0, 0.8, 0);
    const cMat = new THREE.MeshLambertMaterial({ color: 0x9fdfff, emissive: 0x2a7a9a, emissiveIntensity: 0.7, transparent: true, opacity: 0.9 });
    const crystals = new THREE.InstancedMesh(cGeo, cMat, spots.length);
    spots.forEach(([x, z], i) => {
      const s = 1.5 + rng() * 5;
      qt.setFromAxisAngle(up, rng() * Math.PI);
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rng() - 0.5) * 0.5);
      qt.multiply(tilt);
      m.compose(pos.set(x, 0, z), qt, sc.set(s, s * (1.4 + rng()), s));
      crystals.setMatrixAt(i, m);
    });
    group.add(crystals);
  }

  if (def.props === "jungle") {
    const spots = scatter(samples, rng, Math.floor(140 * q), 15, 100, 13);
    const tGeo = new THREE.CylinderGeometry(0.3, 0.5, 6, 5);
    tGeo.translate(0, 3, 0);
    const tMat = new THREE.MeshBasicMaterial({ color: 0x0a1a10 });
    const kGeo = new THREE.ConeGeometry(2.6, 6, 6);
    kGeo.translate(0, 8, 0);
    const kMat = new THREE.MeshLambertMaterial({ color: 0x0d3a1e, emissive: 0x0a3a1c, emissiveIntensity: 0.7 });
    const trunks = new THREE.InstancedMesh(tGeo, tMat, spots.length);
    const canopy = new THREE.InstancedMesh(kGeo, kMat, spots.length);
    spots.forEach(([x, z], i) => {
      const s = 0.7 + rng() * 1.1;
      qt.setFromAxisAngle(up, rng() * Math.PI);
      m.compose(pos.set(x, 0, z), qt, sc.set(s, s, s));
      trunks.setMatrixAt(i, m);
      canopy.setMatrixAt(i, m);
    });
    group.add(trunks); group.add(canopy);
    // ruin arches
    const aSpots = scatter(samples, rng, Math.floor(10 * q), 18, 45, 16);
    const aGeo = new THREE.BoxGeometry(1, 1, 1);
    const aMat = new THREE.MeshLambertMaterial({ color: 0x22303a, emissive: 0x0d3a2e, emissiveIntensity: 0.4 });
    const arches = new THREE.InstancedMesh(aGeo, aMat, aSpots.length * 3);
    let ai = 0;
    aSpots.forEach(([x, z]) => {
      const ang = rng() * Math.PI;
      qt.setFromAxisAngle(up, ang);
      const ox = Math.cos(ang) * 4, oz = -Math.sin(ang) * 4;
      m.compose(pos.set(x - ox, 4, z - oz), qt, sc.set(1.6, 8, 1.6)); arches.setMatrixAt(ai++, m);
      m.compose(pos.set(x + ox, 4, z + oz), qt, sc.set(1.6, 8, 1.6)); arches.setMatrixAt(ai++, m);
      m.compose(pos.set(x, 8.6, z), qt, sc.set(10.4, 1.4, 1.6)); arches.setMatrixAt(ai++, m);
    });
    group.add(arches);
  }

  if (def.props === "volcano") {
    const spots = scatter(samples, rng, Math.floor(100 * q), 15, 110, 13);
    const rGeo = new THREE.IcosahedronGeometry(1, 0);
    rGeo.translate(0, 0.6, 0);
    const rMat = new THREE.MeshLambertMaterial({ color: 0x180c0e, emissive: 0x501008, emissiveIntensity: 0.6 });
    const rocks = new THREE.InstancedMesh(rGeo, rMat, spots.length);
    spots.forEach(([x, z], i) => {
      const s = 1.5 + rng() * 6;
      qt.setFromAxisAngle(up, rng() * Math.PI);
      m.compose(pos.set(x, 0, z), qt, sc.set(s, s * (0.5 + rng() * 0.7), s));
      rocks.setMatrixAt(i, m);
    });
    group.add(rocks);
    // lava pools: additive glowing discs
    const lSpots = scatter(samples, rng, Math.floor(36 * q), 16, 90, 14);
    const lGeo = new THREE.CircleGeometry(1, 10);
    const lMat = new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const lava = new THREE.InstancedMesh(lGeo, lMat, lSpots.length);
    const rx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    lSpots.forEach(([x, z], i) => {
      const s = 3 + rng() * 9;
      m.compose(pos.set(x, 0.02, z), rx, sc.set(s, s, 1));
      lava.setMatrixAt(i, m);
    });
    group.add(lava);
  }
}

function addGantry(THREE, group, samples, normals, tangents, sigColor) {
  const s = samples[0], n = normals[0];
  const mat = new THREE.MeshBasicMaterial({ color: 0x141824 });
  const neon = new THREE.MeshBasicMaterial({ color: sigColor });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), mat);
    post.position.set(s.x + n.x * side * (WALL_DIST + 1), s.y + 4, s.z + n.z * side * (WALL_DIST + 1));
    group.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((WALL_DIST + 1) * 2 + 0.6, 1.2, 0.8), mat);
  beam.position.set(s.x, s.y + 8, s.z);
  beam.rotation.y = Math.atan2(n.x, n.z) + Math.PI / 2;
  group.add(beam);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry((WALL_DIST + 1) * 2, 0.25, 0.85), neon);
  stripe.position.set(s.x, s.y + 7.5, s.z);
  stripe.rotation.y = beam.rotation.y;
  group.add(stripe);
  // start line on the road
  const lineC = document.createElement("canvas"); lineC.width = 64; lineC.height = 8;
  const lx = lineC.getContext("2d");
  for (let i = 0; i < 16; i++) { lx.fillStyle = i % 2 ? "#e8eaff" : "#10131f"; lx.fillRect(i * 4, 0, 4, 4); lx.fillStyle = i % 2 ? "#10131f" : "#e8eaff"; lx.fillRect(i * 4, 4, 4, 4); }
  const lineTex = new THREE.CanvasTexture(lineC);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 2.4), new THREE.MeshBasicMaterial({ map: lineTex, transparent: true }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(n.x, n.z) + Math.PI / 2;
  line.position.set(s.x, s.y + 0.05, s.z);
  group.add(line);
}

// grid slot for seat i (0-5): behind the start line, 2 columns
export function gridPose(track, seat) {
  const N = track.N;
  const row = Math.floor(seat / 2), col = seat % 2;
  const back = 5 + row * 8;
  const idx = (N - Math.round(back / track.segLen) + N) % N;
  const s = track.samples[idx], n = track.normals[idx], t = track.tangents[idx];
  const lat = (col === 0 ? -1 : 1) * 3.2;
  return {
    x: s.x + n.x * lat, y: s.y, z: s.z + n.z * lat,
    heading: Math.atan2(-t.x, -t.z)
  };
}

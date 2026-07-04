// Procedural low-poly synthwave racer with customization slots.
// Customization = { body, accent, rim, spoiler, glow, name }
export const PALETTE = {
  body:   ["#ff2d78", "#00e5ff", "#b44bff", "#ffd23c", "#3cff8f", "#ff6a2d", "#f2f4ff", "#20242e"],
  accent: ["#00e5ff", "#ff2d78", "#ffd23c", "#b44bff", "#3cff8f", "#ffffff"],
  rim:    ["#00e5ff", "#ff2d78", "#ffd23c", "#ffffff", "#b44bff", "#3cff8f"],
  glow:   ["#00e5ff", "#ff2d78", "#b44bff", "#3cff8f", "#ffd23c", "#ff6a2d"]
};

export const DEFAULT_CUSTOM = { body: 0, accent: 0, rim: 0, spoiler: 2, glow: 0, name: "" };

export function sanitizeCustom(c) {
  const s = Object.assign({}, DEFAULT_CUSTOM, c || {});
  s.body = clampIdx(s.body, PALETTE.body.length);
  s.accent = clampIdx(s.accent, PALETTE.accent.length);
  s.rim = clampIdx(s.rim, PALETTE.rim.length);
  s.glow = clampIdx(s.glow, PALETTE.glow.length);
  s.spoiler = clampIdx(s.spoiler, 3);
  s.name = String(s.name || "").slice(0, 12);
  return s;
}
function clampIdx(v, n) { v = parseInt(v, 10); return isNaN(v) ? 0 : Math.max(0, Math.min(n - 1, v)); }

// Returns { group, wheels:[], glowMat, flameL, flameR, bodyMats } — car faces -Z forward.
export function buildCar(THREE, custom, opts = {}) {
  const c = sanitizeCustom(custom);
  const bodyColor = new THREE.Color(PALETTE.body[c.body]);
  const accentColor = new THREE.Color(PALETTE.accent[c.accent]);
  const rimColor = new THREE.Color(PALETTE.rim[c.rim]);
  const glowColor = new THREE.Color(PALETTE.glow[c.glow]);

  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor, metalness: 0.75, roughness: 0.28,
    emissive: bodyColor.clone().multiplyScalar(0.08)
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161e, metalness: 0.6, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0d18, metalness: 0.9, roughness: 0.1, emissive: 0x101a30 });
  const accentMat = new THREE.MeshBasicMaterial({ color: accentColor });
  const rimMat = new THREE.MeshBasicMaterial({ color: rimColor });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2040 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xdffcff });

  // hull — wedge: low nose, higher tail (built from boxes; cheap and crisp)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 4.4), bodyMat);
  hull.position.y = 0.42;
  g.add(hull);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.26, 1.5), bodyMat);
  nose.position.set(0, 0.34, -2.6);
  nose.rotation.x = 0.10;
  g.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.42, 1.9), glassMat);
  cabin.position.set(0, 0.78, 0.25);
  cabin.rotation.x = -0.06;
  g.add(cabin);
  const intake = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.7), darkMat);
  intake.position.set(0, 0.62, 1.85);
  g.add(intake);
  // side skirts
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 3.6), darkMat);
    skirt.position.set(sx * 1.0, 0.26, 0);
    g.add(skirt);
  }

  // neon accent strips along the hull edges + nose chevron
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 4.2), accentMat);
    strip.position.set(sx * 0.96, 0.62, -0.1);
    g.add(strip);
  }
  const chev = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.08), accentMat);
  chev.position.set(0, 0.5, -2.9);
  g.add(chev);

  // headlights / tail bar
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.06), headMat);
    hl.position.set(sx * 0.55, 0.42, -3.28);
    g.add(hl);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.10, 0.06), tailMat);
  tail.position.set(0, 0.56, 2.22);
  g.add(tail);

  // spoiler variants
  if (c.spoiler === 1) { // ducktail
    const duck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.5), bodyMat);
    duck.position.set(0, 0.72, 2.0);
    duck.rotation.x = -0.35;
    g.add(duck);
  } else if (c.spoiler === 2) { // GT wing
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.5), bodyMat);
    wing.position.set(0, 1.06, 2.05);
    wing.rotation.x = -0.13;
    g.add(wing);
    const wingEdge = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.05, 0.06), accentMat);
    wingEdge.position.set(0, 1.08, 1.83);
    g.add(wingEdge);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.2), darkMat);
      post.position.set(sx * 0.75, 0.84, 2.1);
      g.add(post);
    }
  }

  // wheels: dark tire + neon rim disc
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.34, 8);
  for (const [sx, sz] of [[-1, -1.45], [1, -1.45], [-1, 1.5], [1, 1.5]]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, darkMat);
    tire.rotation.z = Math.PI / 2;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    w.add(tire); w.add(rim);
    w.position.set(sx * 0.95, 0.42, sz);
    g.add(w);
    wheels.push(w);
  }

  // underglow: additive plane below the car
  const glowMat = new THREE.MeshBasicMaterial({
    color: glowColor, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
    map: opts.glowTex || null
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.6), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  g.add(glow);

  // nitro flame anchors (billboard planes, hidden until boosting)
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffa030, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    map: opts.flameTex || null, side: THREE.DoubleSide
  });
  const flameGeo = new THREE.PlaneGeometry(0.5, 1.6);
  const flameL = new THREE.Mesh(flameGeo, flameMat.clone());
  const flameR = new THREE.Mesh(flameGeo, flameMat.clone());
  flameL.position.set(-0.5, 0.45, 2.6);
  flameR.position.set(0.5, 0.45, 2.6);
  flameL.rotation.x = flameR.rotation.x = Math.PI / 2.6;
  g.add(flameL); g.add(flameR);

  return { group: g, wheels, glowMat, flameL, flameR, bodyMat, accentMat, rimMat, glowColor };
}

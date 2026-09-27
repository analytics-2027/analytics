import * as THREE from 'three';

// Générateur pseudo-aléatoire déterministe (le décor est identique à chaque chargement)
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Blocs de sièges rouges / jaunes / orange avec des spectateurs
function crowdTexture(): THREE.CanvasTexture {
  const rnd = rng(7);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  const seats = ['#a91d27', '#c5252f', '#e2b100', '#efc21a', '#e46f1c'];
  for (let x = 0; x < c.width; ) {
    const w = 20 + Math.floor(rnd() * 60);
    g.fillStyle = seats[Math.floor(rnd() * seats.length)];
    g.fillRect(x, 0, w, c.height);
    x += w;
  }
  g.fillStyle = 'rgba(0,0,0,.18)';
  for (let y = 8; y < c.height; y += 16) g.fillRect(0, y, c.width, 2);
  const people = ['#f1cfb3', '#3a2a20', '#e9e9e9', '#2b6cb0', '#d33a3a', '#222222', '#f7f7f7', '#f0a020'];
  for (let i = 0; i < 900; i++) {
    g.fillStyle = people[Math.floor(rnd() * people.length)];
    g.fillRect(Math.floor(rnd() * c.width), Math.floor(rnd() * c.height), 3, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface StandSpec {
  along: 'x' | 'y';
  center: number; // milieu de la tribune le long de son axe (m)
  len: number;
  side: 1 | -1; // côté du terrain (+ / -)
  edge: number; // distance de la ligne (touche ou but) au bord du terrain (m)
  gap: number; // espace entre la ligne et la première rangée
  tiers: number;
  roof: boolean;
}

// repère terrain (x, y) -> three.js (x, y haut, -y)
function tieredStand(spec: StandSpec, tex: THREE.CanvasTexture, concrete: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const depth = 1.1;
  const rise = 0.72;
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(spec.len / 14, 1);
  const seat = new THREE.MeshLambertMaterial({ map: t });
  // face de la marche tournée vers le terrain (indices BoxGeometry : +x, -x, +y, -y, +z, -z)
  const facing = spec.along === 'x' ? (spec.side === 1 ? 4 : 5) : spec.side === 1 ? 1 : 0;
  for (let k = 0; k < spec.tiers; k++) {
    const h = 0.8 + (k + 1) * rise;
    const off = spec.edge + spec.gap + depth * (k + 0.5);
    const dims: [number, number, number] = spec.along === 'x' ? [spec.len, h, depth] : [depth, h, spec.len];
    // la texture se répète en hauteur et est calée sur le haut de la marche (seule sa bande supérieure est visible)
    const rt = tex.clone();
    rt.needsUpdate = true;
    const reps = h / 0.9;
    rt.repeat.set(spec.len / 14, reps);
    rt.offset.set(0, (((1 - reps) % 1) + 1) % 1);
    const riser = new THREE.MeshLambertMaterial({ map: rt });
    const mats = [concrete, concrete, seat, concrete, concrete, concrete];
    mats[facing] = riser;
    const m = new THREE.Mesh(new THREE.BoxGeometry(...dims), mats);
    if (spec.along === 'x') m.position.set(spec.center, h / 2, -spec.side * off);
    else m.position.set(spec.side * off, h / 2, -spec.center);
    g.add(m);
  }
  if (spec.roof) {
    const back = spec.edge + spec.gap + depth * spec.tiers;
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a5260, side: THREE.DoubleSide });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(spec.len + 8, 0.6, 15), roofMat);
    const mid = back - 4;
    roof.position.set(spec.center, 15.5, -spec.side * mid);
    roof.rotation.x = spec.side * 0.09;
    g.add(roof);
    const post = new THREE.MeshLambertMaterial({ color: 0x6b7482 });
    for (let x = -spec.len / 2 + 6; x <= spec.len / 2 - 6; x += 18) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 15.5, 0.7), post);
      c.position.set(spec.center + x, 7.75, -spec.side * (back + 2.5));
      g.add(c);
    }
  }
  return g;
}

function adBoards(length: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const L = length / 2, W = width / 2;
  const colors = [0x12305a, 0xf2f2f2, 0xe4572e, 0x1f8a70, 0xf2c14e];
  const seg = 6;
  const add = (along: 'x' | 'y', fixed: number, from: number, to: number) => {
    let i = 0;
    for (let a = from; a < to - 0.01; a += seg, i++) {
      const len = Math.min(seg, to - a);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(along === 'x' ? len : 0.18, 0.95, along === 'x' ? 0.18 : len),
        new THREE.MeshLambertMaterial({ color: colors[i % colors.length], emissive: colors[i % colors.length], emissiveIntensity: 0.18 }),
      );
      if (along === 'x') m.position.set(a + len / 2, 0.48, -fixed);
      else m.position.set(fixed, 0.48, -(a + len / 2));
      g.add(m);
    }
  };
  for (const s of [-1, 1]) {
    add('x', s * (W + 3.5), -L - 6, L + 6);
    add('y', s * (L + 6), -W - 3.5, W + 3.5);
  }
  return g;
}

function cornerFlags(length: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const flag = new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide });
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), pole);
      p.position.set(sx * (length / 2), 0.8, -sy * (width / 2));
      g.add(p);
      const tri = new THREE.Mesh(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-sx * 0.35, 0.12, 0), new THREE.Vector3(0, 0.3, 0)]),
        flag,
      );
      tri.position.set(sx * (length / 2), 1.3, -sy * (width / 2));
      g.add(tri);
    }
  return g;
}

function floodlights(length: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const mast = new THREE.MeshLambertMaterial({ color: 0x8a93a0 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const x = sx * (length / 2 + 24), y = sy * (width / 2 + 20);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 34, 8), mast);
      m.position.set(x, 17, -y);
      g.add(m);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.5), lamp);
      panel.position.set(x, 35, -y);
      panel.lookAt(0, 8, 0);
      g.add(panel);
    }
  return g;
}

export function buildStadium(length: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const L = length / 2, W = width / 2;
  const tex = crowdTexture();
  const concrete = new THREE.MeshLambertMaterial({ color: 0x8b929e });
  for (const s of [-1, 1] as const) {
    g.add(tieredStand({ along: 'x', center: 0, len: length + 30, side: s, edge: W, gap: 7, tiers: 15, roof: true }, tex, concrete));
    g.add(tieredStand({ along: 'y', center: 0, len: width + 34, side: s, edge: L, gap: 9, tiers: 11, roof: false }, tex, concrete));
  }
  g.add(adBoards(length, width), cornerFlags(length, width), floodlights(length, width));
  return g;
}

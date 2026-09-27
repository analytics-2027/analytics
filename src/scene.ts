import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARROW_HEX, arrowPolys, type Arrow } from './arrows';
import { J, type Dataset, type Frame, type Vec3 } from './data';
import { buildStadium } from './stadium';

const BONES: [string, string][] = [
  ['neck', 'nose'], ['nose', 'lEye'], ['nose', 'rEye'], ['lEye', 'lEar'], ['rEye', 'rEar'],
  ['neck', 'lShoulder'], ['neck', 'rShoulder'],
  ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'], ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'],
  ['lWrist', 'lThumb'], ['lWrist', 'lPinky'], ['rWrist', 'rThumb'], ['rWrist', 'rPinky'],
  ['neck', 'midHip'], ['midHip', 'lHip'], ['midHip', 'rHip'],
  ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'],
  ['lAnkle', 'lHeel'], ['lAnkle', 'lBigToe'], ['lHeel', 'lBigToe'],
  ['rAnkle', 'rHeel'], ['rAnkle', 'rBigToe'], ['rHeel', 'rBigToe'],
];
const BONE_IDX = BONES.map(([a, b]) => [J[a], J[b]] as const);
const MAX_PLAYERS = 40;
const BONE_R = 0.035;

export const TEAM_COLOR = { home: 0xf08a24, away: 0x3a8dde } as const;
const SELECTED_COLOR = 0xffe14d;

// repère terrain (x, y, z haut) -> three.js (x, y haut, -y)
const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

function ribbon(points: [number, number][], closed: boolean, width = 0.14): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const dx = x2 - x1, dy = y2 - y1;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (width / 2), ny = (dx / l) * (width / 2);
    const a = [x1 + nx, y1 + ny], b = [x1 - nx, y1 - ny], c = [x2 + nx, y2 + ny], d = [x2 - nx, y2 - ny];
    for (const p of [a, b, c, b, d, c]) pos.push(p[0], 0.02, -p[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 48): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
}

function buildPitch(length: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const L = length / 2, W = width / 2;

  const stripes = 21;
  for (let i = 0; i < stripes; i++) {
    const w = length / stripes;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, width),
      new THREE.MeshLambertMaterial({ color: i % 2 ? 0x2f8a3e : 0x3a9b49 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(-L + w * (i + 0.5), 0, 0);
    g.add(m);
  }
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x1f5a2b }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  g.add(outer);

  const lines: [number, number][][] = [];
  const closedLines: [number, number][][] = [];
  closedLines.push([[-L, -W], [L, -W], [L, W], [-L, W]]);
  lines.push([[0, -W], [0, W]]);
  closedLines.push(arc(0, 0, 9.15, 0, Math.PI * 2, 64).slice(0, -1));
  for (const s of [-1, 1]) {
    lines.push([[s * L, -20.16], [s * (L - 16.5), -20.16], [s * (L - 16.5), 20.16], [s * L, 20.16]]);
    lines.push([[s * L, -9.16], [s * (L - 5.5), -9.16], [s * (L - 5.5), 9.16], [s * L, 9.16]]);
    const a = Math.acos(5.5 / 9.15);
    const spotX = s * (L - 11);
    lines.push(arc(spotX, 0, 9.15, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a));
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(spotX, 0.02, 0);
    g.add(spot);

    const goalMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (const gy of [-3.66, 3.66]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), goalMat);
      post.position.set(s * L, 1.22, -gy);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), goalMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(s * L, 2.44, 0);
    g.add(bar);
  }

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  for (const pts of lines) g.add(new THREE.Mesh(ribbon(pts, false), lineMat));
  for (const pts of closedLines) g.add(new THREE.Mesh(ribbon(pts, true), lineMat));

  g.add(buildStadium(length, width));
  return g;
}

export interface SelectionView {
  id: string;
  eye: Vec3;
  fwd: Vec3;
  valid: boolean;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly freeCam = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  readonly povCam = new THREE.PerspectiveCamera(80, 1, 0.05, 600);
  readonly controls: OrbitControls;
  private activeCam: THREE.Camera = this.freeCam;
  private arrowGroup = new THREE.Group();
  private arrowMat = new THREE.MeshBasicMaterial({ color: ARROW_HEX, side: THREE.DoubleSide, transparent: true, opacity: 0.92, depthWrite: false });

  private bones: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private markers: THREE.InstancedMesh;
  private ball: THREE.Mesh;
  private possMark: THREE.Mesh;
  private ring: THREE.Mesh;
  private cone: THREE.Mesh;
  private conePos: THREE.BufferAttribute;
  private lastSel: THREE.Vector3 | null = null;
  private readonly coneSegs = 40;
  private pDisc: THREE.Mesh;
  private pEdge: THREE.Mesh;
  private pRef: THREE.Mesh;
  private pLink: THREE.Line;
  private pOpp: THREE.Mesh;
  private camFill: THREE.Mesh;
  private camLine: THREE.LineLoop;

  constructor(private container: HTMLElement, private data: Dataset) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9db7cf);
    this.scene.fog = new THREE.Fog(0x9db7cf, 90, 260);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6b4a, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 90, 30);
    this.scene.add(sun);

    this.scene.add(buildPitch(data.pitch[0], data.pitch[1]));

    const boneMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), boneMat, MAX_PLAYERS * BONES.length);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), boneMat, MAX_PLAYERS);
    this.markers = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.28, 0.28, 1.75, 10),
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
      MAX_PLAYERS,
    );
    for (const m of [this.bones, this.heads, this.markers]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.scene.add(m);
    }

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.scene.add(this.ball);
    this.possMark = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.possMark.rotation.x = Math.PI;
    this.scene.add(this.possMark);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 32),
      new THREE.MeshBasicMaterial({ color: SELECTED_COLOR, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);

    const g = new THREE.BufferGeometry();
    this.conePos = new THREE.BufferAttribute(new Float32Array((this.coneSegs + 2) * 3), 3);
    g.setAttribute('position', this.conePos);
    const idx: number[] = [];
    for (let i = 1; i <= this.coneSegs; i++) idx.push(0, i, i + 1);
    g.setIndex(idx);
    this.cone = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ color: SELECTED_COLOR, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.cone.frustumCulled = false;
    this.scene.add(this.cone);

    const flat = (geo: THREE.BufferGeometry, color: number, opacity: number) => {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.pDisc = flat(new THREE.CircleGeometry(1, 64), 0xffffff, 0.14);
    this.pEdge = flat(new THREE.RingGeometry(0.965, 1, 64), 0xffffff, 0.9);
    this.pRef = flat(new THREE.RingGeometry(2.96, 3, 64), 0xffffff, 0.45);
    this.pOpp = flat(new THREE.RingGeometry(0.5, 0.64, 24), 0xff4d4d, 0.95);
    this.pLink = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]),
      new THREE.LineBasicMaterial({ color: 0xff4d4d }),
    );
    this.pLink.visible = false;
    this.pLink.frustumCulled = false;
    this.scene.add(this.pLink);

    const camGeo = new THREE.BufferGeometry();
    camGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    camGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.camFill = new THREE.Mesh(
      camGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.camLine = new THREE.LineLoop(camGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    for (const o of [this.camFill, this.camLine]) {
      o.visible = false;
      o.frustumCulled = false;
      this.scene.add(o);
    }

    this.scene.add(this.arrowGroup);
    this.freeCam.position.set(0, 55, 70);
    this.controls = new OrbitControls(this.freeCam, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.target.set(0, 0, 0);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.freeCam.aspect = this.povCam.aspect = w / h;
    this.freeCam.updateProjectionMatrix();
    this.povCam.updateProjectionMatrix();
  }

  setPovFov(deg: number): void {
    this.povCam.fov = deg;
    this.povCam.updateProjectionMatrix();
  }

  focusOn(x: number, y: number): void {
    const t = toThree(x, y, 0);
    this.controls.target.copy(t);
    this.freeCam.position.set(t.x - 18, 22, t.z + 26);
    this.lastSel = t.clone();
  }

  update(frame: Frame, sel: SelectionView | null, hideSelected: boolean, coneDeg: number, showCone: boolean): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    const pos = new THREE.Vector3(), col = new THREE.Color();
    let bi = 0, hi = 0, mi = 0;

    for (const [id, p] of Object.entries(frame.p)) {
      const meta = this.data.players[id];
      const isSel = sel?.id === id;
      const color = isSel ? SELECTED_COLOR : TEAM_COLOR[meta?.team ?? 'home'];
      if (p.j) {
        if (isSel && hideSelected) continue;
        col.set(color);
        for (const [ia, ib] of BONE_IDX) {
          const A = p.j[ia], B = p.j[ib];
          if (!A || !B) continue;
          a.set(A[0], A[2], -A[1]);
          b.set(B[0], B[2], -B[1]);
          d.subVectors(b, a);
          const len = d.length();
          if (len < 1e-3) continue;
          pos.addVectors(a, b).multiplyScalar(0.5);
          q.setFromUnitVectors(up, d.normalize());
          s.set(BONE_R, len, BONE_R);
          m.compose(pos, q, s);
          this.bones.setMatrixAt(bi, m);
          this.bones.setColorAt(bi, col);
          bi++;
        }
        const nose = p.j[J.nose], lEar = p.j[J.lEar], rEar = p.j[J.rEar];
        const c = lEar && rEar ? [(lEar[0] + rEar[0]) / 2, (lEar[1] + rEar[1]) / 2, (lEar[2] + rEar[2]) / 2] : nose;
        if (c) {
          pos.set(c[0], c[2], -c[1]);
          s.set(0.105, 0.125, 0.105);
          m.compose(pos, q.identity(), s);
          this.heads.setMatrixAt(hi, m);
          this.heads.setColorAt(hi, col);
          hi++;
        }
      } else if (!(isSel && hideSelected)) {
        pos.set(p.x, 0.875, -p.y);
        m.compose(pos, q.identity(), s.set(1, 1, 1));
        this.markers.setMatrixAt(mi, m);
        this.markers.setColorAt(mi, col.set(color));
        mi++;
      }
    }
    this.bones.count = bi;
    this.heads.count = hi;
    this.markers.count = mi;
    for (const im of [this.bones, this.heads, this.markers]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    if (frame.ball) {
      this.ball.visible = true;
      this.ball.position.copy(toThree(frame.ball[0], frame.ball[1], Math.max(frame.ball[2], 0.11)));
    } else this.ball.visible = false;

    const poss = frame.poss !== null ? frame.p[String(frame.poss)] : undefined;
    this.possMark.visible = !!poss && !(sel && String(frame.poss) === sel.id && hideSelected);
    if (poss) this.possMark.position.set(poss.x, 2.35, -poss.y);

    const selFrame = sel ? frame.p[sel.id] : undefined;
    this.ring.visible = !!selFrame;
    if (selFrame) {
      this.ring.position.set(selFrame.x, 0.03, -selFrame.y);
      const cur = toThree(selFrame.x, selFrame.y, 0);
      if (this.lastSel) {
        const delta = cur.clone().sub(this.lastSel);
        this.freeCam.position.add(delta);
        this.controls.target.add(delta);
      }
      this.lastSel = cur;
    }

    this.cone.visible = false;
    if (sel && selFrame && showCone && sel.valid) {
      const half = (coneDeg / 2) * (Math.PI / 180);
      const yaw = Math.atan2(sel.fwd[1], sel.fwd[0]);
      const R = 30;
      const arr = this.conePos.array as Float32Array;
      arr[0] = selFrame.x; arr[1] = 0.04; arr[2] = -selFrame.y;
      for (let i = 0; i <= this.coneSegs; i++) {
        const t = yaw - half + (2 * half * i) / this.coneSegs;
        arr[(i + 1) * 3] = selFrame.x + R * Math.cos(t);
        arr[(i + 1) * 3 + 1] = 0.04;
        arr[(i + 1) * 3 + 2] = -(selFrame.y + R * Math.sin(t));
      }
      this.conePos.needsUpdate = true;
      this.cone.visible = true;
    }
  }

  setPressure(
    show: boolean,
    center: { x: number; y: number } | null,
    dist: number,
    color: number,
    opp: { x: number; y: number } | null,
  ): void {
    const on = show && !!center && !!opp;
    for (const o of [this.pDisc, this.pEdge, this.pRef, this.pOpp, this.pLink]) o.visible = on;
    if (!on || !center || !opp) return;
    for (const m of [this.pDisc, this.pEdge]) {
      m.position.set(center.x, 0.05, -center.y);
      m.scale.setScalar(Math.max(dist, 0.2));
      (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
    this.pRef.position.set(center.x, 0.055, -center.y);
    this.pOpp.position.set(opp.x, 0.06, -opp.y);
    const pos = this.pLink.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, center.x, 0.07, -center.y);
    pos.setXYZ(1, opp.x, 0.07, -opp.y);
    pos.needsUpdate = true;
  }

  setFootprint(show: boolean, corners: [number, number][] | null): void {
    const on = show && !!corners;
    this.camFill.visible = this.camLine.visible = on;
    if (!on || !corners) return;
    const pos = this.camFill.geometry.getAttribute('position') as THREE.BufferAttribute;
    corners.forEach(([x, y], i) => pos.setXYZ(i, x, 0.04, -y));
    pos.needsUpdate = true;
  }

  // point du sol (m) sous un pointeur, avec la caméra actuellement affichée
  groundPoint(clientX: number, clientY: number): [number, number] | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    this.activeCam.updateMatrixWorld(true);
    ray.setFromCamera(ndc, this.activeCam);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? [hit.x, -hit.z] : null;
  }

  // joueur le plus proche du pointeur à l'écran (rayon en px CSS), ou null
  pickPlayer(clientX: number, clientY: number, frame: Frame, radius = 36): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const cam = this.activeCam;
    cam.updateMatrixWorld(true);
    let best: string | null = null;
    let bd = radius;
    const v = new THREE.Vector3();
    for (const [id, p] of Object.entries(frame.p)) {
      v.set(p.x, 1.0, -p.y);
      if (v.clone().applyMatrix4(cam.matrixWorldInverse).z >= 0) continue; // derrière la caméra
      v.project(cam);
      const d = Math.hypot(((v.x + 1) / 2) * r.width + r.left - clientX, ((1 - v.y) / 2) * r.height + r.top - clientY);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  setArrows(arrows: Arrow[]): void {
    for (const c of [...this.arrowGroup.children]) {
      this.arrowGroup.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    for (const ar of arrows) {
      const polys = arrowPolys(ar.a, ar.b);
      if (!polys) continue;
      const pos: number[] = [];
      const v = (p: [number, number]) => pos.push(p[0], 0.07, -p[1]);
      const [s0, s1, s2, s3] = polys.shaft;
      for (const p of [s0, s1, s2, s0, s2, s3, ...polys.head]) v(p);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.arrowGroup.add(new THREE.Mesh(g, this.arrowMat));
    }
  }

  render(mode: 'free' | 'pov', sel: SelectionView | null): void {
    if (mode === 'pov' && sel) {
      const e = toThree(sel.eye[0], sel.eye[1], sel.eye[2]);
      const f = toThree(sel.fwd[0], sel.fwd[1], sel.fwd[2]);
      this.povCam.position.copy(e);
      this.povCam.lookAt(e.x + f.x, e.y + f.y, e.z + f.z);
      this.activeCam = this.povCam;
      this.renderer.render(this.scene, this.povCam);
    } else {
      this.controls.update();
      this.activeCam = this.freeCam;
      this.renderer.render(this.scene, this.freeCam);
    }
  }
}

import { arrowPolys, type Arrow, type Pt } from './arrows';
import { theme } from './theme';
import { drawPasses, drawShapes, rgba, type PassViz, type Shape } from './passviz';

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = (s % 60).toFixed(1).padStart(4, '0');
  return `${h}:${String(m).padStart(2, '0')}:${r}`;
}

export interface Projector {
  toImage(x: number, y: number): Pt | null; // sol (m) -> image (carré unité, v vers le bas)
  toGround(u: number, v: number): Pt | null; // image -> sol (m)
}

// Homographie image <-> sol à partir des 4 points du sol touchés par les coins de l'image (TL, TR, BR, BL).
export function projectorFromCorners(cam: Pt[]): Projector {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = cam;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dy1 * dx2;
  const g = den === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
  const h = den === 0 ? 0 : (dx1 * dy3 - dy1 * dx3) / den;
  // M envoie (u,v,1) vers (X,Y,W), u,v dans le carré unité
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  // inverse de [[a,b,c],[d,e,f],[g,h,1]] par la matrice adjointe (sans échelle, suffisant pour une projective)
  const A = e - f * h, B = c * h - b, C = b * f - c * e;
  const D = f * g - d, E = a - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  return {
    toImage(x, y) {
      const w = G * x + H * y + I;
      if (w === 0) return null;
      const u = (A * x + B * y + C) / w;
      const v = (D * x + E * y + F) / w;
      return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
    },
    toGround(u, v) {
      const w = g * u + h * v + 1;
      if (w === 0) return null;
      return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
    },
  };
}

// Homographie sol -> image (u,v) unité donnée sous forme de matrice 3x3 (ligne par ligne).
export function projectorFromH(m: number[]): Projector {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
  return {
    toImage(x, y) {
      const w = g * x + h * y + i;
      if (w <= 1e-9) return null;
      const u = (a * x + b * y + c) / w;
      const v = (d * x + e * y + f) / w;
      return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
    },
    toGround(u, v) {
      const w = G * u + Hh * v + I;
      if (Math.abs(w) < 1e-12) return null;
      return [(A * u + B * v + C) / w, (D * u + E * v + F) / w];
    },
  };
}

export interface OverlayScene {
  proj: Projector;
  pitch: [number, number];
  overlay: boolean; // terrain, joueurs, cône, anneau (expérimental)
  players: { x: number; y: number; color: string; selected: boolean }[];
  ring: { cx: number; cy: number; r: number; color: string; opp: Pt } | null;
  cone: { cx: number; cy: number; yaw: number; half: number } | null;
  arrows: Arrow[];
  passes: PassViz[];
  shapes: Shape[];
  t: number;
}

export class VideoSync {
  // temps (s), dans l'extrait, de la première frame de pose
  start = 0;
  private ready = false;
  private lastSync = 0;
  private ctx: CanvasRenderingContext2D;

  constructor(private box: HTMLElement, private el: HTMLVideoElement, private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(box);
  }

  private resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.max(1, Math.round(this.box.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.box.clientHeight * dpr));
  }

  // clic/glisser sur l'overlay -> point du sol via la projection de la frame courante
  pointerToGround(ev: { clientX: number; clientY: number }, proj: Projector): Pt | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return proj.toGround((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
  }

  setInteractive(on: boolean, drawing = false): void {
    this.canvas.style.pointerEvents = on ? 'auto' : 'none';
    this.canvas.style.cursor = on && drawing ? 'crosshair' : '';
  }

  get overlayCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  get loaded(): boolean {
    return this.ready;
  }

  load(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.el.onloadeddata = () => {
        this.ready = true;
        resolve(true);
      };
      this.el.onerror = () => {
        this.ready = false;
        resolve(false);
      };
      this.el.src = url;
    });
  }

  setMuted(muted: boolean): void {
    this.el.muted = muted;
  }

  // temps des données (s) que montre la vidéo, quand elle joue réellement : sert d'horloge maîtresse en lecture
  get clock(): number | null {
    if (!this.ready || this.el.paused || this.el.seeking || this.el.readyState < 3) return null;
    return this.el.currentTime - this.start;
  }

  sync(t: number, playing: boolean, speed: number): void {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastSync < 40) return;
    this.lastSync = now;
    const target = Math.min(Math.max(this.start + t, 0), (this.el.duration || Infinity) - 0.05);
    const cur = this.el.currentTime;
    if (playing) {
      if (this.el.playbackRate !== speed) this.el.playbackRate = speed;
      if (Math.abs(cur - target) > 0.25) this.el.currentTime = target;
      if (this.el.paused) void this.el.play().catch(() => undefined);
    } else {
      if (!this.el.paused) this.el.pause();
      if (Math.abs(cur - target) > 0.02) this.el.currentTime = target;
    }
  }

  draw(scene: OverlayScene | null): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!scene) return;
    const proj = scene.proj;
    const W = canvas.width, H = canvas.height;
    const P = (x: number, y: number): Pt | null => {
      const p = proj.toImage(x, y);
      return p ? [p[0] * W, p[1] * H] : null;
    };
    const poly = (pts: Pt[], close = false) => {
      ctx.beginPath();
      let pen = false;
      for (const [x, y] of pts) {
        const p = P(x, y);
        if (!p) { pen = false; continue; }
        if (pen) ctx.lineTo(p[0], p[1]);
        else ctx.moveTo(p[0], p[1]);
        pen = true;
      }
      if (close) ctx.closePath();
    };
    const circle = (cx: number, cy: number, r: number, n = 48): Pt[] =>
      Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

    if (scene.overlay) {
      const [L, Wd] = [scene.pitch[0] / 2, scene.pitch[1] / 2];
      ctx.lineWidth = Math.max(1, W / 320);
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      poly([[-L, -Wd], [L, -Wd], [L, Wd], [-L, Wd]], true); ctx.stroke();
      poly([[0, -Wd], [0, Wd]]); ctx.stroke();
      poly(circle(0, 0, 9.15)); ctx.stroke();
      for (const s of [-1, 1]) {
        poly([[s * L, -20.16], [s * (L - 16.5), -20.16], [s * (L - 16.5), 20.16], [s * L, 20.16]]); ctx.stroke();
        poly([[s * L, -9.16], [s * (L - 5.5), -9.16], [s * (L - 5.5), 9.16], [s * L, 9.16]]); ctx.stroke();
      }

      if (scene.cone) {
        const { cx, cy, yaw, half } = scene.cone;
        const pts: Pt[] = [[cx, cy]];
        for (let i = 0; i <= 24; i++) {
          const t = yaw - half + (2 * half * i) / 24;
          pts.push([cx + 30 * Math.cos(t), cy + 30 * Math.sin(t)]);
        }
        ctx.fillStyle = rgba(theme().teams.selected, 0.28);
        poly(pts, true); ctx.fill();
      }
      if (scene.ring) {
        const r = scene.ring;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(2, W / 200);
        poly(circle(r.cx, r.cy, r.r)); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.6)';
        poly(circle(r.cx, r.cy, 3)); ctx.stroke();
        ctx.strokeStyle = theme().passes.cut;
        poly([[r.cx, r.cy], r.opp]); ctx.stroke();
      }
    }
    if (scene.overlay) {
      for (const p of scene.players) {
        const q = P(p.x, p.y);
        if (!q) continue;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(q[0], q[1], p.selected ? W / 80 : W / 130, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawShapes(ctx, scene.shapes, P, Math.max(1, W / 420));
    drawPasses(ctx, scene.passes, P, Math.max(1, W / 420), scene.t);
    for (const ar of scene.arrows) {
      const polys = arrowPolys(ar.a, ar.b, ar.w);
      if (!polys) continue;
      ctx.fillStyle = ar.color ?? theme().ui.accent;
      ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.lineWidth = Math.max(1, W / 400);
      for (const shape of [polys.shaft, polys.head]) {
        poly(shape, true);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

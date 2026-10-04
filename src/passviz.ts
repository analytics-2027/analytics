import type { Pt } from './arrows';
import { theme } from './theme';

// Options de passe dessinées comme des trajectoires et formes au sol des lentilles. La même géométrie (m) sert
// à la 2D, à la vidéo et à la 3D ; le style (épaisseur, courbure, halo, étiquettes, hachures…) vient du thème.

export interface PassViz {
  a: Pt;
  b: Pt;
  color: string;
  w: number; // 0..1 (valeur relative)
  label: string;
  best: boolean;
  hover: boolean;
  chosen: boolean;
  straight?: boolean; // vecteurs vitesse : pas de courbe, pas d'étiquette si label vide
}

export interface Shape {
  pts: Pt[];
  color: string;
  closed?: boolean;
  fill?: number; // opacité du remplissage
  hatch?: boolean;
  dash?: boolean;
  width?: number; // m (3D) ; px × unité (2D / vidéo)
  alpha?: number;
  text?: { at: Pt; s: string };
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const hatches = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
function hatchPattern(ctx: CanvasRenderingContext2D, color: string, u: number): CanvasPattern | null {
  let m = hatches.get(ctx);
  if (!m) hatches.set(ctx, (m = new Map()));
  const key = `${color}|${u.toFixed(2)}`;
  if (!m.has(key)) {
    const s = Math.max(4, Math.round(6 * u));
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d')!;
    g.strokeStyle = rgba(color, 0.8);
    g.lineWidth = Math.max(1, 0.7 * u);
    g.beginPath();
    g.moveTo(0, s);
    g.lineTo(s, 0);
    g.moveTo(-s / 2, s / 2);
    g.lineTo(s / 2, -s / 2);
    g.moveTo(s / 2, s * 1.5);
    g.lineTo(s * 1.5, s / 2);
    g.stroke();
    const p = ctx.createPattern(c, 'repeat');
    if (!p) return null;
    m.set(key, p);
  }
  return m.get(key)!;
}

export function drawShapes(ctx: CanvasRenderingContext2D, list: Shape[], P: (x: number, y: number) => Pt | null, u: number): void {
  const th = theme();
  for (const s of list) {
    const px = s.pts.map(([x, y]) => P(x, y));
    if (px.length < 2 || px.some((q) => !q)) continue;
    ctx.save();
    ctx.beginPath();
    (px as Pt[]).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.closed) ctx.closePath();
    if (s.fill) {
      ctx.fillStyle = rgba(s.color, s.fill);
      ctx.fill();
    }
    if (s.hatch) {
      const pat = hatchPattern(ctx, s.color, u);
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fill();
      }
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(s.color, s.alpha ?? 0.9);
    ctx.lineWidth = (s.width ?? 1.5) * u;
    if (s.dash) ctx.setLineDash([5 * u, 4 * u]);
    ctx.stroke();
    if (s.text) {
      const q = P(s.text.at[0], s.text.at[1]);
      if (q) {
        ctx.setLineDash([]);
        ctx.font = `500 ${Math.round(9 * u)}px ${th.ui.fontMono === 'system-ui' ? 'ui-monospace, monospace' : `'${th.ui.fontMono}', monospace`}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 * u;
        ctx.strokeStyle = rgba(th.pitch.grass, 0.9);
        ctx.strokeText(s.text.s, q[0], q[1]);
        ctx.fillStyle = s.color;
        ctx.fillText(s.text.s, q[0], q[1]);
      }
    }
    ctx.restore();
  }
}

export function passCurve(a: Pt, b: Pt, n = 28, bendScale = 1): Pt[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const bend = Math.min(2.5, L * 0.07) * bendScale;
  const cx = (a[0] + b[0]) / 2 - (dy / L) * bend, cy = (a[1] + b[1]) / 2 + (dx / L) * bend;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, v = 1 - t;
    pts.push([v * v * a[0] + 2 * v * t * cx + t * t * b[0], v * v * a[1] + 2 * v * t * cy + t * t * b[1]]);
  }
  return pts;
}

export const bendOf = (p: PassViz) => (p.straight ? 0 : theme().passes.curve);

const fontFor = (f: string, fallback: string) => (f === 'system-ui' ? fallback : `'${f}', ${fallback}`);

// ——— géométrie au sol (m) : corps effilé le long de la trajectoire + pointe ———
// Dessinée en mètres puis projetée, la flèche prend la perspective de la caméra comme un marquage peint sur la pelouse.

export interface ArrowGeom {
  left: Pt[];
  right: Pt[];
  head: [Pt, Pt, Pt];
  t: number[]; // position (0..1) de chaque point du corps, pour l'opacité
}

export function arrowGeom(center: Pt[], tailHalf: number, bodyHalf: number, headLen: number, headHalf: number): ArrowGeom | null {
  const seg = center.slice(1).map((q, i) => Math.hypot(q[0] - center[i][0], q[1] - center[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  if (total < 0.6) return null;
  const hl = Math.min(headLen, total * 0.45);
  const hh = headHalf * (hl / headLen) ** 0.5;
  const cutAt = total - hl;
  const body: Pt[] = [center[0]];
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i] >= cutAt) {
      const k = (cutAt - acc) / (seg[i] || 1);
      body.push([center[i][0] + (center[i + 1][0] - center[i][0]) * k, center[i][1] + (center[i + 1][1] - center[i][1]) * k]);
      break;
    }
    acc += seg[i];
    body.push(center[i + 1]);
  }
  const tip = center[center.length - 1];
  const left: Pt[] = [], right: Pt[] = [], t: number[] = [];
  body.forEach((p, i) => {
    const a = body[Math.max(0, i - 1)], b = body[Math.min(body.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const s = i / (body.length - 1);
    const half = tailHalf + (bodyHalf - tailHalf) * Math.sqrt(s);
    left.push([p[0] - dy * half, p[1] + dx * half]);
    right.push([p[0] + dy * half, p[1] - dx * half]);
    t.push(s);
  });
  const base = body[body.length - 1];
  let dx = tip[0] - base[0], dy = tip[1] - base[1];
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  return { left, right, head: [[base[0] - dy * hh, base[1] + dx * hh], tip, [base[0] + dy * hh, base[1] - dx * hh]], t };
}

// tailles au sol (m) : passes plus larges que les vecteurs de course
export function geomFor(p: PassViz): ArrowGeom | null {
  const k = theme().passes.width;
  const center = passCurve(p.a, p.b, 32, bendOf(p));
  return p.straight
    ? arrowGeom(center, 0.04 * k, 0.2 * k, 1.1 * k, 0.55 * k)
    : arrowGeom(center, 0.06 * k, (0.22 + 0.26 * p.w) * k * (p.hover ? 1.25 : 1), 2.4 * k, (0.85 + 0.35 * p.w) * k);
}

export const groundCircle = (c: Pt, r: number, n = 36): Pt[] =>
  Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);

function darker(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * (1 - k));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// dessin canvas (2D et vidéo) ; P projette un point du sol (m) en pixels du canvas, u = unité (px) pour les textes et liserés
export function drawPasses(ctx: CanvasRenderingContext2D, list: PassViz[], P: (x: number, y: number) => Pt | null, u: number, t: number): void {
  const th = theme();
  const st = th.passes;
  const order = [...list].sort((x, y) => Number(x.hover || x.best) - Number(y.hover || y.best));
  for (const p of order) {
    const g = geomFor(p);
    if (!g) continue;
    const poly = [...g.left, ...g.head, ...[...g.right].reverse()].map(([x, y]) => P(x, y));
    if (poly.some((q) => !q)) continue;
    const px = poly as Pt[];
    const strong = p.hover || p.best || p.straight;
    const alpha = strong ? 0.95 : 0.6;
    const fill = (dx = 0, dy = 0) => {
      ctx.beginPath();
      px.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';

    if (st.misregister > 0) {
      ctx.fillStyle = rgba(th.ui.accent, 0.5);
      fill(st.misregister * u, st.misregister * u);
      ctx.fill();
    }
    const s0 = P(p.a[0], p.a[1]), s1 = P(p.b[0], p.b[1]);
    if (st.gradient && s0 && s1) {
      const grad = ctx.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
      grad.addColorStop(0, rgba(p.color, 0.15));
      grad.addColorStop(0.6, rgba(p.color, alpha));
      grad.addColorStop(1, rgba(p.color, alpha));
      ctx.fillStyle = grad;
    } else ctx.fillStyle = rgba(p.color, alpha);
    if (st.glow) {
      ctx.shadowColor = rgba(p.color, 0.8);
      ctx.shadowBlur = (strong ? 14 : 6) * u;
    }
    fill();
    ctx.fill();
    ctx.shadowBlur = 0;
    // liseré plus foncé : détache la flèche de la pelouse sans halo
    ctx.strokeStyle = darker(p.color, 0.45);
    ctx.globalAlpha = strong ? 0.9 : 0.55;
    ctx.lineWidth = Math.max(0.75, 0.8 * u);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (st.flow && (p.hover || p.best)) {
      const c = passCurve(p.a, p.b, 32, bendOf(p)).map(([x, y]) => P(x, y));
      if (!c.some((q) => !q)) {
        ctx.setLineDash([0.1, 9 * u]);
        ctx.lineDashOffset = -t * 28 * u;
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(th.ui.text, 0.85);
        ctx.lineWidth = 2 * u;
        ctx.beginPath();
        (c as Pt[]).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // anneau au sol autour du receveur (perspective comprise)
    if (p.best || p.hover || p.chosen) {
      const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy) || 1;
      const ring = groundCircle([p.b[0] + (dx / L) * 1.4, p.b[1] + (dy / L) * 1.4], 1.1).map(([x, y]) => P(x, y));
      if (!ring.some((q) => !q)) {
        ctx.beginPath();
        (ring as Pt[]).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.strokeStyle = rgba(p.color, 0.95);
        ctx.lineWidth = Math.max(1.2, 1.6 * u);
        ctx.stroke();
      }
    }

    const e = P(p.b[0], p.b[1]);
    if (!p.label || !e) {
      ctx.restore();
      continue;
    }
    const label = th.ui.caps ? p.label.toUpperCase() : p.label;
    ctx.font = `600 ${Math.round(10 * u)}px ${fontFor(th.ui.fontDisplay, 'system-ui, sans-serif')}`;
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const lx = e[0] + 10 * u, ly = e[1] - 15 * u;
    const ink = p.hover ? th.ui.accent : th.ui.text;
    if (st.label === 'pastille' || st.label === 'cartouche') {
      const h = 15 * u, pad = 6 * u;
      ctx.fillStyle = rgba(th.ui.panel, 0.92);
      ctx.beginPath();
      if (st.label === 'pastille') ctx.roundRect(lx, ly - h / 2, tw + pad * 2, h, h / 2);
      else ctx.rect(lx, ly - h / 2, tw + pad * 2, h);
      ctx.fill();
      if (st.label === 'cartouche') {
        ctx.fillStyle = p.color;
        ctx.fillRect(lx, ly - h / 2, 2.5 * u, h);
      }
      ctx.fillStyle = ink;
      ctx.fillText(label, lx + pad, ly + 0.5 * u);
    } else {
      // texte seul, détouré dans la couleur du terrain pour rester lisible
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = rgba(th.pitch.grass, 0.9);
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle = p.hover ? th.ui.accent : p.color;
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }
}

import type { Pt } from './arrows';
import type { Dataset, Frame } from './data';
import type { PassOpt } from './options';
import { SAFETY_CSS } from './options';
import { groundCircle, type PassViz, type Shape } from './passviz';
import { theme } from './theme';
import { blockHull, defensiveLines, velocities, type Features, type Lens, type Team } from './situation';

// Ce que chaque lentille dessine au sol et résume dans la carte « Contexte ».

const TEAM_CSS = (t: Team) => theme().teams[t];

export interface LensView {
  passes: PassViz[];
  shapes: Shape[];
  rows: [string, string][];
}

export interface LensInput {
  data: Dataset;
  frame: Frame;
  fi: number;
  us: Team;
  dirs: Record<Team, number>;
  f: Features | null;
  carrier: string | null;
  opts: PassOpt[];
  hoverOpt: string | null;
}

const circle = (c: Pt, r: number, n = 20): Pt[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);

function optionPasses(inp: LensInput): PassViz[] {
  const cpf = inp.carrier ? inp.frame.p[inp.carrier] : undefined;
  if (!cpf || !inp.opts.length) return [];
  const vmax = Math.max(0.05, inp.opts[0].value);
  const out: PassViz[] = [];
  inp.opts.forEach((o, i) => {
    if (!(i < 5 || o.sc?.chosen || o.id === inp.hoverOpt)) return;
    const dx = o.to[0] - cpf.x, dy = o.to[1] - cpf.y, L = Math.hypot(dx, dy);
    const k0 = 1.1 / L, k1 = (L - 1.4) / L;
    out.push({
      a: [cpf.x + dx * k0, cpf.y + dy * k0],
      b: [cpf.x + dx * k1, cpf.y + dy * k1],
      color: SAFETY_CSS(o.safety),
      w: Math.min(1, o.value / vmax),
      label: `#${inp.data.players[o.id]?.n ?? '?'}${o.sc?.chosen ? ' ★' : ''}`,
      best: i === 0,
      hover: o.id === inp.hoverOpt,
      chosen: !!o.sc?.chosen,
    });
  });
  return out;
}


// cotes façon plan : largeur et profondeur du bloc, traits de rappel et valeur en mètres
function dimensions(hull: Pt[], color: string): Shape[] {
  const xs = hull.map((p) => p[0]), ys = hull.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const oy = y0 - 3.5, ox = x1 + 3.5;
  const tick = (a: Pt, b: Pt): Shape => ({ pts: [a, b], color, width: 0.8, alpha: 0.9 });
  return [
    { pts: [[x0, oy], [x1, oy]], color, width: 0.8, alpha: 0.9, text: { at: [(x0 + x1) / 2, oy - 2.2], s: `${Math.round(x1 - x0)} m` } },
    tick([x0, oy - 1], [x0, oy + 1]),
    tick([x1, oy - 1], [x1, oy + 1]),
    { pts: [[ox, y0], [ox, y1]], color, width: 0.8, alpha: 0.9, text: { at: [ox + 3.2, (y0 + y1) / 2], s: `${Math.round(y1 - y0)} m` } },
    tick([ox - 1, y0], [ox + 1, y0]),
    tick([ox - 1, y1], [ox + 1, y1]),
  ];
}

const m = (v: number) => `${Math.round(v)} m`;

export function buildLens(lens: Lens, inp: LensInput): LensView {
  const { data, frame, us, dirs, f } = inp;
  const them: Team = us === 'home' ? 'away' : 'home';
  const passes: PassViz[] = [];
  const shapes: Shape[] = [];
  const rows: [string, string][] = [];
  const ball = frame.ball;

  if (lens === 'attack') {
    for (const line of defensiveLines(data, frame, them, dirs[them])) shapes.push({ pts: line, color: theme().pitch.lines, dash: true, width: 1.4, alpha: 0.7 });
    const hullThem = blockHull(data, frame, them);
    if (hullThem.length && theme().signature.dimensions) shapes.push(...dimensions(hullThem, theme().ui.text));
    passes.push(...optionPasses(inp));
    if (inp.carrier && inp.opts.length && frame.p[inp.carrier]) {
      const c = frame.p[inp.carrier];
      shapes.push({ pts: groundCircle([c.x, c.y], 0.9, 32), color: TEAM_CSS(data.players[inp.carrier]?.team ?? 'home'), closed: true, width: 2, alpha: 1 });
    }
    // la première ligne est la donnée clé (affichée en grand avec la signature « grands chiffres »)
    if (inp.opts.length) rows.push(['Meilleure option', `#${data.players[inp.opts[0].id]?.n}`], ['Son couloir', inp.opts[0].lane]);
    else if (f) rows.push(['Adversaires derrière le ballon', String(f.behind)]);
    rows.push(['Lignes adverses', String(defensiveLines(data, frame, them, dirs[them]).length)]);
    if (f) rows.push(['Bloc adverse', `${m(f.depth)} × ${m(f.width)}`]);
    if (f && inp.opts.length) rows.push(['Adversaires derrière le ballon', String(f.behind)]);
  }

  if (lens === 'defense') {
    const hull = blockHull(data, frame, us);
    const b = theme().shapes.block;
    if (hull.length) shapes.push({ pts: hull, color: TEAM_CSS(us), closed: true, fill: b === 'teinte' ? 0.12 : 0, hatch: b === 'hachures', width: 1.2, alpha: 0.75 });
    if (hull.length && theme().signature.dimensions) shapes.push(...dimensions(hull, theme().ui.text));
    for (const line of defensiveLines(data, frame, us, dirs[us])) shapes.push({ pts: line, color: TEAM_CSS(us), width: 2, alpha: 0.9 });
    passes.push(...optionPasses(inp));
    if (inp.carrier && inp.opts.length && frame.p[inp.carrier]) {
      const c = frame.p[inp.carrier];
      shapes.push({ pts: groundCircle([c.x, c.y], 0.9, 32), color: TEAM_CSS(data.players[inp.carrier]?.team ?? 'home'), closed: true, width: 2, alpha: 1 });
    }
    if (f) {
      rows.push(['Derrière le ballon', `${f.behind}/10`], ['Profondeur du bloc', m(f.depth)], ['Largeur du bloc', m(f.width)], ['Ligne défensive', `${m(f.backLine)} du but`]);
    }
    if (inp.opts.length) rows.push(['Passe adverse la plus dangereuse', `#${data.players[inp.opts[0].id]?.n}`]);
  }

  if (lens === 'transition') {
    for (const v of velocities(data, inp.fi)) {
      const sp = Math.hypot(v.v[0], v.v[1]);
      if (sp < 2 || data.players[v.id]?.role === 'GK') continue;
      const team = data.players[v.id]?.team ?? 'home';
      // anneau au sol sous le joueur, le vecteur part de son bord : on voit à qui il appartient
      const ux = v.v[0] / sp, uy = v.v[1] / sp;
      shapes.push({ pts: groundCircle(v.from, 0.75, 28), color: TEAM_CSS(team), closed: true, width: 1.6, alpha: 0.95 });
      passes.push({
        a: [v.from[0] + ux * 0.85, v.from[1] + uy * 0.85],
        b: [v.from[0] + v.v[0] * 1.2 + ux * 0.85, v.from[1] + v.v[1] * 1.2 + uy * 0.85],
        color: TEAM_CSS(team),
        w: Math.min(1, sp / 8),
        label: '',
        best: false,
        hover: false,
        chosen: false,
        straight: true,
      });
    }
    if (f) {
      rows.push(
        [f.poss === 'us' ? 'Adversaires derrière le ballon' : 'Nos joueurs derrière le ballon', `${f.behind}/10`],
        ['Possession depuis', `${f.age.toFixed(1)} s`],
        ['Vitesse moyenne', `${f.speed.toFixed(1)} m/s`],
      );
      if (f.poss === 'them') rows.push(['Repli moyen (vers notre but)', `${f.ourSpeedBack.toFixed(1)} m/s`]);
    }
  }

  if (lens === 'pressing' && ball) {
    const ours = Object.entries(frame.p).filter(([id]) => data.players[id]?.team === us && data.players[id]?.role !== 'GK');
    const theirs = Object.entries(frame.p).filter(([id]) => data.players[id]?.team === them);
    let pressers = 0, dsum = 0;
    for (const [, p] of ours) {
      if (Math.hypot(p.x - ball[0], p.y - ball[1]) > 18) continue;
      let best: [number, Pt] | null = null;
      for (const [, o] of theirs) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (!best || d < best[0]) best = [d, [o.x, o.y]];
      }
      if (!best) continue;
      pressers++;
      dsum += best[0];
      shapes.push({ pts: [[p.x, p.y], best[1]], color: TEAM_CSS(us), width: 2.2, alpha: 0.9 });
    }
    let free = 0;
    for (const [, o] of theirs) {
      if (Math.hypot(o.x - ball[0], o.y - ball[1]) > 30) continue;
      if (ours.some(([, p]) => Math.hypot(p.x - o.x, p.y - o.y) < 5)) continue;
      free++;
      shapes.push({ pts: circle([o.x, o.y], 1.6), color: theme().passes.cut, closed: true, width: 1.8 });
    }
    rows.push(['Presseurs (< 18 m du ballon)', String(pressers)], ['Distance moyenne à la cible', pressers ? m(dsum / pressers) : '—'], ['Adversaires libres (< 30 m)', String(free)]);
  }
  return { passes, shapes, rows };
}

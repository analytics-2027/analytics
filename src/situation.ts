import type { Pt } from './arrows';
import type { Dataset, Frame, Phase } from './data';
import { carrierAt } from './options';

// Situation de jeu du point de vue d'une équipe, et « lentille » d'interface qui va avec.
// Trois sources : règles géométriques (en direct), Laya (texte -> choix), SkillCorner (vérité terrain, phases annotées).

export type Team = 'home' | 'away';
export type Lens = 'attack' | 'defense' | 'transition' | 'pressing';
export type Situation =
  | 'build' | 'create' | 'finish' | 'counter' | 'set_att'
  | 'high_block' | 'mid_block' | 'low_block' | 'counter_def' | 'set_def'
  | 'chaotic';

export const SITUATIONS: Record<Situation, { fr: string; en: string; lens: Lens | null }> = {
  build: { fr: 'Construction', en: 'we have the ball in our own third and build up from the back', lens: 'attack' },
  create: { fr: 'Création', en: 'we have the ball in midfield and look for a way through', lens: 'attack' },
  finish: { fr: 'Finition', en: 'we have the ball near the opponent box and try to score', lens: 'attack' },
  counter: { fr: 'Contre-attaque', en: 'we just won the ball and attack fast before they reorganise', lens: 'transition' },
  set_att: { fr: 'Coup de pied arrêté (pour)', en: 'we have a set piece', lens: 'attack' },
  high_block: { fr: 'Pressing haut', en: 'they have the ball in their own third and we press high', lens: 'pressing' },
  mid_block: { fr: 'Bloc médian', en: 'they have the ball in midfield and we defend in a mid block', lens: 'defense' },
  low_block: { fr: 'Bloc bas', en: 'they have the ball near our box and we defend deep', lens: 'defense' },
  counter_def: { fr: 'Repli défensif', en: 'we just lost the ball and must run back to defend', lens: 'transition' },
  set_def: { fr: 'Coup de pied arrêté (contre)', en: 'they have a set piece', lens: 'defense' },
  chaotic: { fr: 'Ballon disputé', en: 'nobody controls the ball', lens: null },
};

export const LENSES: Record<Lens, { fr: string; short: string }> = {
  attack: { fr: 'Attaque placée', short: 'Attaque' },
  defense: { fr: 'Défense en bloc', short: 'Défense' },
  transition: { fr: 'Transition', short: 'Transition' },
  pressing: { fr: 'Pressing haut', short: 'Pressing' },
};

// phases SkillCorner -> situation, vue de l'équipe `team`
export function truthAt(data: Dataset, fi: number, team: Team): Situation | null {
  const p: Phase | undefined = data.phases?.find((q) => q.start <= fi && fi <= q.end);
  if (!p) return null;
  if (p.team === team) {
    return (
      ({ build_up: 'build', create: 'create', finish: 'finish', direct: 'create', quick_break: 'counter', transition: 'counter', set_play: 'set_att' } as Record<string, Situation>)[
        p.inPoss ?? ''
      ] ?? 'chaotic'
    );
  }
  return (
    ({
      high_block: 'high_block', medium_block: 'mid_block', low_block: 'low_block',
      defending_quick_break: 'counter_def', defending_transition: 'counter_def', defending_direct: 'mid_block', defending_set_play: 'set_def',
    } as Record<string, Situation>)[p.outPoss ?? ''] ?? 'chaotic'
  );
}

// équipe en possession frame par frame (porteur, sinon dernière équipe connue pendant 5 s) et début de la possession
export interface PossTrack {
  team: (Team | null)[];
  since: number[];
}

export function possessionTrack(data: Dataset): PossTrack {
  const n = data.frames.length;
  const team: (Team | null)[] = new Array(n).fill(null);
  const since: number[] = new Array(n).fill(0);
  let last: Team | null = null, lastSeen = -999, start = 0;
  for (let i = 0; i < n; i++) {
    const c = carrierAt(data, data.frames[i], i);
    const t = c ? data.players[c]?.team ?? null : null;
    if (t) {
      if (t !== last) start = i;
      last = t;
      lastSeen = i;
    }
    team[i] = i - lastSeen <= 125 ? last : null;
    since[i] = start;
  }
  return { team, since };
}

export interface Features {
  poss: 'us' | 'them' | 'none';
  age: number; // s depuis le début de la possession
  ballX: number; // m, dans le sens de notre attaque (-52,5 = notre ligne de but)
  ballY: number;
  backLine: number; // distance de la ligne défensive de l'équipe qui défend à son propre but (m)
  depth: number; // profondeur du bloc qui défend (m)
  width: number;
  behind: number; // défenseurs (hors gardien) entre le ballon et leur but
  speed: number; // vitesse moyenne des joueurs de champ (m/s)
  ourSpeedBack: number; // vitesse moyenne de nos joueurs vers notre but (m/s, >0 = ils reculent)
  nearBall: number; // nos joueurs à moins de 10 m du ballon
}

const outfield = (data: Dataset, fr: Frame, team: Team) =>
  Object.entries(fr.p).filter(([id]) => data.players[id]?.team === team && data.players[id]?.role !== 'GK');

export function features(data: Dataset, fi: number, us: Team, dirs: Record<Team, number>, poss: PossTrack): Features | null {
  const fr = data.frames[fi];
  if (!fr.ball) return null;
  const d = dirs[us];
  const them: Team = us === 'home' ? 'away' : 'home';
  const pt = poss.team[fi];
  const ps = pt === us ? 'us' : pt === them ? 'them' : 'none';
  const defTeam = ps === 'us' ? them : us;
  // distance au but de l'équipe qui défend (0 = sa ligne de but)
  const fromGoal = (x: number) => x * dirs[defTeam] + 52.5;
  const def = outfield(data, fr, defTeam);
  const xs = def.map(([, p]) => fromGoal(p.x)).sort((a, b) => a - b);
  const ys = def.map(([, p]) => p.y);
  const backLine = xs.length >= 4 ? xs.slice(0, 4).reduce((s, v) => s + v, 0) / 4 : 0;
  const ballFromDefGoal = fromGoal(fr.ball[0]);
  const prev = data.frames[Math.max(0, fi - 10)];
  const dt = (fi - Math.max(0, fi - 10)) / data.fps || 1;
  let sp = 0, ns = 0, back = 0, nb = 0;
  for (const [id, p] of Object.entries(fr.p)) {
    const q = prev.p[id];
    if (!q || data.players[id]?.role === 'GK') continue;
    sp += Math.hypot(p.x - q.x, p.y - q.y) / dt;
    ns++;
    if (data.players[id]?.team === us) {
      back += (-(p.x - q.x) * d) / dt;
      nb++;
    }
  }
  const ours = outfield(data, fr, us);
  return {
    poss: ps,
    age: (fi - poss.since[fi]) / data.fps,
    ballX: fr.ball[0] * d,
    ballY: fr.ball[1],
    backLine,
    depth: xs.length ? xs[xs.length - 1] - xs[0] : 0,
    width: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
    behind: xs.filter((x) => x < ballFromDefGoal).length,
    speed: ns ? sp / ns : 0,
    ourSpeedBack: nb ? back / nb : 0,
    nearBall: ours.filter(([, p]) => Math.hypot(p.x - fr.ball![0], p.y - fr.ball![1]) < 10).length,
  };
}

export function ruleSituation(f: Features): Situation {
  if (f.poss === 'none') return 'chaotic';
  // seuils ajustés sur l'extrait du match (5 min) contre les phases SkillCorner : situation 55 %, lentille 69 %
  if (f.poss === 'us') {
    if (f.age < 4 && f.speed > 3) return 'counter';
    if (f.ballX < -25) return 'build';
    if (f.ballX > 20) return 'finish';
    return 'create';
  }
  if (f.age < 4 && f.ourSpeedBack > 1.5) return 'counter_def';
  if (f.ballX > 17.5) return 'high_block';
  if (f.ballX < -17.5 || f.backLine < 16) return 'low_block';
  return 'mid_block';
}

const third = (x: number) => (x < -17.5 ? 'in our defensive third' : x > 17.5 ? 'in the attacking third' : 'in midfield');

export function situationText(f: Features): string {
  const who = f.poss === 'us' ? 'We have the ball' : f.poss === 'them' ? 'The opponent has the ball' : 'Nobody clearly has the ball';
  const fresh = f.poss !== 'none' && f.age < 4 ? `, possession won ${f.age.toFixed(0)} s ago` : '';
  const defender = f.poss === 'us' ? 'Their' : 'Our';
  return (
    `Football match. ${who}${fresh}. The ball is ${third(f.ballX)}. ` +
    `${defender} defensive block: back line ${Math.round(f.backLine)} m from goal, ${Math.round(f.depth)} m deep, ${Math.round(f.width)} m wide, ${f.behind} defenders behind the ball. ` +
    `Players run at ${f.speed.toFixed(1)} m/s on average. ${f.nearBall} of our players are within 10 m of the ball.`
  );
}

export function layaSituationQuestion(): Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> {
  const criteria: Record<string, string> = {};
  for (const [k, v] of Object.entries(SITUATIONS)) criteria[k] = v.en;
  return { situation: { type: 'choice', instructions: 'Which game situation is this, from our team point of view?', criteria } };
}

// ——— géométrie des lentilles ———

export function blockHull(data: Dataset, fr: Frame, team: Team): Pt[] {
  const pts: Pt[] = outfield(data, fr, team).map(([, p]) => [p.x, p.y]);
  if (pts.length < 3) return [];
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of [...pts].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

// lignes défensives : joueurs de champ triés par profondeur, coupés aux deux plus grands écarts
export function defensiveLines(data: Dataset, fr: Frame, team: Team, dir: number): Pt[][] {
  const pl = outfield(data, fr, team)
    .map(([, p]) => ({ p: [p.x, p.y] as Pt, depth: p.x * -dir }))
    .sort((a, b) => b.depth - a.depth);
  if (pl.length < 6) return [];
  const gaps = pl.slice(1).map((q, i) => ({ i: i + 1, g: pl[i].depth - q.depth })).sort((a, b) => b.g - a.g);
  const cuts = gaps.slice(0, 2).map((g) => g.i).sort((a, b) => a - b);
  const groups = [pl.slice(0, cuts[0]), pl.slice(cuts[0], cuts[1]), pl.slice(cuts[1])];
  return groups.filter((g) => g.length >= 2).map((g) => g.map((q) => q.p).sort((a, b) => a[1] - b[1]));
}

export function velocities(data: Dataset, fi: number, lag = 6): { id: string; from: Pt; v: Pt }[] {
  const fr = data.frames[fi], prev = data.frames[Math.max(0, fi - lag)];
  const dt = (fi - Math.max(0, fi - lag)) / data.fps;
  if (!dt) return [];
  return Object.entries(fr.p).flatMap(([id, p]) => {
    const q = prev.p[id];
    return q ? [{ id, from: [p.x, p.y] as Pt, v: [(p.x - q.x) / dt, (p.y - q.y) / dt] as Pt }] : [];
  });
}

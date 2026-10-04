import { pressureState } from './analysis';
import { safetyColor } from './theme';
import type { Pt } from './arrows';
import type { Dataset, Frame, PassEvent } from './data';
import { angleToTarget, type HeadPose } from './pov';

// Options de passe recalculées en direct depuis le tracking (géométrie seule, sans les modèles SkillCorner) :
// c'est ce qui permet le « et si » quand on déplace un joueur. Les seuils sont des choix de prototype.

export type Lane = 'libre' | 'partiel' | 'bloqué';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PassOpt {
  id: string;
  to: Pt;
  dist: number;
  gain: number; // m gagnés vers le but adverse
  margin: number; // marge du couloir (m), adversaire le plus menaçant
  lane: Lane;
  space: number; // adversaire le plus proche du receveur (m)
  bypassed: number; // adversaires entre le porteur et le receveur, dans le sens du jeu
  inView: boolean | null; // dans le cône de vision du porteur (null : orientation inconnue)
  safety: number; // 0..1
  progress: number; // 0..1
  value: number; // safety × progress
  difficulty: Difficulty;
  sc: { xthreat: number | null; xpass: number | null; chosen: boolean } | null;
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));

// sens d'attaque (+1 : vers x croissants), déduit de la position moyenne des gardiens
export function attackDirs(data: Dataset): Record<'home' | 'away', number> {
  const sum = { home: 0, away: 0 }, n = { home: 0, away: 0 };
  for (const fr of data.frames) {
    for (const [id, p] of Object.entries(fr.p)) {
      const m = data.players[id];
      if (m?.role !== 'GK') continue;
      sum[m.team] += p.x;
      n[m.team]++;
    }
  }
  const home = n.home ? (sum.home / n.home > 0 ? -1 : 1) : n.away ? (sum.away / n.away > 0 ? 1 : -1) : 1;
  return { home, away: -home };
}

// porteur : possession du tracking, sinon l'événement en cours, sinon le joueur à moins de 2,5 m du ballon
export function carrierAt(data: Dataset, frame: Frame, fi: number): string | null {
  if (frame.poss !== null && frame.p[String(frame.poss)]) return String(frame.poss);
  const ev = eventAt(data, fi);
  if (ev && frame.p[String(ev.passer)]) return String(ev.passer);
  if (!frame.ball) return null;
  let best: string | null = null;
  let bd = 2.5;
  for (const [id, p] of Object.entries(frame.p)) {
    const d = Math.hypot(p.x - frame.ball[0], p.y - frame.ball[1]);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

export function eventAt(data: Dataset, fi: number): PassEvent | null {
  return data.events.find((e) => e.start <= fi && fi <= e.end) ?? null;
}

export function difficultyOf(p: number): Difficulty {
  return p >= 0.8 ? 'easy' : p >= 0.5 ? 'medium' : 'hard';
}

export function passOptions(
  data: Dataset,
  frame: Frame,
  fi: number,
  carrier: string,
  dir: Record<'home' | 'away', number>,
  pose: HeadPose | null,
  coneDeg: number,
): PassOpt[] {
  const me = frame.p[carrier];
  const team = data.players[carrier]?.team;
  if (!me || !team) return [];
  const d = dir[team];
  const opps = Object.entries(frame.p).filter(([id]) => data.players[id] && data.players[id].team !== team);
  const ev = eventAt(data, fi);
  const scOpts = ev && String(ev.passer) === carrier ? ev : null;

  const out: PassOpt[] = [];
  for (const [id, r] of Object.entries(frame.p)) {
    if (id === carrier || data.players[id]?.team !== team) continue;
    const vx = r.x - me.x, vy = r.y - me.y;
    const dist = Math.hypot(vx, vy);
    if (dist < 2 || dist > 55) continue;
    // couloir : distance de chaque adversaire au segment, diminuée du temps qu'il a pour fermer pendant le trajet du ballon
    let margin = 20;
    let space = 99;
    let bypassed = 0;
    const ahead = (x: number) => (x - me.x) * d;
    for (const [, o] of opps) {
      const t = ((o.x - me.x) * vx + (o.y - me.y) * vy) / (dist * dist);
      if (t > 0.03 && t < 1.05) {
        const perp = Math.abs((o.x - me.x) * vy - (o.y - me.y) * vx) / dist;
        margin = Math.min(margin, perp - 0.07 * t * dist);
      }
      space = Math.min(space, Math.hypot(o.x - r.x, o.y - r.y));
      if (ahead(o.x) > 0 && ahead(o.x) < ahead(r.x)) bypassed++;
    }
    const gain = (r.x - me.x) * d;
    const lane: Lane = margin > 2.5 ? 'libre' : margin > 1 ? 'partiel' : 'bloqué';
    const safety = sig(1.6 * (margin - 1.2)) * sig(1.2 * (space - 1.5)) * Math.exp(-Math.max(0, dist - 15) / 40);
    const progress = sig(gain / 9 + 0.6 * bypassed - 0.4);
    const sc = scOpts?.options.find((o) => String(o.id) === id);
    out.push({
      id,
      to: [r.x, r.y],
      dist,
      gain,
      margin,
      lane,
      space,
      bypassed,
      inView: pose ? angleToTarget(pose.eye, pose.fwd, [r.x, r.y]) <= coneDeg / 2 : null,
      safety,
      progress,
      value: safety * progress,
      difficulty: difficultyOf(sc?.xpass ?? safety),
      sc: sc ? { xthreat: sc.xthreat, xpass: sc.xpass, chosen: String(scOpts!.target) === id } : scOpts && String(scOpts.target) === id ? { xthreat: null, xpass: null, chosen: true } : null,
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

export const SAFETY_CSS = (s: number) => safetyColor(s);

// ——— description textuelle, partagée avec scripts/build_laya_dataset.py (garder les deux alignées) ———

export const PASS_QUESTION = 'Which teammate will the ball carrier pass to?';

const dirWord =(gain: number) => (gain > 4 ? 'forward' : gain < -4 ? 'backward' : 'sideways');
const pressureWord = { safe: 'low', act: 'medium', press: 'high' } as const;

export function carrierText(data: Dataset, carrier: string, oppDist: number, closing: number): string {
  const m = data.players[carrier];
  const { state } = pressureState(oppDist, closing);
  return `Football match, the ${m?.role ?? 'player'} has the ball and must choose a pass. Pressure on the ball carrier: ${pressureWord[state]}.`;
}

export function optionText(data: Dataset, o: PassOpt): string {
  const m = data.players[o.id];
  const parts = [
    `${m?.role ?? 'player'}`,
    `${Math.round(o.dist)} m pass ${dirWord(o.gain)} (${o.gain >= 0 ? '+' : ''}${Math.round(o.gain)} m)`,
    `${o.bypassed} opponent${o.bypassed === 1 ? '' : 's'} bypassed`,
    `${o.difficulty} pass`,
  ];
  return parts.join(', ');
}

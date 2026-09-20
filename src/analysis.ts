import type { Dataset, Frame, PassEvent } from './data';
import { angleToTarget, type HeadPose } from './pov';

export type PressureState = 'safe' | 'act' | 'press';

// 3 m = seuil `received_in_space` de SkillCorner ; les autres seuils sont des choix de prototype.
export const THRESH = { safeDist: 3, pressDist: 1.5, safeTtc: 2, pressTtc: 1 };

export const STATE_LABEL: Record<PressureState, string> = {
  safe: 'temps disponible',
  act: 'action requise',
  press: 'sous pression',
};

export interface Opponent {
  id: string;
  x: number;
  y: number;
  dist: number;
}

export function pointInPoly(poly: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function nearestOpponent(data: Dataset, frame: Frame, id: string): Opponent | null {
  const me = frame.p[id];
  const team = data.players[id]?.team;
  if (!me || !team) return null;
  let best: Opponent | null = null;
  for (const [oid, p] of Object.entries(frame.p)) {
    if (data.players[oid]?.team === team || !data.players[oid]) continue;
    const dist = Math.hypot(p.x - me.x, p.y - me.y);
    if (!best || dist < best.dist) best = { id: oid, x: p.x, y: p.y, dist };
  }
  return best;
}

// Vitesse de rapprochement (m/s, >0 si l'adversaire se rapproche), sur `lag` frames.
export function closingSpeed(data: Dataset, idx: number, id: string, oppId: string, dist: number, lag = 5): number {
  const prev = data.frames[Math.max(0, idx - lag)];
  const a = prev.p[id], b = prev.p[oppId];
  if (!a || !b) return 0;
  const dt = (Math.max(0, idx) - Math.max(0, idx - lag)) / data.fps;
  return dt > 0 ? (Math.hypot(a.x - b.x, a.y - b.y) - dist) / dt : 0;
}

export function pressureState(dist: number, closing: number): { state: PressureState; ttc: number } {
  const ttc = closing > 0.3 ? dist / closing : Infinity;
  const state: PressureState =
    dist < THRESH.pressDist || ttc < THRESH.pressTtc ? 'press' : dist < THRESH.safeDist || ttc < THRESH.safeTtc ? 'act' : 'safe';
  return { state, ttc };
}

export function cameraCoverage(data: Dataset, frame: Frame): { inside: number; total: number } {
  if (!frame.cam) return { inside: 0, total: 0 };
  const ids = Object.keys(frame.p);
  return { inside: ids.filter((i) => pointInPoly(frame.cam!, frame.p[i].x, frame.p[i].y)).length, total: ids.length };
}

const deg = (a: number) => `${a.toFixed(0)}°`;

export function analyzePass(
  data: Dataset,
  ev: PassEvent,
  pose: HeadPose | null,
  coneDeg: number,
): string[] {
  const frame = data.frames[ev.end];
  const passer = data.players[String(ev.passer)];
  const name = (id: number | string) => {
    const m = data.players[String(id)];
    return m ? `#${m.n} ${m.name}` : String(id);
  };
  const lines = [
    `${ev.endType === 'pass' ? 'Passe' : 'Possession → ' + ev.endType} ${name(ev.passer)}${ev.target ? ' → ' + name(ev.target) : ''}`,
    `frame ${frame.f} — ${ev.outcome ?? 'sans passe'} — pression SkillCorner: ${ev.pressureEnd ?? '—'}`,
  ];
  const me = frame.p[String(ev.passer)];
  if (!pose || !me) return [...lines, 'Orientation de la tête indisponible à cet instant.'];
  lines.push(`orientation: ${pose.quality}${pose.quality === 'interp' ? ' (interpolée)' : ''}, cône ${coneDeg}°`);

  const inCone = (a: number) => (a <= coneDeg / 2 ? 'dans le champ' : 'HORS champ');
  const angleOf = (id: string | number) => {
    const p = frame.p[String(id)];
    return p ? angleToTarget(pose.eye, pose.fwd, [p.x, p.y]) : null;
  };

  if (ev.target) {
    const a = angleOf(ev.target);
    const mates = Object.keys(frame.p)
      .filter((id) => id !== String(ev.passer) && data.players[id]?.team === passer?.team)
      .map((id) => ({ id, a: angleOf(id)! }))
      .sort((x, y) => x.a - y.a);
    const rank = mates.findIndex((m) => m.id === String(ev.target)) + 1;
    lines.push(
      `regard → destinataire: ${a === null ? '—' : deg(a) + ' (' + inCone(a) + ')'}`,
      `rang du destinataire parmi ${mates.length} coéquipiers (1 = le plus proche du regard): ${rank || '—'}`,
    );
  }

  const opp = nearestOpponent(data, frame, String(ev.passer));
  if (opp) {
    const a = angleToTarget(pose.eye, pose.fwd, [opp.x, opp.y]);
    const closing = closingSpeed(data, ev.end, String(ev.passer), opp.id, opp.dist);
    const { state, ttc } = pressureState(opp.dist, closing);
    lines.push(
      `adversaire le plus proche: ${name(opp.id)} à ${opp.dist.toFixed(1)} m, ${deg(a)} du regard (${inCone(a)})`,
      `pression (géométrie): ${STATE_LABEL[state]}, contact estimé ${Number.isFinite(ttc) ? ttc.toFixed(1) + ' s' : '—'}`,
    );
  }

  if (ev.options.length) {
    lines.push('options de passe (valeur = xthreat × xpass):');
    const rows = [...ev.options].sort((x, y) => (y.xthreat ?? 0) * (y.xpass ?? 0) - (x.xthreat ?? 0) * (x.xpass ?? 0));
    for (const o of rows) {
      const a = angleOf(o.id);
      const v = (o.xthreat ?? 0) * (o.xpass ?? 0);
      lines.push(
        ` ${o.id === ev.target ? '►' : ' '} ${name(o.id)}  valeur ${v.toFixed(4)}  xT ${o.xthreat ?? '—'}  xP ${o.xpass ?? '—'}  ${a === null ? 'hors cadre' : inCone(a) + ' (' + deg(a) + ')'}`,
      );
    }
  }
  return lines;
}

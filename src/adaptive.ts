import type { ChoiceAnswer, ChoiceQuestion, LayaClient } from './laya';

// Interface adaptative : on journalise chaque action de l'utilisateur avec son contexte, on prédit la suivante,
// et on la propose sans jamais réorganiser l'écran (Tab accepte, Échap refuse).
// Deux moteurs : un modèle local qui apprend en continu (comptes avec repli, amorcé par des règles), et Laya.

export type ActionId =
  | 'play' | 'pause' | 'step'
  | 'show_options' | 'hide_options' | 'what_if'
  | 'select_carrier' | 'select_receiver' | 'select_other'
  | 'pov' | 'free'
  | 'main_2d' | 'main_3d' | 'main_video'
  | 'draw' | 'goto_event';

export const ACTIONS: Record<ActionId, { fr: string; en: string; suggest: boolean }> = {
  play: { fr: 'Reprendre la lecture', en: 'resume playback', suggest: true },
  pause: { fr: 'Mettre en pause ici', en: 'pause playback to analyse this moment', suggest: true },
  step: { fr: 'Avancer d’une frame', en: 'step forward one frame', suggest: true },
  show_options: { fr: 'Afficher les options de passe', en: 'show the passing options of the ball carrier', suggest: true },
  hide_options: { fr: 'Masquer les options de passe', en: 'hide the passing options', suggest: true },
  what_if: { fr: 'Tester un « et si » : déplacer un joueur en 2D', en: 'open the 2D view to move a player and test a what-if', suggest: true },
  select_carrier: { fr: 'Suivre le porteur du ballon', en: 'select the ball carrier', suggest: true },
  select_receiver: { fr: 'Sélectionner le meilleur receveur', en: 'select the best pass receiver', suggest: true },
  select_other: { fr: 'Sélectionner un autre joueur', en: 'select another player', suggest: false },
  pov: { fr: 'Voir en POV (ce que voit le joueur)', en: 'switch to the first-person view of the selected player', suggest: true },
  free: { fr: 'Revenir en vue libre', en: 'go back to the free camera', suggest: true },
  main_2d: { fr: 'Vue 2D en grand', en: 'enlarge the 2D tactical view', suggest: true },
  main_3d: { fr: 'Vue 3D en grand', en: 'enlarge the 3D view', suggest: true },
  main_video: { fr: 'Vidéo en grand', en: 'enlarge the match video', suggest: true },
  draw: { fr: 'Dessiner une flèche', en: 'draw an arrow annotation', suggest: true },
  goto_event: { fr: 'Aller à une passe de la liste', en: 'jump to a pass from the list', suggest: false },
};

export interface Ctx {
  playing: boolean;
  mode: 'free' | 'pov';
  main: '3d' | '2d' | 'video';
  sel: 'carrier' | 'receiver' | 'other';
  options: boolean;
  event: 'none' | 'during' | 'pass';
  drawing: boolean;
  moved: boolean;
  last: ActionId | 'none';
}

const ctxKey = (c: Ctx) => [c.playing ? 'P' : 'S', c.mode, c.main, c.sel, c.options ? 'O' : '-', c.event, c.drawing ? 'D' : '-', c.moved ? 'M' : '-'].join('|');

export function ctxText(c: Ctx): string {
  return [
    'Football video analysis tool used by a coach.',
    `Playback: ${c.playing ? 'playing' : 'paused'}.`,
    `Main view: ${c.main === '2d' ? '2D tactical board' : c.main === 'video' ? 'match video' : '3D scene'}, ${c.mode === 'pov' ? 'first-person view' : 'free camera'}.`,
    `Selected player: ${c.sel === 'carrier' ? 'the ball carrier' : c.sel === 'receiver' ? 'a pass receiver' : 'a player without the ball'}.`,
    `Passing options: ${c.options ? 'shown' : 'hidden'}.`,
    `Moment: ${c.event === 'pass' ? 'a pass is being played right now' : c.event === 'during' ? 'a player has the ball' : 'no ball possession'}.`,
    c.moved ? 'The coach has moved players to test a what-if.' : '',
    c.drawing ? 'Arrow drawing is active.' : '',
    `Last action: ${c.last === 'none' ? 'none' : ACTIONS[c.last].en}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

// règles de démarrage à froid : un poids par action, que les comptes observés remplacent vite
function rulePrior(c: Ctx, valid: ActionId[]): Record<string, number> {
  const w: Record<string, number> = {};
  for (const a of valid) w[a] = 1;
  const add = (a: ActionId, v: number) => a in w && (w[a] += v);
  if (c.playing) {
    add('pause', c.event === 'pass' ? 8 : 1);
  } else {
    add('play', 1.5);
    if (c.sel !== 'carrier' && c.event !== 'none') add('select_carrier', 5);
    if (c.sel === 'carrier' && !c.options) add('show_options', 7);
    if (c.options && c.main !== '2d' && !c.moved) add('what_if', 5);
    if (c.options) add('select_receiver', 3);
    if (c.mode === 'free' && c.last === 'select_receiver') add('pov', 5);
    if (c.mode === 'pov') add('free', 2), add('play', 2);
    if (c.moved) add('draw', 2);
  }
  return w;
}

const norm = (w: Record<string, number>) => {
  const s = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const o: Record<string, number> = {};
  for (const k in w) o[k] = w[k] / s;
  return o;
};

interface Store {
  key: Record<string, Record<string, number>>;
  back: Record<string, Record<string, number>>;
  dismiss: Record<string, Record<string, number>>;
}

export class IntentModel {
  private s: Store = { key: {}, back: {}, dismiss: {} };
  constructor(private storeKey = 'pov.intent.v1') {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) this.s = { ...this.s, ...JSON.parse(raw) };
    } catch {
      /* stockage indisponible : on apprend pour la session */
    }
  }

  get observations(): number {
    return Object.values(this.s.key).reduce((n, r) => n + Object.values(r).reduce((a, b) => a + b, 0), 0);
  }

  private save() {
    try {
      localStorage.setItem(this.storeKey, JSON.stringify(this.s));
    } catch {
      /* idem */
    }
  }

  reset(): void {
    this.s = { key: {}, back: {}, dismiss: {} };
    this.save();
  }

  observe(c: Ctx, a: ActionId): void {
    const inc = (t: Record<string, Record<string, number>>, k: string) => ((t[k] ??= {})[a] = (t[k][a] ?? 0) + 1);
    inc(this.s.key, ctxKey(c));
    inc(this.s.back, c.last);
    const d = this.s.dismiss[ctxKey(c)];
    if (d?.[a]) d[a] = Math.max(0, d[a] - 1);
    this.save();
  }

  dismissed(c: Ctx, a: ActionId): void {
    const t = (this.s.dismiss[ctxKey(c)] ??= {});
    t[a] = (t[a] ?? 0) + 1;
    this.save();
  }

  // P(a | contexte) = comptes du contexte, repli sur la dernière action, puis sur les règles
  predict(c: Ctx, valid: ActionId[]): Record<string, number> {
    const prior = norm(rulePrior(c, valid));
    const mix = (counts: Record<string, number> | undefined, base: Record<string, number>, alpha: number) => {
      const n = valid.reduce((s, a) => s + (counts?.[a] ?? 0), 0);
      const o: Record<string, number> = {};
      for (const a of valid) o[a] = ((counts?.[a] ?? 0) + alpha * base[a]) / (n + alpha);
      return o;
    };
    const p = mix(this.s.key[ctxKey(c)], mix(this.s.back[c.last], prior, 3), 2);
    const d = this.s.dismiss[ctxKey(c)] ?? {};
    for (const a of valid) p[a] *= 0.5 ** (d[a] ?? 0);
    return p;
  }
}

export interface LogEntry {
  t: string;
  ctx: Ctx;
  valid: ActionId[];
  action: ActionId;
  source: 'user' | 'suggestion' | 'auto';
  suggested: ActionId | null;
  p: number | null;
}

export function layaQuestion(valid: ActionId[]): Record<string, ChoiceQuestion> {
  const criteria: Record<string, string> = {};
  for (const a of valid) criteria[a] = ACTIONS[a].en;
  return { next_action: { type: 'choice', instructions: 'What will the coach most likely do next?', criteria } };
}

export async function layaPredict(laya: LayaClient, c: Ctx, valid: ActionId[]): Promise<ChoiceAnswer | null> {
  const r = await laya.ask(ctxText(c), layaQuestion(valid));
  return r?.next_action ?? null;
}

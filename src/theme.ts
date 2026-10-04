// Thèmes : tout le style de l'application (interface, terrain 2D/3D, flèches, signatures) dans un seul objet,
// éditable en direct. Les préréglages ne sont jamais modifiés : on édite une copie, sauvegardée dans le navigateur.

export interface Theme {
  id: string;
  name: string;
  ui: {
    bg: string; panel: string; card: string; raise: string; line: string;
    text: string; dim: string; faint: string; accent: string; onAccent: string;
    radius: number; border: number;
    fontUi: string; fontDisplay: string; fontMono: string;
    caps: boolean;
  };
  pitch: {
    grass: string; grass2: string; stripes: boolean; lines: string; lineWidth: number;
    sky: string; stadium: boolean; grid: boolean;
  };
  teams: { home: string; away: string; selected: string };
  passes: {
    safe: string; risky: string; cut: string;
    width: number; curve: number;
    glow: boolean; flow: boolean; gradient: boolean;
    label: 'pastille' | 'texte' | 'cartouche';
    misregister: number;
  };
  shapes: { block: 'teinte' | 'hachures' | 'contour' };
  signature: { dimensions: boolean; bigNumbers: boolean };
}

const studio: Theme = {
  id: 'studio',
  name: 'Studio',
  ui: {
    bg: '#18191b', panel: '#1e1f21', card: '#232427', raise: '#2b2c30', line: '#35373b',
    text: '#e4e3df', dim: '#a19f98', faint: '#6f6e69', accent: '#d9d3c3', onAccent: '#18191b',
    radius: 4, border: 1, fontUi: 'Inter', fontDisplay: 'Inter', fontMono: 'IBM Plex Mono', caps: false,
  },
  pitch: { grass: '#2a332d', grass2: '#2d3730', stripes: true, lines: '#5b665e', lineWidth: 1, sky: '#1e1f21', stadium: false, grid: false },
  teams: { home: '#d98a4e', away: '#6f9cc9', selected: '#e4e3df' },
  passes: { safe: '#8fb59a', risky: '#d2a35b', cut: '#c26a5a', width: 1, curve: 1, glow: false, flow: false, gradient: false, label: 'cartouche', misregister: 0 },
  shapes: { block: 'teinte' },
  signature: { dimensions: false, bigNumbers: false },
};

const plan: Theme = {
  id: 'plan',
  name: 'Plan coté',
  ui: {
    bg: '#edede6', panel: '#e6e6de', card: '#f3f3ed', raise: '#dfdfd5', line: '#b9bcb8',
    text: '#1d2a44', dim: '#4e5a73', faint: '#8a92a3', accent: '#d8432e', onAccent: '#ffffff',
    radius: 0, border: 1, fontUi: 'IBM Plex Mono', fontDisplay: 'IBM Plex Mono', fontMono: 'IBM Plex Mono', caps: true,
  },
  pitch: { grass: '#edede6', grass2: '#e8e8e0', stripes: false, lines: '#1d2a44', lineWidth: 0.7, sky: '#edede6', stadium: false, grid: true },
  teams: { home: '#d8432e', away: '#1d2a44', selected: '#c08a1e' },
  passes: { safe: '#1d2a44', risky: '#9a7a3a', cut: '#d8432e', width: 0.8, curve: 1, glow: false, flow: false, gradient: false, label: 'texte', misregister: 0 },
  shapes: { block: 'hachures' },
  signature: { dimensions: true, bigNumbers: false },
};

const affiche: Theme = {
  id: 'affiche',
  name: 'Affiche',
  ui: {
    bg: '#f4f2ee', panel: '#f4f2ee', card: '#ebe8e2', raise: '#e2dfd8', line: '#111111',
    text: '#111111', dim: '#4d4b47', faint: '#8b8985', accent: '#e2231a', onAccent: '#ffffff',
    radius: 0, border: 2, fontUi: 'Archivo', fontDisplay: 'Archivo', fontMono: 'IBM Plex Mono', caps: false,
  },
  pitch: { grass: '#dcdad4', grass2: '#d6d4cd', stripes: false, lines: '#f4f2ee', lineWidth: 1.8, sky: '#f4f2ee', stadium: false, grid: false },
  teams: { home: '#e2231a', away: '#111111', selected: '#e2231a' },
  passes: { safe: '#111111', risky: '#8b8985', cut: '#e2231a', width: 1.6, curve: 0, glow: false, flow: false, gradient: false, label: 'texte', misregister: 0 },
  shapes: { block: 'teinte' },
  signature: { dimensions: false, bigNumbers: true },
};

const riso: Theme = {
  id: 'riso',
  name: 'Risographie',
  ui: {
    bg: '#f6f1e4', panel: '#f1ebdc', card: '#f9f5ea', raise: '#ece4d0', line: '#c9c3d9',
    text: '#2b3a8c', dim: '#5a66a8', faint: '#9aa2cc', accent: '#e8457b', onAccent: '#ffffff',
    radius: 2, border: 1, fontUi: 'Instrument Sans', fontDisplay: 'Instrument Serif', fontMono: 'IBM Plex Mono', caps: false,
  },
  pitch: { grass: '#c9d3f0', grass2: '#c2cdee', stripes: false, lines: '#2b3a8c', lineWidth: 1, sky: '#f6f1e4', stadium: false, grid: false },
  teams: { home: '#e8457b', away: '#2b3a8c', selected: '#e8457b' },
  passes: { safe: '#2b3a8c', risky: '#7b6fb0', cut: '#e8457b', width: 1.2, curve: 1, glow: false, flow: false, gradient: false, label: 'texte', misregister: 2 },
  shapes: { block: 'teinte' },
  signature: { dimensions: false, bigNumbers: false },
};

const tribune: Theme = {
  id: 'tribune',
  name: 'Tribune',
  ui: {
    bg: '#0f1d14', panel: '#14261a', card: '#183020', raise: '#1f3b28', line: '#2c4a35',
    text: '#ffffff', dim: '#a9c2ae', faint: '#6f8d77', accent: '#f5d547', onAccent: '#14261a',
    radius: 0, border: 1, fontUi: 'Barlow Condensed', fontDisplay: 'Barlow Condensed', fontMono: 'Barlow Condensed', caps: true,
  },
  pitch: { grass: '#2f6b3b', grass2: '#2a6236', stripes: true, lines: '#ffffff', lineWidth: 1.2, sky: '#8fa9bf', stadium: true, grid: false },
  teams: { home: '#f08a24', away: '#3a8dde', selected: '#f5d547' },
  passes: { safe: '#f5d547', risky: '#ffffff', cut: '#e5484d', width: 1.4, curve: 0, glow: false, flow: false, gradient: false, label: 'cartouche', misregister: 0 },
  shapes: { block: 'contour' },
  signature: { dimensions: false, bigNumbers: false },
};

export const PRESETS: Theme[] = [studio, plan, affiche, riso, tribune];

export const FONTS = [
  'Inter', 'Instrument Sans', 'IBM Plex Sans', 'Archivo', 'Barlow Condensed', 'Space Grotesk',
  'Instrument Serif', 'Source Serif 4', 'Fraunces', 'IBM Plex Mono', 'JetBrains Mono', 'system-ui',
];

// ——— schéma de l'éditeur : chaque réglage, son libellé et son type ———

export type Field =
  | { path: string; label: string; type: 'color' | 'bool' | 'font' }
  | { path: string; label: string; type: 'range'; min: number; max: number; step: number }
  | { path: string; label: string; type: 'select'; options: string[] };

export const SCHEMA: { group: string; fields: Field[] }[] = [
  {
    group: 'Interface',
    fields: [
      { path: 'ui.bg', label: 'Fond', type: 'color' },
      { path: 'ui.panel', label: 'Panneau', type: 'color' },
      { path: 'ui.card', label: 'Cartes', type: 'color' },
      { path: 'ui.raise', label: 'Boutons', type: 'color' },
      { path: 'ui.line', label: 'Filets', type: 'color' },
      { path: 'ui.text', label: 'Texte', type: 'color' },
      { path: 'ui.dim', label: 'Texte secondaire', type: 'color' },
      { path: 'ui.faint', label: 'Texte discret', type: 'color' },
      { path: 'ui.accent', label: 'Accent', type: 'color' },
      { path: 'ui.onAccent', label: 'Texte sur accent', type: 'color' },
      { path: 'ui.radius', label: 'Arrondi des coins', type: 'range', min: 0, max: 14, step: 1 },
      { path: 'ui.border', label: 'Épaisseur des filets', type: 'range', min: 0, max: 3, step: 0.5 },
    ],
  },
  {
    group: 'Typographie',
    fields: [
      { path: 'ui.fontUi', label: 'Texte', type: 'font' },
      { path: 'ui.fontDisplay', label: 'Titres et chiffres', type: 'font' },
      { path: 'ui.fontMono', label: 'Données', type: 'font' },
      { path: 'ui.caps', label: 'Libellés en capitales', type: 'bool' },
    ],
  },
  {
    group: 'Terrain',
    fields: [
      { path: 'pitch.grass', label: 'Pelouse', type: 'color' },
      { path: 'pitch.grass2', label: 'Bandes', type: 'color' },
      { path: 'pitch.stripes', label: 'Bandes de tonte', type: 'bool' },
      { path: 'pitch.lines', label: 'Lignes', type: 'color' },
      { path: 'pitch.lineWidth', label: 'Épaisseur des lignes', type: 'range', min: 0.4, max: 2.5, step: 0.1 },
      { path: 'pitch.grid', label: 'Quadrillage (2D)', type: 'bool' },
      { path: 'pitch.sky', label: 'Ciel (3D)', type: 'color' },
      { path: 'pitch.stadium', label: 'Stade (3D)', type: 'bool' },
    ],
  },
  {
    group: 'Joueurs',
    fields: [
      { path: 'teams.home', label: 'Domicile', type: 'color' },
      { path: 'teams.away', label: 'Extérieur', type: 'color' },
      { path: 'teams.selected', label: 'Joueur suivi', type: 'color' },
    ],
  },
  {
    group: 'Flèches',
    fields: [
      { path: 'passes.safe', label: 'Couloir libre', type: 'color' },
      { path: 'passes.risky', label: 'Risqué', type: 'color' },
      { path: 'passes.cut', label: 'Coupé', type: 'color' },
      { path: 'passes.width', label: 'Épaisseur', type: 'range', min: 0.4, max: 2.5, step: 0.1 },
      { path: 'passes.curve', label: 'Courbure', type: 'range', min: 0, max: 2, step: 0.1 },
      { path: 'passes.gradient', label: 'Dégradé', type: 'bool' },
      { path: 'passes.glow', label: 'Halo', type: 'bool' },
      { path: 'passes.flow', label: 'Flux animé', type: 'bool' },
      { path: 'passes.label', label: 'Étiquettes', type: 'select', options: ['pastille', 'texte', 'cartouche'] },
      { path: 'passes.misregister', label: 'Décalage d’encre', type: 'range', min: 0, max: 4, step: 0.5 },
      { path: 'shapes.block', label: 'Bloc défensif', type: 'select', options: ['teinte', 'hachures', 'contour'] },
    ],
  },
  {
    group: 'Signatures',
    fields: [
      { path: 'signature.dimensions', label: 'Cotes de distance', type: 'bool' },
      { path: 'signature.bigNumbers', label: 'Grands chiffres', type: 'bool' },
    ],
  },
];

export function getPath(t: Theme, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], t);
}

export function setPath(t: Theme, path: string, v: unknown): void {
  const ks = path.split('.');
  const last = ks.pop()!;
  (ks.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], t) as Record<string, unknown>)[last] = v;
}

const clone = (t: Theme): Theme => JSON.parse(JSON.stringify(t));

// complète un thème importé ou ancien avec les valeurs du préréglage Studio
function complete(t: Partial<Theme>): Theme {
  const base = clone(studio);
  const merge = (a: Record<string, unknown>, b: Record<string, unknown> | undefined) => {
    for (const k in b ?? {}) {
      const v = b![k];
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof a[k] === 'object') merge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
      else if (v !== undefined) a[k] = v;
    }
  };
  merge(base as unknown as Record<string, unknown>, t as Record<string, unknown>);
  return base;
}

// ——— état courant + stockage ———

const STORE = 'pov.themes.v1';
const CURRENT = 'pov.theme.current.v1';
let custom: Theme[] = [];
let current: Theme = clone(studio);
const listeners: ((t: Theme) => void)[] = [];

try {
  custom = (JSON.parse(localStorage.getItem(STORE) ?? '[]') as Partial<Theme>[]).map(complete);
  const id = localStorage.getItem(CURRENT);
  const found = [...PRESETS, ...custom].find((t) => t.id === id);
  if (found) current = clone(found);
} catch {
  custom = [];
}

const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(custom));
    localStorage.setItem(CURRENT, current.id);
  } catch {
    /* stockage indisponible : le thème vaut pour la session */
  }
};

export const theme = (): Theme => current;
export const customThemes = (): Theme[] => custom;
export const isPreset = (id: string) => PRESETS.some((p) => p.id === id);
export const onTheme = (fn: (t: Theme) => void) => listeners.push(fn);

export function selectTheme(id: string): void {
  const t = [...PRESETS, ...custom].find((x) => x.id === id);
  if (!t) return;
  current = clone(t);
  save();
  applyTheme();
}

// modifier un préréglage crée d'abord sa copie : les préréglages restent intacts
export function editTheme(path: string, v: unknown): void {
  if (isPreset(current.id)) duplicateTheme(`${current.name} (perso)`);
  setPath(current, path, v);
  const i = custom.findIndex((t) => t.id === current.id);
  if (i >= 0) custom[i] = clone(current);
  save();
  applyTheme();
}

export function duplicateTheme(name: string): void {
  current = { ...clone(current), id: `perso-${Date.now().toString(36)}`, name };
  custom.push(clone(current));
  save();
}

export function renameTheme(name: string): void {
  if (isPreset(current.id)) return duplicateTheme(name);
  current.name = name;
  const t = custom.find((x) => x.id === current.id);
  if (t) t.name = name;
  save();
  applyTheme();
}

export function deleteTheme(): void {
  if (isPreset(current.id)) return;
  custom = custom.filter((t) => t.id !== current.id);
  current = clone(studio);
  save();
  applyTheme();
}

export function importTheme(json: string): void {
  const t = complete(JSON.parse(json));
  current = { ...t, id: `perso-${Date.now().toString(36)}`, name: t.name || 'Thème importé' };
  custom.push(clone(current));
  save();
  applyTheme();
}

export function exportTheme(): string {
  const { id: _id, ...rest } = current;
  return JSON.stringify(rest, null, 2);
}

// ——— application : variables CSS + polices + notification des rendus (canvas, 3D) ———

const loaded = new Set<string>();
function loadFont(family: string): void {
  if (family === 'system-ui' || loaded.has(family)) return;
  loaded.add(family);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;500;600;700;800&display=swap`;
  if (family === 'Instrument Serif') l.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap';
  document.head.appendChild(l);
}

const stack = (f: string, fallback: string) => (f === 'system-ui' ? fallback : `'${f}', ${fallback}`);

export function applyTheme(): void {
  const u = current.ui;
  for (const f of [u.fontUi, u.fontDisplay, u.fontMono]) loadFont(f);
  const r = document.documentElement.style;
  const vars: Record<string, string> = {
    '--bg': u.bg, '--panel': u.panel, '--card': u.card, '--raise': u.raise, '--line': u.line,
    '--line2': `color-mix(in srgb, ${u.line} 70%, ${u.text})`,
    '--text': u.text, '--dim': u.dim, '--faint': u.faint, '--accent': u.accent, '--on-accent': u.onAccent,
    '--radius': `${u.radius}px`, '--bw': `${u.border}px`,
    '--font-ui': stack(u.fontUi, 'system-ui, sans-serif'),
    '--font-display': stack(u.fontDisplay, 'system-ui, sans-serif'),
    '--font-mono': stack(u.fontMono, 'ui-monospace, monospace'),
    '--home': current.teams.home, '--away': current.teams.away,
    '--safe': current.passes.safe, '--risky': current.passes.risky, '--cut': current.passes.cut,
  };
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v);
  document.body.classList.toggle('caps', u.caps);
  document.body.classList.toggle('big-numbers', current.signature.bigNumbers);
  listeners.forEach((f) => f(current));
}

export const hexNum = (c: string) => parseInt(c.slice(1), 16);
export const safetyColor = (s: number) => (s >= 0.6 ? current.passes.safe : s >= 0.3 ? current.passes.risky : current.passes.cut);

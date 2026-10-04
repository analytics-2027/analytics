export type Vec3 = [number, number, number];

export interface PlayerFrame {
  x: number;
  y: number;
  det: boolean;
  j: (Vec3 | null)[] | null;
  jo?: number;
}

export interface PassOption {
  id: number;
  xthreat: number | null;
  xpass: number | null;
  score: number | null;
  dangerous: boolean;
}

export interface PassEvent {
  id: string;
  passer: number;
  start: number;
  end: number;
  endType: string;
  target: number | null;
  outcome: string | null;
  xthreat: number | null;
  xpass: number | null;
  pressureStart: string | null;
  pressureEnd: string | null;
  options: PassOption[];
}

export interface Frame {
  f: number;
  cam: [number, number][] | null;
  ball: Vec3 | null;
  poss: number | null;
  p: Record<string, PlayerFrame>;
}

export interface PlayerMeta {
  n: number | null;
  name: string;
  team: 'home' | 'away';
  role: string | null;
  cov: { frames: number; detected: number; joints: number; head: number };
}

export interface Phase {
  i: number;
  start: number;
  end: number;
  team: 'home' | 'away';
  inPoss: string | null;
  outPoss: string | null;
}

export interface Dataset {
  phases?: Phase[];
  jointsBin?: string;
  match_id: number;
  fps: number;
  pitch: [number, number];
  teams: { home: string; away: string };
  video: { id: string; start: number; period: number } | null;
  joints: string[];
  players: Record<string, PlayerMeta>;
  events: PassEvent[];
  frames: Frame[];
}

export const J: Record<string, number> = {};
[
  'nose', 'neck', 'lEye', 'rEye', 'lEar', 'rEar', 'lShoulder', 'rShoulder',
  'lElbow', 'rElbow', 'lWrist', 'rWrist', 'lThumb', 'rThumb', 'lPinky', 'rPinky',
  'midHip', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'lHeel', 'rHeel',
  'lBigToe', 'rBigToe', 'lSmallToe', 'rSmallToe',
].forEach((name, i) => (J[name] = i));

export async function loadDataset(url: string): Promise<Dataset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Chargement impossible: ${url} (${res.status})`);
  const data: Dataset = await res.json();
  if (data.jointsBin) {
    const bin = await fetch(new URL(data.jointsBin, new URL(url, location.href)));
    if (!bin.ok) throw new Error(`Poses introuvables: ${data.jointsBin} (${bin.status})`);
    attachJoints(data, new Int16Array(await bin.arrayBuffer()));
  }
  return data;
}

// poses en binaire (int16, cm, -32768 = joint absent) : décodées à la lecture pour ne pas créer des millions de tableaux
let lastPf: PlayerFrame | null = null;
let lastJ: (Vec3 | null)[] | null = null;

function attachJoints(data: Dataset, buf: Int16Array): void {
  const n = data.joints.length;
  for (const fr of data.frames) {
    for (const pf of Object.values(fr.p)) {
      const jo = pf.jo;
      if (jo === undefined || jo < 0) continue;
      Object.defineProperty(pf, 'j', {
        enumerable: true,
        configurable: true,
        get(): (Vec3 | null)[] {
          // les boucles lisent p.j plusieurs fois de suite pour le même joueur : une case de cache suffit
          if (lastPf === pf) return lastJ!;
          const out: (Vec3 | null)[] = new Array(n);
          for (let k = 0; k < n; k++) {
            const o = (jo * n + k) * 3;
            out[k] = buf[o] === -32768 ? null : [buf[o] / 100, buf[o + 1] / 100, buf[o + 2] / 100];
          }
          lastPf = pf;
          lastJ = out;
          return out;
        },
      });
    }
  }
}

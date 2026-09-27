export type Vec3 = [number, number, number];

export interface PlayerFrame {
  x: number;
  y: number;
  det: boolean;
  j: (Vec3 | null)[] | null;
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

export interface Dataset {
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
  return res.json();
}

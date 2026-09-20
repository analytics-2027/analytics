import { J, type PlayerFrame, type Vec3 } from './data';

export type Quality = 'head' | 'ears' | 'torso' | 'interp';

export interface HeadPose {
  eye: Vec3;
  fwd: Vec3;
  quality: Quality;
}

export const EYE_HEIGHT = 1.7;

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function unit(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-6 ? null : [v[0] / l, v[1] / l, v[2] / l];
}

// Repère terrain : x longueur, y largeur (nord), z haut. Un joueur face au nord (+y) a son oreille droite à l'est (+x),
// donc "avant" = rotation de +90° du vecteur oreille gauche -> oreille droite.
export function headPose(p: PlayerFrame): HeadPose | null {
  const j = p.j;
  if (!j) return null;
  const nose = j[J.nose], lEye = j[J.lEye], rEye = j[J.rEye];
  const lEar = j[J.lEar], rEar = j[J.rEar], lSh = j[J.lShoulder], rSh = j[J.rShoulder];

  const eye = lEye && rEye ? mid(lEye, rEye) : nose ?? (lEar && rEar ? mid(lEar, rEar) : null);
  if (!eye) return null;

  let fwd: Vec3 | null = null;
  let quality: Quality = 'head';
  if (nose && lEar && rEar) fwd = unit(sub(nose, mid(lEar, rEar)));
  if (!fwd && lEar && rEar) {
    const r = sub(rEar, lEar);
    fwd = unit([-r[1], r[0], 0]);
    quality = 'ears';
  }
  if (!fwd && lSh && rSh) {
    const r = sub(rSh, lSh);
    fwd = unit([-r[1], r[0], 0]);
    quality = 'torso';
  }
  return fwd ? { eye, fwd, quality } : null;
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Comble les trous de pose de <= maxGap frames par interpolation (ou maintien en début/fin de série).
export function fillGaps(series: (HeadPose | null)[], maxGap: number): (HeadPose | null)[] {
  const out = series.slice();
  let prev = -1;
  for (let i = 0; i < series.length; i++) {
    const cur = series[i];
    if (!cur) continue;
    if (prev < 0) {
      for (let k = Math.max(0, i - maxGap); k < i; k++) out[k] = { ...cur, quality: 'interp' };
    } else if (i - prev > 1 && i - prev - 1 <= maxGap) {
      const a = series[prev]!;
      for (let k = prev + 1; k < i; k++) {
        const t = (k - prev) / (i - prev);
        out[k] = { eye: lerp3(a.eye, cur.eye, t), fwd: unit(lerp3(a.fwd, cur.fwd, t)) ?? a.fwd, quality: 'interp' };
      }
    }
    prev = i;
  }
  if (prev >= 0) {
    const last = series[prev]!;
    for (let k = prev + 1; k < Math.min(series.length, prev + 1 + maxGap); k++) out[k] = { ...last, quality: 'interp' };
  }
  return out;
}

export function yawDeg(fwd: Vec3): number {
  return (Math.atan2(fwd[1], fwd[0]) * 180) / Math.PI;
}

// Angle horizontal entre la direction du regard et une cible (x,y), en degrés absolus.
export function angleToTarget(eye: Vec3, fwd: Vec3, target: [number, number]): number {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  let d = Math.abs(yawDeg(fwd) - (Math.atan2(dy, dx) * 180) / Math.PI) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export interface PovState {
  eye: Vec3;
  fwd: Vec3;
  quality: Quality | null;
  stale: boolean;
}

export class PovFilter {
  private eye: Vec3 | null = null;
  private fwd: Vec3 | null = null;
  private lastValidFrame = -Infinity;

  reset(): void {
    this.eye = null;
    this.fwd = null;
    this.lastValidFrame = -Infinity;
  }

  update(
    raw: HeadPose | null,
    fallbackXY: [number, number],
    frame: number,
    dtSec: number,
    tauSec: number,
    lockHorizon: boolean,
  ): PovState {
    const a = tauSec <= 0 ? 1 : 1 - Math.exp(-dtSec / tauSec);
    let quality: Quality | null = null;

    if (raw) {
      let target = raw.fwd;
      if (lockHorizon) target = unit([target[0], target[1], 0]) ?? target;
      else {
        const h = Math.hypot(target[0], target[1]);
        const maxZ = Math.tan(Math.PI / 4) * h;
        target = unit([target[0], target[1], Math.max(-maxZ, Math.min(maxZ, target[2]))]) ?? target;
      }
      this.fwd = this.fwd
        ? unit([
            this.fwd[0] + (target[0] - this.fwd[0]) * a,
            this.fwd[1] + (target[1] - this.fwd[1]) * a,
            this.fwd[2] + (target[2] - this.fwd[2]) * a,
          ]) ?? target
        : target;
      const e = lockHorizon ? ([raw.eye[0], raw.eye[1], EYE_HEIGHT] as Vec3) : raw.eye;
      this.eye = this.eye
        ? [
            this.eye[0] + (e[0] - this.eye[0]) * a,
            this.eye[1] + (e[1] - this.eye[1]) * a,
            this.eye[2] + (e[2] - this.eye[2]) * a,
          ]
        : e;
      this.lastValidFrame = frame;
      quality = raw.quality;
    } else {
      const z = this.eye ? this.eye[2] : EYE_HEIGHT;
      const e: Vec3 = [fallbackXY[0], fallbackXY[1], z];
      this.eye = this.eye
        ? [
            this.eye[0] + (e[0] - this.eye[0]) * Math.max(a, 0.5),
            this.eye[1] + (e[1] - this.eye[1]) * Math.max(a, 0.5),
            z,
          ]
        : e;
    }

    return {
      eye: this.eye!,
      fwd: this.fwd ?? [1, 0, 0],
      quality,
      stale: frame - this.lastValidFrame > 12 || this.fwd === null,
    };
  }
}

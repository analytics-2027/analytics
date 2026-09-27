export type Pt = [number, number];

// Flèche posée au sol, en coordonnées terrain (m) : la même géométrie est projetée sur la 3D, la 2D et la vidéo.
export interface Arrow {
  a: Pt;
  b: Pt;
}

export const ARROW_HEX = 0x00e5ff;
export const ARROW_CSS = '#00e5ff';

export function arrowPolys(a: Pt, b: Pt): { shaft: Pt[]; head: Pt[] } | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return null;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const headLen = Math.min(2.6, len * 0.45), headHalf = 0.95, shaftHalf = 0.2;
  const bx = b[0] - ux * headLen, by = b[1] - uy * headLen;
  return {
    shaft: [
      [a[0] + nx * shaftHalf, a[1] + ny * shaftHalf],
      [bx + nx * shaftHalf, by + ny * shaftHalf],
      [bx - nx * shaftHalf, by - ny * shaftHalf],
      [a[0] - nx * shaftHalf, a[1] - ny * shaftHalf],
    ],
    head: [
      [bx + nx * headHalf, by + ny * headHalf],
      [b[0], b[1]],
      [bx - nx * headHalf, by - ny * headHalf],
    ],
  };
}

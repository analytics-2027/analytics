"""Calibre la caméra TV : une homographie sol -> image par frame, ajustée sur les lignes blanches de la vidéo.

Ce que les données garantissent (`image_corners_projection`) : les 2 coins du bas de l'image sont de vrais points du sol, et
les 2 coins du haut sont sur les bons bords (gauche/droit) de l'image mais plafonnés à y = 39 m (les bords se coupent à
un point fixe, la verticale de la caméra). Il reste donc 2 inconnues par frame : jusqu'où les deux bords montent vers
l'horizon. On les ajuste (paramètre sigma = 1 / distance, ce qui permet de dépasser l'horizon) pour que les lignes du
terrain projetées tombent sur les lignes blanches détectées dans l'image.

Écrit public/video/camera406.json (indexé par frame de données, à lire au temps vidéo correspondant).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parent.parent
from clip_paths import paths

DATA, CLIP, META, OUT = paths()
W, H = 640, 360
FPS = 25
CAP = 14.0


def read_frames(t0, seconds):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{seconds:.3f}", "-i", str(CLIP),
           "-vf", f"fps={FPS},scale={W}:{H},format=rgb24", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def line_mask(rgb):
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    gray = 0.299 * r + 0.587 * g + 0.114 * b
    grass = (g > r + 6) & (g > b + 10) & (g > 35)
    region = ndi.binary_closing(grass, structure=np.ones((13, 13)))
    region = ndi.binary_opening(region, structure=np.ones((5, 5)))
    top = gray - ndi.grey_opening(gray, size=(9, 9))
    white = (top > 22) & (gray > 105) & ((g - np.minimum(r, b)) < 70)
    return white & region


def dist_map(mask):
    dt = ndi.distance_transform_edt(~mask).astype(np.float32)
    return ndi.gaussian_filter(np.minimum(dt, CAP), 1.0)


def pitch_points(length=105.0, width=68.0, step=0.35):
    L, W2 = length / 2, width / 2
    segs = [((-L, -W2), (L, -W2)), ((L, -W2), (L, W2)), ((L, W2), (-L, W2)), ((-L, W2), (-L, -W2)), ((0, -W2), (0, W2))]
    for s in (-1, 1):
        for a, b in (((s * L, -20.16), (s * (L - 16.5), -20.16)), ((s * (L - 16.5), -20.16), (s * (L - 16.5), 20.16)),
                     ((s * (L - 16.5), 20.16), (s * L, 20.16)), ((s * L, -9.16), (s * (L - 5.5), -9.16)),
                     ((s * (L - 5.5), -9.16), (s * (L - 5.5), 9.16)), ((s * (L - 5.5), 9.16), (s * L, 9.16))):
            segs.append((a, b))
    pts = []
    for a, b in segs:
        k = max(2, int(np.hypot(b[0] - a[0], b[1] - a[1]) / step))
        pts += [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in np.linspace(0, 1, k)]
    pts += [(9.15 * np.cos(t), 9.15 * np.sin(t)) for t in np.linspace(0, 2 * np.pi, 220)]
    for s in (-1, 1):
        a = np.arccos(5.5 / 9.15)
        cx = s * (L - 11)
        t = np.linspace(np.pi - a, np.pi + a, 60) if s > 0 else np.linspace(-a, a, 60)
        pts += [(cx + 9.15 * np.cos(u), 9.15 * np.sin(u)) for u in t]
    return np.array(pts)


def dlt(ground_h, img):
    """Homographie sol (X,Y,W homogène) -> image (u,v) à partir de 4 correspondances."""
    rows = []
    for (X, Y, Wg), (u, v) in zip(ground_h, img):
        rows.append([X, Y, Wg, 0, 0, 0, -u * X, -u * Y, -u * Wg])
        rows.append([0, 0, 0, X, Y, Wg, -v * X, -v * Y, -v * Wg])
    _, _, vt = np.linalg.svd(np.array(rows))
    return vt[-1].reshape(3, 3)


def frame_homography(cam, sigma_l, sigma_r):
    TL, TR, BR, BL = (np.asarray(c, float) for c in cam)
    dl = (TL - BL) / np.linalg.norm(TL - BL)
    dr = (TR - BR) / np.linalg.norm(TR - BR)
    # point homogène BL + dl / sigma (à l'infini quand sigma = 0, au-delà de l'horizon quand sigma < 0)
    tl = [BL[0] * sigma_l + dl[0], BL[1] * sigma_l + dl[1], sigma_l]
    tr = [BR[0] * sigma_r + dr[0], BR[1] * sigma_r + dr[1], sigma_r]
    Hm = dlt([tl, tr, [*BR, 1.0], [*BL, 1.0]], [(0, 0), (1, 0), (1, 1), (0, 1)])
    if (Hm @ np.array([*BL, 1.0]))[2] < 0:
        Hm = -Hm
    return Hm / np.linalg.norm(Hm)


def sigma0(cam):
    TL, TR, BR, BL = (np.asarray(c, float) for c in cam)
    return 1.0 / np.linalg.norm(TL - BL), 1.0 / np.linalg.norm(TR - BR)


def project(Hm, pts):
    p = np.c_[pts, np.ones(len(pts))] @ Hm.T
    z = p[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        uv = p[:, :2] / z[:, None]
    return uv, z > 1e-9


def cost_vec(Hm, pts, dt):
    uv, ok = project(Hm, pts)
    px, py = uv[:, 0] * W, uv[:, 1] * H
    inside = ok & np.isfinite(px) & np.isfinite(py) & (px > 2) & (px < W - 3) & (py > 2) & (py < H - 3)
    res = np.full(len(pts), CAP, np.float32)
    if inside.any():
        res[inside] = ndi.map_coordinates(dt, [py[inside], px[inside]], order=1, mode="nearest")
    return res, inside


def fit_frame(cam, dt, pts, s_start, prior=None, prior_w=0.0, mults=(1.0, 0.6, 1.6, 0.3, -0.3)):
    scale = 100.0

    def fun(s):
        res, _ = cost_vec(frame_homography(cam, s[0] / scale, s[1] / scale), pts, dt)
        if prior is not None and prior_w > 0:
            res = np.r_[res, prior_w * (s - prior)]
        return res

    best = None
    for mult in mults:
        s0 = np.array(s_start) * scale * mult
        sol = least_squares(fun, s0, loss="soft_l1", f_scale=3.0, x_scale=np.array([0.5, 0.5]), max_nfev=40)
        if best is None or sol.cost < best.cost:
            best = sol
    return best.x / scale, best.cost


def smooth_corners(c):
    """Les coins ne sont mis à jour qu'à ~10 Hz (paliers) : interpolation linéaire entre paliers, puis léger lissage."""
    n = len(c)
    flat = c.reshape(n, 8)
    change = np.r_[True, np.any(np.abs(np.diff(flat, axis=0)) > 1e-6, axis=1)]
    knots = np.flatnonzero(change)
    out = np.column_stack([np.interp(np.arange(n), knots, flat[knots, j]) for j in range(8)])
    return ndi.gaussian_filter1d(out, 1.5, axis=0, mode="nearest").reshape(n, 4, 2)


def jitter(Hs, pts=((10, 0), (20, -8), (28, 6), (0, -5))):
    """Secousse : accélération RMS (px/frame², image de 960 px) de points fixes du sol projetés."""
    out = []
    for P in pts:
        uv = np.array([project(Hm, np.array([P], float))[0][0] for Hm in Hs]) * np.array([960, 540])
        out.append(np.sqrt((np.diff(uv, 2, axis=0) ** 2).sum(1).mean()))
    return float(np.mean(out))


def overlay_png(rgb, Hm, pts, path):
    from PIL import Image, ImageDraw

    img = Image.fromarray(rgb).resize((960, 540))
    dr = ImageDraw.Draw(img)
    uv, ok = project(Hm, pts)
    for (u, v), o in zip(uv, ok):
        if o and np.isfinite(u) and 0 <= u < 1 and 0 <= v < 1:
            dr.ellipse([u * 960 - 1.5, v * 540 - 1.5, u * 960 + 1.5, v * 540 + 1.5], fill=(255, 0, 200))
    img.save(path)


class Clip:
    """Lecture de l'extrait par blocs (la totalité d'un extrait de plusieurs minutes ne tient pas en mémoire)."""

    def __init__(self, t0: float, chunk: int = 150):
        self.t0, self.chunk, self.c, self.frames, self.dts = t0, chunk, -1, None, {}

    def _load(self, j: int) -> int:
        c = j // self.chunk
        if c != self.c:
            self.frames = read_frames(self.t0 + c * self.chunk / FPS, self.chunk / FPS)
            self.c, self.dts = c, {}
        return min(j - c * self.chunk, len(self.frames) - 1)

    def rgb(self, j: int) -> np.ndarray:
        i = self._load(j)  # charger avant de lire self.frames
        return self.frames[i]

    def dt(self, j: int) -> np.ndarray:
        i = self._load(j)
        if i not in self.dts:
            self.dts[i] = dist_map(line_mask(self.frames[i]))
        return self.dts[i]


def main(debug_dir: str | None = None) -> None:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    meta = json.loads(META.read_text(encoding="utf-8"))
    n = len(d["frames"])
    # emprise absente (ralentis, plans de coupe) : pas d'homographie, l'application n'y projette rien
    valid = np.array([f["cam"] is not None for f in d["frames"]])
    if not valid.any():
        sys.exit("Aucune emprise caméra dans les données.")
    idx = np.flatnonzero(valid)
    filled = [d["frames"][idx[np.argmin(np.abs(idx - k))]]["cam"] if not valid[k] else d["frames"][k]["cam"] for k in range(n)]
    cams = smooth_corners(np.array(filled, float))
    before = None
    if OUT.exists():
        prev = [h for h in json.loads(OUT.read_text(encoding="utf-8"))["H"] if h]
        before = jitter([np.array(h).reshape(3, 3) for h in prev]) if len(prev) > 3 else None
    base = d["video"]["start"] - meta["clipStart"] + float(meta.get("syncOffset", 0.0))
    t0 = base - 0.8
    clip = Clip(t0)
    pts = pitch_points()
    # extrait long : on ajuste une frame sur 10 (2,5 Hz ; ~3 s par ajustement sur CPU) puis on interpole et on lisse
    long = n > 1000
    step = 10 if long else 1
    keys = [k for k in range(0, n, step) if valid[k]]
    print(f"{n} frames de données, {len(keys)} ajustées, extrait lu à partir de {t0:.2f} s")
    vid = lambda k, off=0: max(int(round((base + k / d["fps"] - t0) * FPS)) + off, 0)

    # décalage temporel résiduel entre coins (données) et image (vidéo) : on garde celui qui aligne le mieux les lignes
    best_off, best_score = 0, None
    sample = [k for k in range(10, min(n, 1500) - 10, 60 if long else 30) if valid[k]]
    for off in (-3, 0, 3) if long else (-5, -3, -1, 0, 1, 3, 5):  # en frames
        tot = sum(fit_frame(cams[k], clip.dt(vid(k, off)), pts, sigma0(cams[k]))[1] for k in sample)
        print(f"  décalage {off:+d} frames: coût {tot:.1f}", flush=True)
        if best_score is None or tot < best_score:
            best_off, best_score = off, tot
    print(f"décalage retenu: {best_off:+d} frames ({best_off / FPS * 1000:+.0f} ms)")

    def to_all(ks, vals):
        return np.column_stack([np.interp(np.arange(n), ks, vals[:, c]) for c in range(vals.shape[1])])

    ks = np.array(keys)
    sig_k = np.array([fit_frame(cams[k], clip.dt(vid(k, best_off)), pts, sigma0(cams[k]))[0] for k in keys])
    print("1re passe faite", flush=True)
    smooth = ndi.gaussian_filter1d(to_all(ks, sig_k), 2.0, axis=0, mode="nearest")
    # 2e passe : l'a priori lissé suffit comme point de départ
    sig_k = np.array([fit_frame(cams[k], clip.dt(vid(k, best_off)), pts, smooth[k], smooth[k] * 100, 0.6, mults=(1.0,))[0] for k in keys])
    sig = ndi.gaussian_filter1d(to_all(ks, sig_k), 4.0 if long else 2.0, axis=0, mode="nearest")
    Hs = [frame_homography(cams[k], *sig[k]) if valid[k] else None for k in range(n)]
    good = [h for h in Hs if h is not None]
    print(f"secousse (px/frame², 960 px): {before:.1f} -> {jitter(good):.1f}" if before is not None else f"secousse: {jitter(good):.1f}")
    score = []
    for k in keys:
        res, ins = cost_vec(Hs[k], pts, clip.dt(vid(k, best_off)))
        score.append(np.mean(res[ins] < 3) if ins.any() else 0.0)
    score = np.array(score)
    print(f"points de ligne à <3 px: médiane {np.median(score):.0%}, 10e centile {np.percentile(score, 10):.0%}, min {score.min():.0%}")

    if debug_dir:
        Path(debug_dir).mkdir(parents=True, exist_ok=True)
        for k in np.linspace(0, len(keys) - 1, 9).astype(int):
            kk = keys[k]
            overlay_png(clip.rgb(vid(kk, best_off)), Hs[kk], pts, Path(debug_dir) / f"cam_{kk:05d}.png")
        print("images de contrôle dans", debug_dir)

    OUT.write_text(
        json.dumps({"fps": d["fps"], "offsetFrames": best_off, "H": [[round(float(v), 7) for v in Hm.ravel()] if Hm is not None else None for Hm in Hs]}),
        encoding="utf-8",
    )
    print(f"écrit {OUT} ({OUT.stat().st_size / 1e3:.0f} ko)")


if __name__ == "__main__":
    main(sys.argv[2] if len(sys.argv) > 2 else None)  # argv[1] = jeu de données (phase406 | match)

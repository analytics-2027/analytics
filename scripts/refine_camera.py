"""Affine les homographies caméra avec les joueurs comme repères, en plus des lignes blanches.

calibrate_camera.py n'ajuste que 2 paramètres et tient pour exacts les 2 coins du bas de `image_corners_projection` ;
quand ils sont un peu faux, rien ne rattrape l'erreur, et au milieu du terrain il y a peu de lignes. Ici on corrige
l'homographie complète (8 paramètres, correction H = (I + D) · H0 dans l'image) pour que :
  - les pieds projetés des joueurs tombent sur des silhouettes détectées dans l'image (bas des taches « non pelouse »),
  - les lignes du terrain restent sur les lignes blanches,
  - la correction reste petite et lisse dans le temps.

Usage : python scripts/refine_camera.py [phase406|match] [--measure | --trial]
Écrit les homographies affinées dans le fichier caméra (l'original est gardé en *.lines.json).
"""
import json
import shutil
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.optimize import least_squares

from calibrate_camera import DATA, FPS, H, META, OUT, W, Clip, cost_vec, dist_map, line_mask, pitch_points, project

MEASURE = "--measure" in sys.argv
TRIAL = "--trial" in sys.argv  # même échantillon que --measure, ajusté mais non écrit
STEP = 5
CAP_PLAYER = 22.0  # px (image 640 × 360) : au-delà, pas d'appariement
W_PLAYER = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--wp=")), 2.0))
PRIOR = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--prior=")), 400.0))


def grass_region(rgb):
    f = rgb.astype(np.int16)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    grass = (g > r + 6) & (g > b + 10) & (g > 35)
    region = ndi.binary_closing(grass, structure=np.ones((15, 15)))
    return grass, region


def player_feet(rgb) -> np.ndarray:
    """Bas-centre des taches « non pelouse » de taille joueur, à l'intérieur de la zone de pelouse."""
    grass, region = grass_region(rgb)
    blob = ~grass & region
    blob[:30] = False  # incrustation (score, chrono)
    blob = ndi.binary_opening(blob, structure=np.ones((3, 2)))
    lab, n = ndi.label(blob)
    feet = []
    for sl in ndi.find_objects(lab):
        if sl is None:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if 6 <= h <= 70 and 2 <= w <= 40 and h >= 0.8 * w:
            feet.append(((sl[1].start + sl[1].stop) / 2, sl[0].stop))
    return np.array(feet, float).reshape(-1, 2)


def correct(Hm, d):
    D = np.array([[1 + d[0], d[1], d[2]], [d[3], 1 + d[4], d[5]], [d[6], d[7], 1.0]])
    S = np.diag([W, H, 1.0])
    return np.linalg.inv(S) @ D @ S @ Hm  # correction exprimée en pixels de l'image


def player_res(Hm, ground, feet, keep_all=False):
    """Distance (px) de chaque pied projeté à la silhouette la plus proche. keep_all : longueur fixe (0 hors cadre),
    exigée par l'optimiseur ; sinon seulement les joueurs visibles (pour les mesures)."""
    if not len(ground):
        return np.zeros(0)
    uv, ok = project(Hm, ground)
    px = uv * [W, H]
    inside = ok & np.isfinite(px).all(1) & (px[:, 0] > 5) & (px[:, 0] < W - 5) & (px[:, 1] > 35) & (px[:, 1] < H - 3)
    res = np.zeros(len(ground))
    if len(feet) and inside.any():
        dd = np.sqrt(((px[inside][:, None, :] - feet[None, :, :]) ** 2).sum(-1)).min(1)
        res[inside] = np.minimum(dd, CAP_PLAYER)
    return res if keep_all else res[inside]


def main() -> None:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    meta = json.loads(META.read_text(encoding="utf-8"))
    cam = json.loads(OUT.read_text(encoding="utf-8"))
    base = d["video"]["start"] - meta["clipStart"] + float(meta.get("syncOffset", 0.0))
    t0 = base - 0.8
    clip = Clip(t0)
    n = len(d["frames"])
    pts = pitch_points(step=1.0)
    keys = [k for k in range(0, n, STEP) if cam["H"][k] is not None]
    if MEASURE or TRIAL:
        keys = keys[:: max(1, len(keys) // 60)]
    print(f"{len(keys)} images à traiter", flush=True)

    deltas, before_p, after_p, before_l, after_l = [], [], [], [], []
    for i, k in enumerate(keys):
        j = max(int(round((base + k / d["fps"] - t0) * FPS)) + cam["offsetFrames"], 0)
        rgb = clip.rgb(j)
        dt = clip.dt(j)
        feet = player_feet(rgb)
        ground = np.array([[p["x"], p["y"]] for p in d["frames"][k]["p"].values()])
        H0 = np.array(cam["H"][k]).reshape(3, 3)

        def fun(x):
            Hm = correct(H0, x)
            rl, _ = cost_vec(Hm, pts, dt)
            rp = player_res(Hm, ground, feet, keep_all=True)
            return np.r_[rl * 0.6, rp * W_PLAYER, x[:6] * PRIOR, x[6:] * PRIOR * 10]

        r0p = player_res(H0, ground, feet)
        r0l, ins0 = cost_vec(H0, pts, dt)
        before_p.append(np.median(r0p) if len(r0p) else np.nan)
        before_l.append(np.mean(r0l[ins0] < 3) if ins0.any() else np.nan)
        if MEASURE:
            continue
        sol = least_squares(fun, np.zeros(8), loss="soft_l1", f_scale=4.0, max_nfev=60)
        H1 = correct(H0, sol.x)
        r1p = player_res(H1, ground, feet)
        r1l, ins1 = cost_vec(H1, pts, dt)
        after_p.append(np.median(r1p) if len(r1p) else np.nan)
        after_l.append(np.mean(r1l[ins1] < 3) if ins1.any() else np.nan)
        deltas.append(sol.x)
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(keys)}  pieds {np.nanmedian(before_p):.1f} -> {np.nanmedian(after_p):.1f} px", flush=True)

    print(f"pieds projetés -> silhouette la plus proche (médiane, px sur 640) : {np.nanmedian(before_p):.1f}")
    print(f"lignes à < 3 px : {np.nanmedian(before_l):.0%}")
    if MEASURE:
        return
    print(f"après affinage : pieds {np.nanmedian(after_p):.1f} px, lignes {np.nanmedian(after_l):.0%}")
    if TRIAL:
        return

    # correction interpolée entre images ajustées puis lissée, appliquée à toutes les frames
    ks = np.array(keys)
    dl = np.array(deltas)
    full = np.column_stack([np.interp(np.arange(n), ks, dl[:, c]) for c in range(8)])
    full = ndi.gaussian_filter1d(full, 3.0, axis=0, mode="nearest")
    out = []
    for k in range(n):
        h = cam["H"][k]
        if h is None:
            out.append(None)
            continue
        Hm = correct(np.array(h).reshape(3, 3), full[k])
        out.append([round(float(v), 7) for v in (Hm / np.linalg.norm(Hm)).ravel()])
    backup = OUT.with_suffix(".lines.json")
    if not backup.exists():
        shutil.copy(OUT, backup)
    cam["H"] = out
    cam["refined"] = {"players_px_before": round(float(np.nanmedian(before_p)), 1), "players_px_after": round(float(np.nanmedian(after_p)), 1)}
    OUT.write_text(json.dumps(cam), encoding="utf-8")
    print(f"écrit {OUT} (original : {backup.name})")


if __name__ == "__main__":
    main()

"""Vérifie le calage temporel vidéo/données sur les joueurs eux-mêmes (indépendant du mouvement de caméra).

Pour des images de l'extrait, on projette les pieds des joueurs (homographies de calibrate_camera) avec un décalage
temporel dk sur les données, et on mesure la part de pixels « non pelouse » juste au-dessus des pieds projetés :
un joueur bien placé tombe sur son maillot, un joueur décalé tombe sur l'herbe. Le dk qui maximise ce score est
l'écart temporel résiduel ; l'erreur qui reste ensuite est spatiale (calage caméra).

Usage : python scripts/check_sync.py [phase406|match] [nb_images]
"""
import json
import sys

import numpy as np

from calibrate_camera import CLIP, DATA, META, OUT, FPS, H, W, Clip, project

N_IMG = int(sys.argv[2]) if len(sys.argv) > 2 else 60
SHIFTS = range(-15, 16)  # frames de données (25 FPS) : ±0,6 s


def grass_mask(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.int16)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    return (g > r + 6) & (g > b + 10) & (g > 35)


def main() -> None:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    meta = json.loads(META.read_text(encoding="utf-8"))
    cam = json.loads(OUT.read_text(encoding="utf-8"))
    base = d["video"]["start"] - meta["clipStart"] + float(meta.get("syncOffset", 0.0))
    t0 = base - 0.8
    clip = Clip(t0)
    n = len(d["frames"])
    ks = [k for k in np.linspace(40, n - 40, N_IMG).astype(int) if cam["H"][k] is not None]
    score = {dk: [] for dk in SHIFTS}
    speeds = []
    for k in ks:
        j = max(int(round((base + k / d["fps"] - t0) * FPS)) + cam["offsetFrames"], 0)
        rgb = clip.rgb(j)
        grass = grass_mask(rgb)
        Hm = np.array(cam["H"][k]).reshape(3, 3)
        for dk in SHIFTS:
            fr = d["frames"][min(max(k + dk, 0), n - 1)]
            pts = np.array([[p["x"], p["y"]] for p in fr["p"].values()])
            uv, ok = project(Hm, pts)
            vals = []
            for (u, v), o in zip(uv, ok):
                if not o or not (0.02 < u < 0.98 and 0.08 < v < 0.98):
                    continue
                cx, fy = int(u * W), int(v * H)
                h = max(6, int(0.045 * H * v + 4))  # joueur plus grand au premier plan
                box = grass[max(0, fy - h) : fy, max(0, cx - 3) : cx + 4]
                if box.size:
                    vals.append(1.0 - box.mean())
            if vals:
                score[dk].append(np.mean(vals))
        f0, f1 = d["frames"][k], d["frames"][min(k + 5, n - 1)]
        sp = [np.hypot(f1["p"][i]["x"] - p["x"], f1["p"][i]["y"] - p["y"]) * 5 for i, p in f0["p"].items() if i in f1["p"]]
        speeds.append(np.median(sp))
    mean = {dk: float(np.mean(v)) for dk, v in score.items() if v}
    best = max(mean, key=mean.get)
    print(f"{len(ks)} images, vitesse médiane des joueurs {np.median(speeds):.1f} m/s")
    print("dk (frames) : score « maillot sous le pied »")
    for dk in SHIFTS:
        if dk % 3 == 0 or dk == best:
            print(f"  {dk:+3d} ({dk / 25:+.2f} s) : {mean[dk]:.3f}{'  <- meilleur' if dk == best else ''}")
    # incertitude : rééchantillonnage des images
    rng = np.random.default_rng(0)
    arr = np.array([score[dk] for dk in SHIFTS])
    boots = [list(SHIFTS)[int(np.argmax(arr[:, rng.integers(0, arr.shape[1], arr.shape[1])].mean(1)))] for _ in range(300)]
    lo, hi = np.percentile(boots, [5, 95])
    print(f"décalage temporel résiduel : {best / 25:+.2f} s (intervalle 90 % : {lo / 25:+.2f} à {hi / 25:+.2f} s)")
    print(f"score à dk=0 : {mean[0]:.3f} ; au meilleur : {mean[best]:.3f}")


if __name__ == "__main__":
    main()

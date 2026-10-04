"""Mesure le décalage entre l'extrait vidéo et les données, par corrélation de mouvement de caméra.

Le mouvement horizontal global de l'image (corrélation de phase entre frames) doit suivre le déplacement de
l'emprise caméra `image_corners_projection` des données. Le décalage qui maximise leur corrélation est écrit
dans public/video/phase406.json (`syncOffset`, secondes ; la vidéo se lit à clipStart + t + syncOffset).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
from clip_paths import paths

DATA, CLIP, META, _ = paths()
FPS, W, H = 25, 480, 270
LAG = 4  # frames entre deux images comparées (vitesse plus robuste qu'image à image)


def read_gray_frames(start: float, duration: float) -> np.ndarray:
    cmd = [
        "ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(CLIP),
        "-vf", f"fps={FPS},scale={W}:{H},format=gray", "-f", "rawvideo", "-",
    ]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)


def phase_shift_x(a: np.ndarray, b: np.ndarray, win: np.ndarray) -> float:
    """Décalage horizontal (px, sous-pixel) tel que b(x) ≈ a(x - dx)."""
    cross = np.fft.fft2(a * win).conj() * np.fft.fft2(b * win)
    cross /= np.abs(cross) + 1e-9
    r = np.fft.ifft2(cross).real
    iy, ix = np.unravel_index(np.argmax(r), r.shape)
    # affinage parabolique sur l'axe x
    l, c, rr = r[iy, (ix - 1) % W], r[iy, ix], r[iy, (ix + 1) % W]
    den = l - 2 * c + rr
    sub = 0.5 * (l - rr) / den if den != 0 else 0.0
    dx = ix + sub
    return dx - W if dx > W / 2 else dx


def smooth(x: np.ndarray, n: int) -> np.ndarray:
    k = np.ones(n) / n
    return np.convolve(np.pad(x, (n // 2, n - 1 - n // 2), mode="edge"), k, mode="valid")


def main() -> None:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    meta = json.loads(META.read_text(encoding="utf-8"))
    # segment de 60 s (au-delà, la lecture des images coûte des Go), à partir de argv[2] secondes dans les données
    seg = int(float(sys.argv[2]) * FPS) if len(sys.argv) > 2 else 0
    base = d["video"]["start"] - meta["clipStart"] + seg / FPS  # temps dans l'extrait de la 1re frame du segment
    n = min(len(d["frames"]) - seg, 60 * FPS)
    span = 4.0  # marge de recherche (s) de part et d'autre
    t0 = max(0.0, base - span - 1)
    frames = read_gray_frames(t0, n / FPS + 2 * span + 2)

    win = np.outer(np.hanning(H), np.hanning(W)).astype(np.float32)
    vx = np.array([phase_shift_x(frames[i], frames[i + LAG], win) for i in range(len(frames) - LAG)]) * FPS / LAG
    vx = smooth(vx, 5)
    video_t = t0 + (np.arange(len(vx)) + LAG / 2) / FPS  # instant (s, extrait) de chaque vitesse

    cx = np.array([(f["cam"][2][0] + f["cam"][3][0]) / 2 if f["cam"] else np.nan for f in d["frames"][seg : seg + n]])
    gap = np.isnan(cx)
    if gap.all():
        sys.exit("Pas d'emprise caméra sur la période : calage impossible.")
    cx[gap] = np.interp(np.flatnonzero(gap), np.flatnonzero(~gap), cx[~gap])
    pan = smooth(np.gradient(smooth(cx, 5)) * FPS, 5)  # m/s
    t = np.arange(n) / FPS

    offsets = np.arange(-span, span + 1e-9, 0.02)
    corr = np.empty_like(offsets)
    for i, off in enumerate(offsets):
        sample = np.interp(base + t + off, video_t, vx, left=np.nan, right=np.nan)
        ok = ~np.isnan(sample)
        corr[i] = np.corrcoef(pan[ok], sample[ok])[0, 1] if ok.sum() > n // 2 else np.nan

    best = int(np.nanargmax(np.abs(corr)))
    sign = "négative" if corr[best] < 0 else "positive"
    second = np.nanmax(np.abs(np.where(np.abs(offsets - offsets[best]) > 0.6, corr, np.nan)))
    print(f"décalage estimé: {offsets[best]:+.2f} s (corrélation {corr[best]:+.2f}, {sign}; meilleur pic secondaire {second:.2f})")
    print("corrélation autour du pic:", ", ".join(f"{o:+.2f}s:{c:+.2f}" for o, c in zip(offsets[::10], corr[::10])))
    if abs(corr[best]) < 0.4 or abs(corr[best]) - second < 0.1:
        sys.exit("Corrélation trop faible ou ambiguë : décalage non enregistré (utilise les boutons ±0,1 s).")
    meta["syncOffset"] = round(float(offsets[best]), 2)
    META.write_text(json.dumps(meta), encoding="utf-8")
    print(f"syncOffset={meta['syncOffset']} écrit dans {META}")


if __name__ == "__main__":
    main()

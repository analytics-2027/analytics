"""Télécharge un extrait vidéo local autour de la phase (optionnel, hors dépôt).

Lit `video` (id + temps de la phase dans la vidéo) dans public/data/phase406.json et écrit
public/video/phase406.mp4 + public/video/phase406.json ({"id", "clipStart", "duration"}).
Nécessite yt-dlp et ffmpeg. À n'utiliser que si tu as le droit d'utiliser cette vidéo.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data" / "phase406.json"
OUT = ROOT / "public" / "video"
BEFORE, AFTER = 30.0, 40.0


def main() -> None:
    d = json.loads(DATA.read_text(encoding="utf-8"))
    video = d.get("video")
    if not video:
        sys.exit("Pas de mapping vidéo dans phase406.json (voir data/match_video_info.csv).")
    phase_len = len(d["frames"]) / d["fps"]
    clip_start = max(0.0, video["start"] - BEFORE)
    clip_end = video["start"] + phase_len + AFTER
    OUT.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--js-runtimes", "node",  # résolution du défi JS de YouTube (sinon débit bridé)
        # formats HLS découpés en segments (232 = 720p, 230 = 360p, 234 = audio) : ffmpeg ne télécharge que les segments de l'extrait,
        # alors que les formats DASH (https) l'obligent à parcourir un flux de plus de 2 h à débit bridé.
        "-f", "232+234/230+234/bv*[height<=720][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=720]",
        "--download-sections", f"*{clip_start:.2f}-{clip_end:.2f}",
        "--force-keyframes-at-cuts",
        "--merge-output-format", "mp4",
        "--no-playlist", "--force-overwrites",
        "-o", str(OUT / "phase406.%(ext)s"),
        f"https://youtu.be/{video['id']}",
    ]
    subprocess.run(cmd, check=True)
    (OUT / "phase406.json").write_text(
        json.dumps({"id": video["id"], "clipStart": round(clip_start, 2), "duration": round(clip_end - clip_start, 2)}),
        encoding="utf-8",
    )
    print(f"extrait {clip_start:.1f}s -> {clip_end:.1f}s dans {OUT / 'phase406.mp4'}")


if __name__ == "__main__":
    main()

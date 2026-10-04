"""Chemins des données et de l'extrait vidéo selon le jeu de données : `phase406` (échantillon) ou `match` (extrait 5 min)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAMES = {
    "phase406": ("phase406.json", "phase406", "camera406.json"),
    "match": ("match_window.json", "match", "camera_match.json"),
}


def paths(name: str | None = None) -> tuple[Path, Path, Path, Path]:
    """(données, extrait mp4, méta de l'extrait, homographies caméra). Nom lu dans argv[1] par défaut."""
    name = name or (sys.argv[1] if len(sys.argv) > 1 else "phase406")
    if name not in NAMES:
        sys.exit(f"Jeu de données inconnu : {name} (attendu : {', '.join(NAMES)})")
    data, clip, cam = NAMES[name]
    v = ROOT / "public" / "video"
    return ROOT / "public" / "data" / data, v / f"{clip}.mp4", v / f"{clip}.json", v / cam

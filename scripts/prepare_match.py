"""Extrait de match complet (tracking + Body Pose 25 FPS) + phases de jeu SkillCorner, pour l'interface par contexte.

Le fichier Body Pose complet (data/raw/full/1925299.jsonl.zip, 623 Mo, Hugging Face SkillCorner/opendata-bodypose)
est lu en flux ; seules les frames de la fenêtre sont gardées. Les joints ne sont pas exportés (trop lourds sur
plusieurs minutes en JSON) : ils vont dans un binaire à côté (match_window.joints.bin, int16 en cm, -32768 = joint absent,
29 joints × xyz par bloc) et chaque joueur-frame qui en a porte l'indice de son bloc (`jo`).

Usage :
  python scripts/prepare_match.py                       # fenêtre par défaut : tracking 3566 -> 6566 (5 min, 8 types de phase)
  python scripts/prepare_match.py 3566 6566
"""
import csv
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import array

from prepare_pose import JOINTS, OUT, RAW, load_events, r3, video_start

ZIP = RAW / "full" / "1925299.jsonl.zip"


def load_phases(events_csv: Path, home_id: int, first_pf: int, n_frames: int) -> list[dict]:
    """Phases de jeu : étendue = des événements qui les composent, équipe = celle des possessions."""
    with events_csv.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    ph: dict[int, dict] = defaultdict(lambda: {"s": 10**9, "e": 0, "team": None, "inPoss": None, "outPoss": None})
    for r in rows:
        if not r["phase_index"] or not r["frame_start"]:
            continue
        p = ph[int(r["phase_index"])]
        p["s"] = min(p["s"], int(r["frame_start"]))
        p["e"] = max(p["e"], int(r["frame_end"] or r["frame_start"]))
        if r["event_type"] == "player_possession":
            p["team"] = "home" if int(r["team_id"]) == home_id else "away"
            p["inPoss"] = r["team_in_possession_phase_type"]
            p["outPoss"] = r["team_out_of_possession_phase_type"]
    out = []
    for i, p in sorted(ph.items(), key=lambda kv: kv[1]["s"]):
        if not p["team"]:
            continue
        s, e = round(2.5 * p["s"]) - first_pf, round(2.5 * p["e"]) - first_pf
        if e < 0 or s >= n_frames:
            continue
        out.append({"i": i, "start": max(0, s), "end": min(n_frames - 1, e), "team": p["team"], "inPoss": p["inPoss"], "outPoss": p["outPoss"]})
    return out


def main(t0: int = 3566, t1: int = 6566) -> None:
    meta = json.loads((RAW / "1925299_match.json").read_text(encoding="utf-8"))
    players_meta = {p["id"]: p for p in meta["players"]}
    home_id = meta["home_team"]["id"]
    pf0, pf1 = round(2.5 * t0), round(2.5 * t1)

    frames, period, on_pitch = [], 1, None
    seen: dict[int, int] = defaultdict(int)
    cov: dict[int, dict[str, int]] = defaultdict(lambda: {"joints": 0, "head": 0})
    blocks = array.array("h")
    NONE = -32768
    with zipfile.ZipFile(ZIP) as z:
        name = next(n for n in z.namelist() if n.endswith(".jsonl") and not n.startswith("__MACOSX"))
        with z.open(name) as raw:
            for line in io.TextIOWrapper(raw, encoding="utf-8"):
                # le numéro de frame est en tête de ligne : on évite de parser tout le JSON hors fenêtre
                head = line[:80]
                k = head.find('"frame":')
                if k >= 0:
                    num = int("".join(ch for ch in head[k + 8 : k + 20].split(",")[0] if ch.isdigit()))
                    if num < pf0:
                        continue
                    if num >= pf1:
                        break
                rec = json.loads(line)
                if not pf0 <= rec["frame"] < pf1:
                    continue
                if on_pitch is None:
                    period = rec["period"]
                    ts = rec["timestamp"][:8]
                    on_pitch = {
                        pid
                        for pid, pm in players_meta.items()
                        if pm.get("start_time") and pm["start_time"] <= ts and (pm.get("end_time") is None or ts <= pm["end_time"])
                    }
                ball = rec.get("ball_data") or {}
                c = rec.get("image_corners_projection") or {}
                fr = {
                    "f": rec["frame"],
                    # emprise absente pendant les ralentis et plans de coupe : null plutôt que des coins à None
                    "cam": [[c[f"x_{k}"], c[f"y_{k}"]] for k in ("top_left", "top_right", "bottom_right", "bottom_left")]
                    if c and all(v is not None for v in c.values())
                    else None,
                    "ball": [r3(ball["x"]), r3(ball["y"]), r3(ball.get("z") or 0.11)] if ball.get("x") is not None else None,
                    "poss": (rec.get("possession") or {}).get("player_id"),
                    "p": {},
                }
                for p in rec["player_data"]:
                    if p.get("x") is None or p["player_id"] not in on_pitch:
                        continue
                    pid = p["player_id"]
                    seen[pid] += 1
                    entry = {"x": round(p["x"], 2), "y": round(p["y"], 2), "det": bool(p.get("is_detected")), "j": None}
                    joints = p.get("joints")
                    if joints:
                        cov[pid]["joints"] += 1
                        cov[pid]["head"] += all(joints.get(k) for k in ("nose", "lEar", "rEar"))
                        entry["jo"] = len(blocks) // (len(JOINTS) * 3)
                        for k in JOINTS:
                            xyz = joints[k]["xyz"] if joints.get(k) else None
                            blocks.extend([round(c * 100) for c in xyz] if xyz else [NONE, NONE, NONE])
                    fr["p"][str(pid)] = entry
                frames.append(fr)

    if not frames:
        sys.exit("Aucune frame dans la fenêtre demandée.")
    first = frames[0]["f"]
    players = {}
    for pid, n in seen.items():
        pm = players_meta.get(pid, {})
        players[str(pid)] = {
            "n": pm.get("number"),
            "name": pm.get("short_name", str(pid)),
            "team": "home" if pm.get("team_id") == home_id else "away",
            "role": (pm.get("player_role") or {}).get("acronym"),
            "cov": {"frames": n, "detected": n, **cov[pid]},
        }
    out = {
        "match_id": meta["id"],
        "fps": 25,
        "pitch": [meta["pitch_length"], meta["pitch_width"]],
        "teams": {"home": meta["home_team"]["name"], "away": meta["away_team"]["name"]},
        "video": video_start(meta, first, period),
        "joints": JOINTS,
        "jointsBin": "match_window.joints.bin",
        "players": players,
        "events": load_events(RAW / "1925299_dynamic_events.csv", first, len(frames)),
        "phases": load_phases(RAW / "1925299_dynamic_events.csv", home_id, first, len(frames)),
        "frames": frames,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "match_window.joints.bin").write_bytes(blocks.tobytes())
    target = OUT / "match_window.json"
    target.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(frames)} frames ({len(frames) / 25 / 60:.1f} min), {len(out['phases'])} phases, {len(out['events'])} possessions -> {target} ({target.stat().st_size / 1e6:.1f} Mo)")
    print(f"poses : {len(blocks) // (len(JOINTS) * 3)} joueurs-frames -> match_window.joints.bin ({len(blocks) * 2 / 1e6:.1f} Mo)")


if __name__ == "__main__":
    main(*map(int, sys.argv[1:]))

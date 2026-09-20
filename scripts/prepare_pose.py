"""Convertit le sample Body Pose SkillCorner en JSON compact pour le viewer POV."""
import csv
import gzip
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

JOINTS = [
    "nose", "neck", "lEye", "rEye", "lEar", "rEar", "lShoulder", "rShoulder",
    "lElbow", "rElbow", "lWrist", "rWrist", "lThumb", "rThumb", "lPinky", "rPinky",
    "midHip", "lHip", "rHip", "lKnee", "rKnee", "lAnkle", "rAnkle", "lHeel", "rHeel",
    "lBigToe", "rBigToe", "lSmallToe", "rSmallToe",
]
HEAD = ["nose", "lEye", "rEye", "lEar", "rEar"]


def r3(v):
    return round(v, 3)


def fnum(s):
    try:
        return round(float(s), 4)
    except (TypeError, ValueError):
        return None


def load_events(events_csv: Path, first_pf: int, n_frames: int) -> list[dict]:
    """Possessions (avec leurs options de passe) dont la fin tombe dans la fenêtre de pose."""
    with events_csv.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    options: dict[str, list[dict]] = {}
    for r in rows:
        if r["event_type"] == "passing_option":
            options.setdefault(r["associated_player_possession_event_id"], []).append(
                {
                    "id": int(r["player_id"]),
                    "xthreat": fnum(r["xthreat"]),
                    "xpass": fnum(r["xpass_completion"]),
                    "score": fnum(r["passing_option_score"]),
                    "dangerous": r["dangerous"] == "True",
                }
            )
    events = []
    for r in rows:
        if r["event_type"] != "player_possession" or not r["frame_end"]:
            continue
        end_idx = round(2.5 * int(r["frame_end"])) - first_pf
        if not 0 <= end_idx < n_frames:
            continue
        events.append(
            {
                "id": r["event_id"],
                "passer": int(r["player_id"]),
                "start": max(0, round(2.5 * int(r["frame_start"])) - first_pf),
                "end": end_idx,
                "endType": r["end_type"],
                "target": int(r["player_targeted_id"]) if r["player_targeted_id"] else None,
                "outcome": r["pass_outcome"] or None,
                "xthreat": fnum(r["player_targeted_xthreat"]),
                "xpass": fnum(r["player_targeted_xpass_completion"]),
                "pressureStart": r["overall_pressure_start"] or None,
                "pressureEnd": r["overall_pressure_end"] or None,
                "options": options.get(r["event_id"], []),
            }
        )
    return events


def main(
    sample: str = "sample_1925299_phase406.jsonl.gz",
    match: str = "1925299_match.json",
    events: str = "1925299_dynamic_events.csv",
) -> None:
    meta = json.loads((RAW / match).read_text(encoding="utf-8"))
    players_meta = {p["id"]: p for p in meta["players"]}
    home_id = meta["home_team"]["id"]

    frames = []
    coverage: dict[int, dict[str, int]] = {}
    offsets = []
    on_pitch: set[int] | None = None
    with gzip.open(RAW / sample, "rt", encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            if on_pitch is None:
                # le tracking contient aussi les joueurs remplacés / pas encore entrés (positions extrapolées)
                ts = rec["timestamp"][:8]
                on_pitch = {
                    pid
                    for pid, pm in players_meta.items()
                    if pm.get("start_time") and pm["start_time"] <= ts and (pm.get("end_time") is None or ts <= pm["end_time"])
                }
            ball = rec.get("ball_data") or {}
            c = rec.get("image_corners_projection") or {}
            frame = {
                "f": rec["frame"],
                "cam": [[c[f"x_{k}"], c[f"y_{k}"]] for k in ("top_left", "top_right", "bottom_right", "bottom_left")] if c else None,
                "ball": [r3(ball["x"]), r3(ball["y"]), r3(ball.get("z") or 0.11)] if ball.get("x") is not None else None,
                "poss": (rec.get("possession") or {}).get("player_id"),
                "p": {},
            }
            for p in rec["player_data"]:
                if p.get("x") is None or p["player_id"] not in on_pitch:
                    continue
                pid = p["player_id"]
                cov = coverage.setdefault(pid, {"frames": 0, "detected": 0, "joints": 0, "head": 0})
                cov["frames"] += 1
                cov["detected"] += bool(p.get("is_detected"))
                joints = p.get("joints")
                entry = {"x": r3(p["x"]), "y": r3(p["y"]), "det": bool(p.get("is_detected")), "j": None}
                if joints:
                    cov["joints"] += 1
                    if all(joints.get(k) for k in ("nose", "lEar", "rEar")):
                        cov["head"] += 1
                    entry["j"] = [
                        [r3(c) for c in joints[k]["xyz"]] if joints.get(k) else None for k in JOINTS
                    ]
                    hip = joints.get("midHip")
                    if hip:
                        offsets.append(math.hypot(hip["xyz"][0] - p["x"], hip["xyz"][1] - p["y"]))
                frame["p"][str(pid)] = entry
            frames.append(frame)

    players = {}
    for pid in coverage:
        pm = players_meta.get(pid, {})
        players[str(pid)] = {
            "n": pm.get("number"),
            "name": pm.get("short_name", str(pid)),
            "team": "home" if pm.get("team_id") == home_id else "away",
            "role": (pm.get("player_role") or {}).get("acronym"),
            "cov": coverage[pid],
        }

    offsets.sort()
    out = {
        "match_id": meta["id"],
        "fps": 25,
        "pitch": [meta["pitch_length"], meta["pitch_width"]],
        "teams": {"home": meta["home_team"]["name"], "away": meta["away_team"]["name"]},
        "joints": JOINTS,
        "players": players,
        "events": load_events(RAW / events, frames[0]["f"], len(frames)),
        "frames": frames,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / "phase406.json"
    target.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    print(f"{len(frames)} frames, {len(players)} joueurs -> {target} ({target.stat().st_size / 1e6:.1f} Mo)")
    if offsets:
        print(f"ecart midHip vs tracking xy (m): median {offsets[len(offsets) // 2]:.3f}, p95 {offsets[int(len(offsets) * .95)]:.3f}, max {offsets[-1]:.3f}")
    total = sum(c["frames"] for c in coverage.values())
    print(f"player-frames avec joints: {sum(c['joints'] for c in coverage.values()) / total:.0%}, avec tete: {sum(c['head'] for c in coverage.values()) / total:.0%}")


if __name__ == "__main__":
    main(*sys.argv[1:])

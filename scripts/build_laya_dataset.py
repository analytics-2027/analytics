"""Dataset « quelle passe va-t-il jouer ? » pour Laya, tiré des Dynamic Events SkillCorner du match complet.

Chaque passe avec ses options (event_type passing_option) devient une décision typée au format Laya :
  {"state": ..., "questions": {"pass_to": {"type": "choice", ...}}, "label": {"pass_to": "C"}, ...}
Le texte reprend exactement celui de l'application (src/options.ts : carrierText / optionText), pour que
le modèle fine-tuné ici lise en direct la même chose qu'à l'entraînement.

Usage :
  python scripts/build_laya_dataset.py                 # écrit data/laya/pass_choice_{train,test}.jsonl
  python scripts/build_laya_dataset.py --eval 150      # + évalue Laya (npm run laya) contre des baselines
"""
import argparse
import csv
import json
import math
import random
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "laya"
KEYS = "ABCDEFGH"
PASS_QUESTION = "Which teammate will the ball carrier pass to?"
PRESSURE = {"no_pressure": "low", "low_pressure": "low", "": "low", "medium_pressure": "medium", "high_pressure": "high", "very_high_pressure": "high"}


def jsround(x: float) -> int:
    return math.floor(x + 0.5)


def difficulty(p: float) -> str:
    return "easy" if p >= 0.8 else "medium" if p >= 0.5 else "hard"


def dir_word(gain: float) -> str:
    return "forward" if gain > 4 else "backward" if gain < -4 else "sideways"


def option_text(role: str, dist: float, gain: float, bypassed: int, diff: str) -> str:
    g = jsround(gain)
    return (
        f"{role or 'player'}, {jsround(dist)} m pass {dir_word(gain)} ({'+' if g >= 0 else ''}{g} m), "
        f"{bypassed} opponent{'' if bypassed == 1 else 's'} bypassed, {diff} pass"
    )


def carrier_text(role: str, pressure: str) -> str:
    return f"Football match, the {role or 'player'} has the ball and must choose a pass. Pressure on the ball carrier: {pressure}."


def f(r: dict, k: str, default: float = 0.0) -> float:
    try:
        return float(r[k])
    except (KeyError, TypeError, ValueError):
        return default


def build(events_csv: Path) -> list[dict]:
    with events_csv.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    options: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["event_type"] == "passing_option":
            options[r["associated_player_possession_event_id"]].append(r)
    out = []
    for r in rows:
        if r["event_type"] != "player_possession" or r["end_type"] != "pass":
            continue
        opts = options.get(r["event_id"], [])
        target = r["targeted_passing_option_event_id"]
        if len(opts) < 2 or not any(o["event_id"] == target for o in opts):
            continue
        rng = random.Random(r["event_id"])  # ordre mélangé mais reproductible : pas de biais de position appris
        opts = opts[: len(KEYS)]
        rng.shuffle(opts)
        cx = f(r, "x_end")
        criteria, meta = {}, {}
        for k, o in zip(KEYS, opts):
            dist = f(o, "pass_distance") or f(o, "distance_to_player_in_possession_end")
            gain = f(o, "x_end") - cx  # coordonnées SkillCorner normalisées : on attaque vers les x croissants
            xp = f(o, "xpass_completion", 0.5)
            # SkillCorner compte négativement les adversaires « repassés » vers l'arrière ; l'application ne compte que ceux éliminés
            bypassed = max(0, int(f(o, "n_opponents_bypassed")))
            criteria[k] = option_text(o["player_position"], dist, gain, bypassed, difficulty(xp))
            meta[k] = {"player_id": o["player_id"], "xpass": xp, "score": f(o, "passing_option_score"), "dist": dist, "gain": gain}
        label = next(k for k, o in zip(KEYS, opts) if o["event_id"] == target)
        out.append(
            {
                "state": carrier_text(r["player_position"], PRESSURE.get(r["overall_pressure_end"], "low")),
                "questions": {"pass_to": {"type": "choice", "instructions": PASS_QUESTION, "criteria": criteria}},
                "label": {"pass_to": label},
                "meta": {"event_id": r["event_id"], "frame_end": int(r["frame_end"]), "period": int(r["period"]), "options": meta},
            }
        )
    return sorted(out, key=lambda d: (d["meta"]["period"], d["meta"]["frame_end"]))


def ask(url: str, d: dict) -> dict:
    body = json.dumps({"state": d["state"], "questions": d["questions"], "model": "english"}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["answers"]["pass_to"]["probabilities"]


def evaluate(data: list[dict], n: int, url: str) -> None:
    step = max(1, len(data) // n)
    sample = data[::step][:n]
    baselines = {
        "max xpass (SkillCorner)": lambda m: max(m, key=lambda k: m[k]["xpass"]),
        "max passing_option_score (SkillCorner)": lambda m: max(m, key=lambda k: m[k]["score"]),
        "le plus proche": lambda m: min(m, key=lambda k: m[k]["dist"]),
        "le plus vers l'avant": lambda m: max(m, key=lambda k: m[k]["gain"]),
    }
    hits = {name: 0 for name in baselines}
    rand = 0.0
    laya_hits, laya_p, laya_nll, first, ms = 0, 0.0, 0.0, 0, []
    for i, d in enumerate(sample):
        m, y = d["meta"]["options"], d["label"]["pass_to"]
        rand += 1 / len(m)
        for name, fn in baselines.items():
            hits[name] += fn(m) == y
        t0 = time.perf_counter()
        probs = ask(url, d)
        ms.append((time.perf_counter() - t0) * 1000)
        pred = max(probs, key=probs.get)
        laya_hits += pred == y
        laya_p += probs.get(y, 0.0)
        laya_nll += -math.log(max(probs.get(y, 0.0), 1e-6))
        first += pred == "A"
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(sample)}…", flush=True)
    k = len(sample)
    ms.sort()
    print(f"\n{k} décisions (sur {len(data)}), {sum(len(d['meta']['options']) for d in sample) / k:.1f} options en moyenne")
    print(f"{'hasard':42s} {rand / k:6.1%}")
    for name, h in hits.items():
        print(f"{name:42s} {h / k:6.1%}")
    print(f"{'Laya zero-shot':42s} {laya_hits / k:6.1%}   p(vraie) moyenne {laya_p / k:.3f}   NLL {laya_nll / k:.3f}")
    print(f"biais de position : Laya choisit l'option A dans {first / k:.0%} des cas")
    print(f"latence Laya : médiane {ms[k // 2]:.0f} ms, p90 {ms[int(k * 0.9)]:.0f} ms")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--events", default="1925299_dynamic_events.csv")
    ap.add_argument("--eval", type=int, default=0, help="nombre de décisions à soumettre au serveur Laya")
    ap.add_argument("--url", default="http://127.0.0.1:8765/v1/systemone")
    args = ap.parse_args()

    data = build(RAW / args.events)
    cut = int(len(data) * 0.75)  # découpage chronologique : on teste sur la fin du match
    OUT.mkdir(parents=True, exist_ok=True)
    for name, part in (("train", data[:cut]), ("test", data[cut:])):
        path = OUT / f"pass_choice_{name}.jsonl"
        path.write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in part), encoding="utf-8")
        print(f"{len(part)} décisions -> {path.relative_to(ROOT)}")
    if args.eval:
        evaluate(data[cut:], args.eval, args.url)


if __name__ == "__main__":
    main()

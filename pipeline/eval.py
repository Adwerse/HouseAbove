#!/usr/bin/env python3
"""Evaluation, per the brief: honest numbers for the slide.

    python pipeline/eval.py [--labels data/labels.csv] [--out data/export/eval.json]

Compares the AI reading, the verifier, a human screening of the same photo
(labels.csv human_label) and shop-staff answers (labels.csv or Atlas
shop_staff_answer), and writes data/export/eval.json, served by GET /api/eval:
  agreement      "X/N"  AI status equals the human's reading of the same photo.
                        A human reading the same photo is also a judgement, so this is
                        agreement, not accuracy.
  escalated      Y      buildings the pipeline sent to a human (verifier disagreed or
                        confidence < 0.6).
  shop_confirmed "Z/M"  of M shop answers with a clear reading, Z support the AI status
                        (lives upstairs <-> likely_used, empty upstairs <-> likely_underused).
                        Shop staff are the only real ground truth, and there are few of them.
The free-text shop answers are read by AGENT_MODEL once and cached in
data/cache/staff_readings.json, so the numbers do not change between runs.
"""
import argparse
import asyncio
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import llm  # noqa: E402
from app.db import get_db  # noqa: E402
from app.schemas import StaffReading  # noqa: E402
from survey_vision import load_labels  # noqa: E402

log = logging.getLogger("eval")

SYSTEM = ("A shop worker on an Irish main street was asked: \"Do you know if anyone lives upstairs, or is it empty?\" "
          "Read their answer. lives_upstairs: they say someone lives or works on the upper floors, or the floors are in use. "
          "empty_upstairs: they say the upper floors are empty or unused. unsure: they do not know, or the answer is "
          "unclear or mixed.")
CONFIRMS = {"lives_upstairs": "likely_used", "empty_upstairs": "likely_underused"}


def normalize_label(text: str | None) -> str | None:
    """A human screening label as one of the three statuses; None if it cannot be read."""
    t = (text or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not t:
        return None
    if t in ("likely_underused", "likely_used", "unclear"):
        return t
    if re.search(r"underused|empty|unused|derelict", t):
        return "likely_underused"
    if re.search(r"used|occupied|lived", t):
        return "likely_used"
    if re.search(r"unclear|unsure|unknown|\?", t):
        return "unclear"
    return None


async def read_answers(answers: list[str], cache_path: Path) -> dict[str, str]:
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    todo = sorted({a for a in answers if a not in cache})
    if todo:
        model = llm.model_from_env("AGENT_MODEL")
        results = await asyncio.gather(*(llm.structured(model, SYSTEM, f"Answer: {a}", StaffReading) for a in todo),
                                       return_exceptions=True)
        for answer, res in zip(todo, results):
            if isinstance(res, Exception) or res.value is None:
                log.warning("could not read the shop answer %r: counted as unsure", answer)
                continue  # not cached, so the next run tries again
            cache[answer] = res.value.reading
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache, indent=2, ensure_ascii=False))
    return {a: cache.get(a, "unsure") for a in answers}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--labels", type=Path, default=ROOT / "data" / "labels.csv")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "export" / "eval.json")
    ap.add_argument("--staff-cache", type=Path, default=ROOT / "data" / "cache" / "staff_readings.json")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    labels = load_labels(args.labels)
    buildings = list(get_db().buildings.find({"models.vision": {"$nin": [None, ""]}}, {"embedding": 0}))
    rows = []
    for b in sorted(buildings, key=lambda b: b["_id"]):
        row = labels.get(b["_id"].lower(), {})
        human = normalize_label(row.get("human_label"))
        if row.get("human_label") and human is None:
            log.warning("%s: cannot read human_label %r: ignored", b["_id"], row["human_label"])
        staff = row.get("shop_staff_answer") or b.get("shop_staff_answer")
        if human is None and not staff:
            continue
        rows.append({"id": b["_id"], "label": b.get("label"), "street": b.get("street"), "ai": b["upper_status"],
                     "ai_confidence": b.get("confidence"), "verifier": (b.get("verifier") or {}).get("status"),
                     "verifier_agrees": (b.get("verifier") or {}).get("agree"), "human": human,
                     "ai_matches_human": None if human is None else b["upper_status"] == human,
                     "escalated": bool(b.get("needs_human")), "shop_staff_answer": staff or None})

    readings = asyncio.run(read_answers([r["shop_staff_answer"] for r in rows if r["shop_staff_answer"]], args.staff_cache))
    for r in rows:
        r["shop_staff_reading"] = readings.get(r["shop_staff_answer"]) if r["shop_staff_answer"] else None
        clear = r["shop_staff_reading"] in CONFIRMS
        r["shop_staff_confirms_ai"] = (CONFIRMS[r["shop_staff_reading"]] == r["ai"]) if clear else None

    screened = [r for r in rows if r["human"] is not None]
    clear = [r for r in rows if r["shop_staff_confirms_ai"] is not None]
    answered = [r for r in rows if r["shop_staff_answer"]]
    result = {
        "rows": rows,
        "agreement": f"{sum(r['ai_matches_human'] for r in screened)}/{len(screened)}",
        "escalated": sum(1 for b in buildings if b.get("needs_human")),
        "shop_confirmed": f"{sum(r['shop_staff_confirms_ai'] for r in clear)}/{len(clear)}",
        "shop_answers_total": len(answered), "shop_answers_unsure": len(answered) - len(clear),
        "buildings_read_by_ai": len(buildings),
        "note": "Agreement with a human reading the same photo is not accuracy. Shop-staff answers are the only "
                "real ground truth, and there are few of them.",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"eval: agreement {result['agreement']}, escalated {result['escalated']}, shop_confirmed "
          f"{result['shop_confirmed']} ({result['shop_answers_unsure']} of {result['shop_answers_total']} answers unsure) -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

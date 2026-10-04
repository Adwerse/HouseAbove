#!/usr/bin/env python3
"""Pass 2: an independent second look, with VERIFIER_MODEL (a different model family).

    python pipeline/verify.py [--only id,id] [--force] [--web-dir data/photos_web]

Crops the top 55% of the photo (the upper floors only) and asks a different
question: list the signs for and against people living or working there, then
give a status. The verifier never sees pass 1's answer.

needs_human = the verifier disagrees with pass 1, or pass-1 confidence < 0.6.
That is an escalation trigger, not proof of accuracy: two model passes agreeing
is not ground truth.
"""
import argparse
import asyncio
import logging
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from PIL import Image  # noqa: E402

from app import domain, imaging, llm  # noqa: E402
from app.db import get_db  # noqa: E402
from app.schemas import UpperFloorsCheck  # noqa: E402
from probe_providers import family_of  # noqa: E402

log = logging.getLogger("verify")

SYSTEM = (Path(__file__).parent / "prompts" / "verify.txt").read_text(encoding="utf-8")
USER_TEXT = "List the signs for and against people living or working here, then give a status."


def crop_upper_floors(photo: Path) -> str:
    """Data URL of the top 55% of an already upright 1024 px photo."""
    with Image.open(photo) as im:
        return imaging.data_url(imaging.jpeg_bytes(imaging.top_crop(im.convert("RGB"))))


async def process(doc: dict, buildings, model: str, web_dir: Path) -> str:
    pid = doc["_id"]
    photo = web_dir / f"{pid}.jpg"
    if not photo.exists():
        log.warning("%s: %s is missing: run survey_vision.py first", pid, photo)
        return "no_photo"
    image_url = await asyncio.to_thread(crop_upper_floors, photo)
    try:
        result = await llm.structured(model, SYSTEM, USER_TEXT, UpperFloorsCheck, image_url=image_url)
    except Exception as exc:  # transport or API failure: leave it unverified, rerun later
        log.error("%s: verifier call failed: %s: %s", pid, type(exc).__name__, str(exc)[:200])
        return "failed"

    if result.value:
        check = result.value
        verifier = {**domain.review_fields(doc["upper_status"], doc.get("confidence") or 0.0, check.status),
                    "for_use": domain.clean_phrases(check.for_use),
                    "against_use": domain.clean_phrases(check.against_use),
                    "status": check.status, "model": result.model}
    else:  # no valid answer twice: it could not be checked, so a human decides
        verifier = {"agree": False, "needs_human": True, "for_use": [], "against_use": [],
                    "status": "unclear", "model": result.model}
    needs_human = verifier.pop("needs_human")
    await asyncio.to_thread(buildings.update_one, {"_id": pid},
                            {"$set": {"verifier": verifier, "models.verifier": result.model,
                                      "needs_human": needs_human}})
    log.info("%s: pass 1 %s, verifier %s -> %s%s", pid, doc["upper_status"], verifier["status"],
             "needs human" if needs_human else "ok", "" if result.value else " [output invalid twice]")
    return ("agree" if verifier["agree"] else "disagree") + ("+human" if needs_human else "")


async def run(args) -> int:
    verifier_model = llm.model_from_env("VERIFIER_MODEL")
    vision_model = llm.model_from_env("VISION_MODEL")
    if family_of(verifier_model) == family_of(vision_model):
        log.error("VISION_MODEL (%s) and VERIFIER_MODEL (%s) are both family %r: the contract needs "
                  "two different families", vision_model, verifier_model, family_of(vision_model))
        return 2

    buildings = get_db()["buildings"]
    query: dict = {"models.vision": {"$nin": [None, ""]}}
    if args.only:
        query["_id"] = {"$in": args.only.split(",")}
    docs = [d for d in buildings.find(query) if args.force or not d.get("verifier")]
    log.info("%d buildings to verify with %s (pass 1: %s), %d at a time",
             len(docs), verifier_model, vision_model, args.concurrency)

    sem = asyncio.Semaphore(args.concurrency)

    async def guarded(doc: dict) -> str:
        async with sem:
            return await process(doc, buildings, verifier_model, args.web_dir)

    outcomes = Counter(await asyncio.gather(*(guarded(d) for d in docs)))
    print("\nverify: " + ", ".join(f"{n} {k}" for k, n in sorted(outcomes.items())))
    return 1 if outcomes["failed"] else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--web-dir", type=Path, default=ROOT / "data" / "photos_web")
    ap.add_argument("--only", help="comma-separated building ids")
    ap.add_argument("--force", action="store_true", help="verify buildings that already have a verifier result")
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())

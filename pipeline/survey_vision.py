#!/usr/bin/env python3
"""Pass 1: read every facade photo with VISION_MODEL and write the result to Atlas.

    python pipeline/survey_vision.py [--photos data/photos] [--labels data/labels.csv]
                                     [--only id,id] [--force]

For each photo (JPEG or HEIC): rotate by EXIF, resize to 1024 px, write an
EXIF-stripped copy to data/photos_web/<id>.jpg (served photos carry no GPS),
read the facade with the vision model, and $set only C's fields on
buildings/<photo stem>. Coordinates come from EXIF GPS, else data/labels.csv.
shop_staff_answer is copied from labels.csv. Idempotent: photos that already
have a pass-1 result are skipped unless --force.
"""
import argparse
import asyncio
import csv
import logging
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import domain, imaging, llm  # noqa: E402
from app.db import get_db  # noqa: E402
from app.schemas import FacadeReading  # noqa: E402

log = logging.getLogger("survey")

PHOTO_EXTS = {".jpg", ".jpeg", ".heic", ".heif"}
WEB_DIR = ROOT / "data" / "photos_web"
SYSTEM = (Path(__file__).parent / "prompts" / "survey.txt").read_text(encoding="utf-8")
USER_TEXT = "Read this facade photograph."

# C's fields that later steps fill; set only when the document is first created.
DEFAULTS_ON_INSERT = {
    "footprint": None, "needs_human": False, "human_label": None, "inspection": None,
    "verifier": None, "models.verifier": None, "services": None, "rank": None,
    "registers": {"derelict": None, "protected": None},  # None = not checked
}


def load_labels(path: Path) -> dict[str, dict]:
    """photo stem (lower case) -> row. Columns: photo, source, lat, lon, street,
    human_label, shop_staff_answer, note."""
    if not path.exists():
        log.warning("%s not found: coordinates come from EXIF only", path)
        return {}
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = [{k.strip(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(f)]
    return {Path(r["photo"]).stem.lower(): r for r in rows if r.get("photo")}


def find_photos(folder: Path, only: set[str] | None) -> list[Path]:
    found: dict[str, Path] = {}
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in PHOTO_EXTS or p.name.startswith("."):
            continue
        if p.stem in found:
            log.warning("two photos share the id %s: using %s, ignoring %s", p.stem, found[p.stem].name, p.name)
            continue
        found[p.stem] = p
    return [p for stem, p in found.items() if not only or stem in only]


def _float(value: str | None) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def prepare(photo: Path, web_dir: Path) -> tuple[dict, bytes]:
    """EXIF, plus the 1024 px upright JPEG that is also written to photos_web."""
    exif = imaging.read_exif(photo)
    jpeg = imaging.jpeg_bytes(imaging.open_oriented(photo))
    web_dir.mkdir(parents=True, exist_ok=True)
    (web_dir / f"{photo.stem}.jpg").write_bytes(jpeg)
    return exif, jpeg


def unreadable_reading() -> FacadeReading:
    """Pass 1 gave no valid answer twice: mark the building unclear."""
    return FacadeReading(ground_floor="unclear", upper_floors=None, upper_status="unclear",
                         upper_signals=[], separate_entrance="unclear", confidence=0.0,
                         evidence="The model output could not be validated; this facade needs a human look.")


async def process(photo: Path, row: dict, buildings, model: str, force: bool, web_dir: Path) -> str:
    pid = photo.stem
    existing = await asyncio.to_thread(buildings.find_one, {"_id": pid}, {"models": 1, "verifier": 1})
    if existing and (existing.get("models") or {}).get("vision") and not force:
        if not (web_dir / f"{pid}.jpg").exists():
            await asyncio.to_thread(prepare, photo, web_dir)
        if row.get("shop_staff_answer"):  # answers are collected after the first read: pick up new ones
            await asyncio.to_thread(buildings.update_one, {"_id": pid},
                                    {"$set": {"shop_staff_answer": row["shop_staff_answer"]}})
        return "skipped"

    exif, jpeg = await asyncio.to_thread(prepare, photo, web_dir)

    lat, lon, geo_method = exif["lat"], exif["lon"], "exif_point"
    if lat is None:
        lat, lon, geo_method = _float(row.get("lat")), _float(row.get("lon")), "labels_point"
    street = row.get("street") or domain.derive_street(pid)
    if not row.get("street") and street:
        log.warning("%s: no street in labels.csv, derived %r from the file name", pid, street)
    taken = exif["taken_at"]
    base = {"label": domain.make_label(pid, street, row.get("note")), "photo": f"/photos/{pid}.jpg",
            "source": row.get("source") or (f"phone_{taken.date().isoformat()}" if taken else "phone")}
    if street:
        base["street"] = street
    if lat is not None and lon is not None:
        base["location"] = {"type": "Point", "coordinates": [lon, lat]}
        base["geo_method"] = geo_method
    else:
        log.warning("%s: no GPS in the photo and no lat/lon in labels.csv: it cannot be placed on the map", pid)
    if row.get("shop_staff_answer"):
        base["shop_staff_answer"] = row["shop_staff_answer"]
    await asyncio.to_thread(buildings.update_one, {"_id": pid},
                            {"$set": base, "$setOnInsert": DEFAULTS_ON_INSERT}, upsert=True)

    try:
        result = await llm.structured(model, SYSTEM, USER_TEXT, FacadeReading, image_url=imaging.data_url(jpeg))
    except Exception as exc:  # transport or API failure: leave the building unprocessed, rerun later
        log.error("%s: vision call failed: %s: %s", pid, type(exc).__name__, str(exc)[:200])
        return "failed"

    reading = domain.clean_reading(result.value) if result.value else unreadable_reading()
    update = {**reading.model_dump(), "height_m": domain.height_m(reading.upper_floors),
              "models.vision": result.model}
    if existing and existing.get("verifier"):  # --force re-run: keep needs_human consistent
        fields = domain.review_fields(reading.upper_status, reading.confidence, existing["verifier"]["status"])
        update.update({"verifier.agree": fields["agree"], "needs_human": fields["needs_human"]})
    await asyncio.to_thread(buildings.update_one, {"_id": pid}, {"$set": update})
    log.info("%s: %s (confidence %.2f)%s", pid, reading.upper_status, reading.confidence,
             "" if result.value else " [output invalid twice]")
    return reading.upper_status if result.value else "invalid"


async def run(args) -> int:
    model = llm.model_from_env("VISION_MODEL")
    buildings = get_db()["buildings"]
    labels = load_labels(args.labels)
    only = set(args.only.split(",")) if args.only else None
    photos = find_photos(args.photos, only)
    log.info("%d photos in %s, model %s, %d at a time", len(photos), args.photos, model, args.concurrency)

    sem = asyncio.Semaphore(args.concurrency)

    async def guarded(photo: Path) -> str:
        async with sem:
            return await process(photo, labels.get(photo.stem.lower(), {}), buildings, model, args.force, args.web_dir)

    outcomes = Counter(await asyncio.gather(*(guarded(p) for p in photos)))
    print("\nsurvey_vision: " + ", ".join(f"{n} {k}" for k, n in sorted(outcomes.items())))
    return 1 if outcomes["failed"] else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--photos", type=Path, default=ROOT / "data" / "photos")
    ap.add_argument("--labels", type=Path, default=ROOT / "data" / "labels.csv")
    ap.add_argument("--web-dir", type=Path, default=WEB_DIR, help="where the 1024 px stripped copies go")
    ap.add_argument("--only", help="comma-separated photo ids")
    ap.add_argument("--force", action="store_true", help="re-read photos that already have a pass-1 result")
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if not args.photos.is_dir():
        log.error("%s is not a folder", args.photos)
        return 2
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())

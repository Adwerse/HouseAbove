"""Import a phone walk: facade photos in data/photos -> buildings, walkers, walks.

Usage (from the repo root):
    python walker/import_walk.py --walker w_rodion --name "Rodion" --dry-run
    python walker/import_walk.py --walker w_rodion --name "Rodion"

--dry-run reads the photos and prints a report; it writes nothing to MongoDB.
Both modes append missing rows to data/labels.csv (existing rows are never changed).
A real run $sets only B's building fields (captured_by, captured_at, walk_id, phash),
upserts walkers and walks, then asks the API to run the badge engine.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import imagehash
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

ROOT = Path(__file__).resolve().parents[1]
PHOTOS_DIR = ROOT / "data" / "photos"
LABELS_CSV = ROOT / "data" / "labels.csv"
API_BASE = "http://localhost:8000/api"

PHOTO_EXTS = {".jpg", ".jpeg", ".heic", ".heif"}
HEIC_EXTS = {".heic", ".heif"}
SOURCE = "phone_2026-10-04"
LABEL_FIELDS = ["photo", "source", "lat", "lon", "street", "human_label", "shop_staff_answer", "note"]
UNKNOWN_STREET = "(no street in labels.csv)"

DUBLIN = ZoneInfo("Europe/Dublin")
WALK_GAP = timedelta(minutes=90)
JITTER_M = 4.0
MAX_SPEED_MS = 3.0

# EXIF tag ids
EXIF_IFD = 0x8769
GPS_IFD = 0x8825
DATETIME_ORIGINAL = 36867
OFFSET_TIME_ORIGINAL = 36881
GPS_LAT_REF, GPS_LAT, GPS_LON_REF, GPS_LON = 1, 2, 3, 4
GPS_IMG_DIRECTION = 17


@dataclass
class Capture:
    path: Path
    building_id: str  # photo stem, contract: buildings._id
    is_heic: bool
    lat: float | None = None
    lon: float | None = None
    gps_from: str = ""  # "exif" | "labels.csv"
    direction: float | None = None
    taken_at: datetime | None = None  # tz-aware UTC
    phash: str = ""
    walk_id: str = ""


# ---------- EXIF ----------

def _dms_to_deg(dms, ref) -> float | None:
    try:
        d, m, s = (float(x) for x in dms)
    except (TypeError, ValueError):
        return None
    deg = d + m / 60 + s / 3600
    if ref in ("S", "W", b"S", b"W"):
        deg = -deg
    return deg


def _parse_taken_at(exif_ifd: dict) -> datetime | None:
    raw = exif_ifd.get(DATETIME_ORIGINAL)
    if not raw:
        return None
    try:
        naive = datetime.strptime(str(raw).strip("\x00 "), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    # DateTimeOriginal has no timezone: treat it as Europe/Dublin wall time.
    return naive.replace(tzinfo=DUBLIN).astimezone(timezone.utc)


def read_capture(path: Path) -> Capture:
    cap = Capture(path=path, building_id=path.stem, is_heic=path.suffix.lower() in HEIC_EXTS)
    with Image.open(path) as img:
        exif = img.getexif()
        gps = exif.get_ifd(GPS_IFD)
        exif_ifd = exif.get_ifd(EXIF_IFD)

        if GPS_LAT in gps and GPS_LON in gps:
            lat = _dms_to_deg(gps[GPS_LAT], gps.get(GPS_LAT_REF))
            lon = _dms_to_deg(gps[GPS_LON], gps.get(GPS_LON_REF))
            if lat is not None and lon is not None and not (lat == 0 and lon == 0):
                cap.lat, cap.lon, cap.gps_from = lat, lon, "exif"
        if GPS_IMG_DIRECTION in gps:
            try:
                cap.direction = float(gps[GPS_IMG_DIRECTION])
            except (TypeError, ValueError):
                pass
        cap.taken_at = _parse_taken_at(exif_ifd)

        # pHash on the image as the viewer sees it (EXIF orientation applied).
        cap.phash = str(imagehash.phash(ImageOps.exif_transpose(img)))
    return cap


# ---------- labels.csv ----------

def load_labels() -> dict[str, dict]:
    if not LABELS_CSV.exists():
        return {}
    with LABELS_CSV.open(newline="", encoding="utf-8") as f:
        return {row["photo"]: row for row in csv.DictReader(f) if row.get("photo")}


def append_missing_labels(caps: list[Capture], labels: dict[str, dict]) -> int:
    missing = [c for c in caps if c.path.name not in labels]
    if not missing:
        return 0
    new_file = not LABELS_CSV.exists()
    LABELS_CSV.parent.mkdir(parents=True, exist_ok=True)
    with LABELS_CSV.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=LABEL_FIELDS)
        if new_file:
            w.writeheader()
        for c in missing:
            # Only values we actually know: EXIF GPS if present; the rest is left for a human.
            row = {k: "" for k in LABEL_FIELDS}
            row.update(photo=c.path.name, source=SOURCE)
            if c.gps_from == "exif":
                row.update(lat=f"{c.lat:.6f}", lon=f"{c.lon:.6f}")
            w.writerow(row)
            labels[c.path.name] = row
    return len(missing)


def _float_or_none(s: str | None) -> float | None:
    try:
        return float(s) if s not in (None, "") else None
    except ValueError:
        return None


# ---------- walks ----------

def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def split_walks(caps: list[Capture]) -> list[list[Capture]]:
    walks: list[list[Capture]] = []
    for c in sorted(caps, key=lambda c: c.taken_at):
        if walks and c.taken_at - walks[-1][-1].taken_at <= WALK_GAP:
            walks[-1].append(c)
        else:
            walks.append([c])
    return walks


def walk_path(walk: list[Capture]) -> tuple[list[list[float]], list[int], float]:
    """Path points, seconds since walk start, distance in metres.

    A point is dropped when it is under JITTER_M from the last kept point (GPS jitter)
    or when reaching it would need more than MAX_SPEED_MS (GPS jump).
    """
    start = walk[0].taken_at
    first = walk[0]
    coords = [[first.lon, first.lat]]
    times = [0]
    dist = 0.0
    last = first
    for c in walk[1:]:
        d = haversine_m(last.lat, last.lon, c.lat, c.lon)
        dt = (c.taken_at - last.taken_at).total_seconds()
        if d < JITTER_M:
            continue
        if dt <= 0 or d / dt > MAX_SPEED_MS:
            continue
        coords.append([c.lon, c.lat])
        times.append(int((c.taken_at - start).total_seconds()))
        dist += d
        last = c
    return coords, times, dist


def make_walk_id(walker_id: str, walk: list[Capture]) -> str:
    return f"{walker_id}_{walk[0].taken_at.astimezone(DUBLIN):%Y%m%d_%H%M}"


# ---------- badge preview (dry-run only; the API's engine is authoritative) ----------

def badge_preview(caps: list[Capture], labels: dict[str, dict], streets: dict[str, str],
                  distance_m: float) -> list[tuple[str, str, str]]:
    """Returns (badge_id, verdict, detail) for this import alone (no earlier walks)."""
    n = len(caps)
    per_street = Counter(streets[c.building_id] for c in caps if streets[c.building_id] != UNKNOWN_STREET)
    best_street, best_n = per_street.most_common(1)[0] if per_street else ("-", 0)
    days: set[date] = {c.taken_at.astimezone(DUBLIN).date() for c in caps}
    staff = sum(1 for c in caps if (labels.get(c.path.name, {}).get("shop_staff_answer") or "").strip())

    def row(bid, ok, detail):
        return (bid, "WOULD AWARD" if ok else "progress", detail)

    return [
        row("first_look", n >= 1, f"{n}/1 facades"),
        row("street_scout", n >= 10, f"{n}/10 facades"),
        row("main_street", best_n >= 20, f"{best_n}/20 on {best_street}"),
        row("five_k", distance_m >= 5000, f"{distance_m / 1000:.2f}/5 km (this import only)"),
        row("streak_3", len(days) >= 3, f"{len(days)}/3 days"),
        row("local_knowledge", staff >= 1, f"{staff} shop-staff answers in labels.csv"),
        ("second_look", "not checked", "needs other walkers' captures in MongoDB"),
        ("homes_above", "not here", "awarded by council inspection"),
        ("lights_on", "not here", "awarded by council inspection"),
    ]


# ---------- MongoDB + API (real run only) ----------

def write_to_db(walker_id: str, name: str, town: str,
                walks: list[list[Capture]], paths: dict[str, tuple]) -> None:
    sys.path.insert(0, str(ROOT / "backend"))
    from app.db import get_db  # C's module; imported lazily so --dry-run needs no DB

    db = get_db()
    db.walkers.update_one({"_id": walker_id}, {"$set": {"name": name, "town": town}}, upsert=True)
    for walk in walks:
        wid = walk[0].walk_id
        coords, times, dist = paths[wid]
        if len(coords) == 1:  # a LineString needs two positions
            coords, times = coords * 2, times * 2
        db.walks.update_one({"_id": wid}, {"$set": {
            "walker_id": walker_id,
            "started_at": walk[0].taken_at,
            "ended_at": walk[-1].taken_at,
            "path": {"type": "LineString", "coordinates": coords},
            "times": times,
            "distance_m": round(dist, 1),
            "building_ids": [c.building_id for c in walk],
            # Photographer position per photo (the path drops jitter points); the walker view reads it.
            "captures": [{"building_id": c.building_id, "lon": c.lon, "lat": c.lat, "t": c.taken_at}
                         for c in walk],
        }}, upsert=True)
        for c in walk:
            db.buildings.update_one({"_id": c.building_id}, {"$set": {
                "captured_by": walker_id,
                "captured_at": c.taken_at,
                "walk_id": wid,
                "phash": c.phash,
            }}, upsert=True)
    print(f"MongoDB: walker {walker_id}, {len(walks)} walks, "
          f"{sum(len(w) for w in walks)} buildings updated")


def call_evaluate(walker_id: str) -> None:
    import requests

    url = f"{API_BASE}/walkers/{walker_id}/evaluate"
    try:
        r = requests.post(url, timeout=15)
    except requests.ConnectionError:
        print(f"NOTE: API not reachable at {url}; skipped badge evaluation. Run it later.")
        return
    if r.ok:
        awards = r.json().get("awards", [])
        print(f"Badge engine: {len(awards)} new awards " + ", ".join(a.get("badge_id", "?") for a in awards))
    else:
        print(f"NOTE: {url} returned {r.status_code}: {r.text[:200]}")


# ---------- main ----------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--walker", required=True, help='walker id, e.g. "w_rodion"')
    ap.add_argument("--name", required=True)
    ap.add_argument("--town", default="Dublin")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = sorted(p for p in PHOTOS_DIR.glob("*") if p.is_file() and p.suffix.lower() in PHOTO_EXTS) \
        if PHOTOS_DIR.exists() else []
    print(f"Photos in {PHOTOS_DIR.relative_to(ROOT)}: {len(files)} "
          f"({sum(p.suffix.lower() in HEIC_EXTS for p in files)} HEIC)")
    if not files:
        print("0 photos: nothing to import.")
        return 0

    caps: list[Capture] = []
    for p in files:
        try:
            caps.append(read_capture(p))
        except Exception as e:  # one broken file must not stop the import
            print(f"WARN {p.name}: cannot read ({e}); skipped")

    labels = load_labels()
    added = append_missing_labels(caps, labels)
    if added:
        print(f"labels.csv: appended {added} rows (fill street/lat/lon by hand where empty)")

    # GPS fallback from labels.csv, then drop what still has no position or time.
    usable: list[Capture] = []
    for c in caps:
        if c.gps_from != "exif":
            row = labels.get(c.path.name, {})
            lat, lon = _float_or_none(row.get("lat")), _float_or_none(row.get("lon"))
            if lat is not None and lon is not None:
                c.lat, c.lon, c.gps_from = lat, lon, "labels.csv"
        if c.gps_from == "":
            print(f"WARN {c.path.name}: no GPS in EXIF or labels.csv; skipped")
        elif c.taken_at is None:
            print(f"WARN {c.path.name}: no DateTimeOriginal; skipped")
        else:
            usable.append(c)

    streets = {c.building_id: (labels.get(c.path.name, {}).get("street") or "").strip() or UNKNOWN_STREET
               for c in usable}
    walks = split_walks(usable)
    paths = {}
    for w in walks:
        wid = make_walk_id(args.walker, w)
        for c in w:
            c.walk_id = wid
        paths[wid] = walk_path(w)
    total_m = sum(p[2] for p in paths.values())

    # ----- report -----
    print()
    print(f"=== Walk import report: {args.walker} ({args.name}){' [DRY RUN]' if args.dry_run else ''} ===")
    print(f"Photos total:          {len(files)}")
    print(f"  HEIC:                {sum(c.is_heic for c in caps)}")
    print(f"  with EXIF GPS:       {sum(c.gps_from == 'exif' for c in caps)}")
    print(f"  GPS from labels.csv: {sum(c.gps_from == 'labels.csv' for c in caps)}")
    print(f"  with GPSImgDirection:{sum(c.direction is not None for c in caps):>2}")
    print(f"  usable (GPS + time): {len(usable)}")
    if usable:
        t0 = min(c.taken_at for c in usable).astimezone(DUBLIN)
        t1 = max(c.taken_at for c in usable).astimezone(DUBLIN)
        print(f"Time span (Dublin):    {t0:%Y-%m-%d %H:%M} -> {t1:%Y-%m-%d %H:%M}")
    print(f"Walks (gap > 90 min):  {len(walks)}")
    for w in walks:
        coords, _, dist = paths[w[0].walk_id]
        print(f"  {w[0].walk_id}: {len(w)} photos, {len(coords)} path points, {dist:.0f} m, "
              f"{w[0].taken_at.astimezone(DUBLIN):%H:%M}-{w[-1].taken_at.astimezone(DUBLIN):%H:%M}")
    print(f"Distance total:        {total_m / 1000:.2f} km")
    print("Facades per street:")
    for street, n in Counter(streets.values()).most_common():
        print(f"  {street}: {n}")
    print("Badges (preview for this import):")
    for bid, verdict, detail in badge_preview(usable, labels, streets, total_m):
        print(f"  {bid:<16}{verdict:<13}{detail}")

    if args.dry_run:
        print("\nDry run: nothing written to MongoDB, API not called.")
        return 0
    if not usable:
        print("\nNo usable photos: nothing to write.")
        return 0
    print()
    write_to_db(args.walker, args.name, args.town, walks, paths)
    call_evaluate(args.walker)
    return 0


if __name__ == "__main__":
    sys.exit(main())

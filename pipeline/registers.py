#!/usr/bin/env python3
"""Public registers: Dublin City Council's Derelict Sites Register and Record of Protected Structures.

    python pipeline/registers.py [--refresh]

Downloads both datasets from data.smartdublin.ie once (cached in data/cache/registers/)
and $sets registers.derelict / registers.protected on every building: true if a
register entry lies within 20 m of the building's location, else false. Entries are
points, and in a terrace the nearest entry can be the neighbouring house, so a flag
means "worth checking the register", not "this exact building is listed". The council's
own register is the authority. Nothing here says anything about eligibility.

Data: Dublin City Council, Creative Commons Attribution (CC BY). Attribute it in the README.
  Derelict Sites Register: GeoJSON points, only rows with is_on_current_derelict_sites_register = Yes.
  Record of Protected Structures: the published GeoJSON has wrong coordinates (about lon -11.9,
  lat 48.8, in the Atlantic), so the CSV is used instead, converted from Irish Grid
  (IG_EASTING / IG_NORTHING, EPSG:29902) to WGS84 with pyproj (about 3 m).
If a download fails the building keeps registers null = not checked, never false.
"""
import argparse
import csv
import json
import logging
import sys
from pathlib import Path

import numpy as np
import requests
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import get_db  # noqa: E402

log = logging.getLogger("registers")

DERELICT_URL = ("https://data.smartdublin.ie/dataset/83b08920-50c6-45b0-b562-8f68940cadf4/resource/"
                "7bdcf921-e0ed-4219-a4ac-2172e6b32dd9/download/dublin_city_council_derelict_sites_register_260427.geojson")
RPS_CSV_URL = ("https://data.smartdublin.ie/dataset/f1dd00f0-5914-4b97-b66e-0dbb4bcb510c/resource/"
               "f0288278-32e4-4117-803e-9ac10b83a882/download/251218-rps-master-2022-2028_for-gis.csv")
USER_AGENT = "HomesAbove-hackathon/1.0 (Build for Ireland 2026)"
NEAR_M = 20
M_PER_DEG = 111_320


def download(url: str, path: Path, refresh: bool) -> bytes | None:
    if path.exists() and not refresh:
        return path.read_bytes()
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=120)
        r.raise_for_status()
    except requests.RequestException as exc:
        log.error("download failed (%s): %s", url.rsplit("/", 1)[-1], exc)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return r.content


def derelict_points(raw: bytes) -> list[tuple[float, float, str]]:
    out = []
    for f in json.loads(raw.decode("utf-8"))["features"]:
        p = f["properties"]
        if p.get("is_on_current_derelict_sites_register") == "Yes" and f.get("geometry"):
            lon, lat = f["geometry"]["coordinates"][:2]
            out.append((lat, lon, p.get("derelict_site_reference_number") or ""))
    return out


def rps_points(raw: bytes) -> list[tuple[float, float, str]]:
    to_wgs84 = Transformer.from_crs("EPSG:29902", "EPSG:4326", always_xy=True)
    out = []
    for r in csv.DictReader(raw.decode("cp1252").splitlines()):
        try:
            lon, lat = to_wgs84.transform(float(r["IG_EASTING"]), float(r["IG_NORTHING"]))
        except (KeyError, ValueError):
            continue
        out.append((lat, lon, f"{r.get('STREET_NUMBER', '')} {r.get('Address Full', '')}".strip()))
    return out


def nearest_m(lat: float, lon: float, points: list[tuple[float, float, str]]) -> tuple[float, str]:
    """(distance in metres, name) of the nearest point; equirectangular is exact enough at city scale."""
    arr = np.array([(p[0], p[1]) for p in points])
    dy = (arr[:, 0] - lat) * M_PER_DEG
    dx = (arr[:, 1] - lon) * M_PER_DEG * np.cos(np.radians(lat))
    d = np.hypot(dx, dy)
    i = int(d.argmin())
    return float(d[i]), points[i][2]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--refresh", action="store_true", help="download the datasets again")
    ap.add_argument("--cache-dir", type=Path, default=ROOT / "data" / "cache" / "registers")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)

    raw_d = download(DERELICT_URL, args.cache_dir / "derelict.geojson", args.refresh)
    raw_p = download(RPS_CSV_URL, args.cache_dir / "rps.csv", args.refresh)
    derelict = derelict_points(raw_d) if raw_d else None
    protected = rps_points(raw_p) if raw_p else None
    log.info("derelict sites on the register: %s, protected structures: %s",
             len(derelict) if derelict is not None else "NOT LOADED", len(protected) if protected is not None else "NOT LOADED")

    db = get_db()
    flagged = {"derelict": 0, "protected": 0}
    buildings = list(db.buildings.find({"location": {"$exists": True}}, {"location": 1, "label": 1}))
    for b in buildings:
        lon, lat = b["location"]["coordinates"]
        update, notes = {}, []
        for key, points in (("derelict", derelict), ("protected", protected)):
            if points is None:
                continue  # not loaded: leave the stored value (null = not checked)
            dist, name = nearest_m(lat, lon, points)
            update[f"registers.{key}"] = dist <= NEAR_M
            if dist <= NEAR_M:
                flagged[key] += 1
                notes.append(f"{key} {dist:.0f} m ({name[:40]})")
        if update:
            db.buildings.update_one({"_id": b["_id"]}, {"$set": update})
        if notes:
            log.info("%s: %s", b["_id"], "; ".join(notes))
    print(f"registers: {len(buildings)} buildings checked; derelict within {NEAR_M} m: {flagged['derelict']}, "
          f"protected within {NEAR_M} m: {flagged['protected']}")
    return 0 if derelict is not None and protected is not None else 1


if __name__ == "__main__":
    sys.exit(main())

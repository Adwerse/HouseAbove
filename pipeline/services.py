#!/usr/bin/env python3
"""Services within walking distance (OpenStreetMap) and the ranking.

    python pipeline/services.py [--refresh] [--cache data/cache/osm.json]

1. One Overpass query (the brief's, tag filters unchanged) around the surveyed
   buildings, cached in data/cache/osm.json. The query runs only when there is
   no cache or with --refresh. Never run this against Overpass during the demo.
2. The cached elements become the `pois` collection.
3. Per building and kind: the nearest POI within 1000 m ($geoNear). One point
   each: bus stop and grocery <= 400 m; school, GP or pharmacy, park <= 800 m.
4. Rank (brief order): likely_underused, then unclear, then likely_used;
   separate entrance yes first; higher services score; higher confidence.
"""
import argparse
import json
import logging
import sys
import time
from collections import Counter
from pathlib import Path

import requests
from pymongo import UpdateOne

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import domain, repo  # noqa: E402
from app.db import get_db  # noqa: E402

log = logging.getLogger("services")

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]
USER_AGENT = "HomesAbove-hackathon/1.0 (Build for Ireland 2026)"
WALK_M = 1000  # the widest distance we look at

# The brief's query. LAT,LON is the middle of the surveyed area and the radius is
# 1000 m plus the distance to the farthest building, so every building has its
# full 1000 m covered by this one query.
QUERY = """[out:json][timeout:60];(
  nwr["highway"="bus_stop"](around:{r},{lat},{lon});
  nwr["shop"~"^(supermarket|convenience)$"](around:{r},{lat},{lon});
  nwr["amenity"="school"](around:{r},{lat},{lon});
  nwr["amenity"~"^(doctors|clinic|pharmacy)$"](around:{r},{lat},{lon});
  nwr["leisure"="park"](around:{r},{lat},{lon});
);out center tags;"""

DEFAULT_NAMES = {"bus": "Bus stop", "grocery": "Grocery", "school": "School",
                 "gp_or_pharmacy": "GP or pharmacy", "park": "Park"}


def kind_of(tags: dict) -> str | None:
    if tags.get("highway") == "bus_stop":
        return "bus"
    if tags.get("shop") in ("supermarket", "convenience"):
        return "grocery"
    if tags.get("amenity") == "school":
        return "school"
    if tags.get("amenity") in ("doctors", "clinic", "pharmacy"):
        return "gp_or_pharmacy"
    if tags.get("leisure") == "park":
        return "park"
    return None


def query_area(buildings: list[dict]) -> tuple[float, float, int]:
    """(lat, lon, radius_m): bounding-box middle, radius = 1000 m + distance to the farthest building."""
    lats = [b["location"]["coordinates"][1] for b in buildings]
    lons = [b["location"]["coordinates"][0] for b in buildings]
    lat, lon = round((min(lats) + max(lats)) / 2, 5), round((min(lons) + max(lons)) / 2, 5)
    far = max(domain.haversine_m(lat, lon, la, lo) for la, lo in zip(lats, lons))
    return lat, lon, WALK_M + int(-(-far // 50) * 50)


def fetch_overpass(lat: float, lon: float, radius: int) -> dict:
    query = QUERY.format(r=radius, lat=lat, lon=lon)
    last_error = None
    for url in OVERPASS:
        try:
            log.info("Overpass query around %s,%s r=%d m: %s", lat, lon, radius, url)
            r = requests.post(url, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=100)
            r.raise_for_status()
            return {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "query": query,
                    "center": [lat, lon], "radius_m": radius, "elements": r.json()["elements"]}
        except (requests.RequestException, ValueError, KeyError) as exc:
            last_error = exc
            log.warning("%s failed: %s", url, exc)
    raise RuntimeError(f"Overpass failed on every endpoint: {last_error}")


def uncovered(buildings: list[dict], cache: dict) -> list[str]:
    """Buildings whose full 1000 m is not inside the cached query circle."""
    lat, lon = cache["center"]
    return [b["_id"] for b in buildings
            if domain.haversine_m(lat, lon, b["location"]["coordinates"][1], b["location"]["coordinates"][0])
            + WALK_M > cache["radius_m"]]


def poi_docs(elements: list[dict]) -> list[dict]:
    docs = []
    for el in elements:
        tags = el.get("tags") or {}
        kind = kind_of(tags)
        pos = el if "lat" in el else el.get("center")
        if not kind or not pos:
            continue
        name = tags.get("name") or (f"Bus stop {tags['ref']}" if kind == "bus" and tags.get("ref") else DEFAULT_NAMES[kind])
        docs.append({"_id": f"{el['type']}/{el['id']}", "kind": kind, "name": name,
                     "location": {"type": "Point", "coordinates": [pos["lon"], pos["lat"]]}})
    return docs


def nearest_m(pois, location: dict, kind: str) -> int | None:
    hit = next(iter(pois.aggregate([
        {"$geoNear": {"near": location, "distanceField": "dist_m", "maxDistance": 1000,
                      "spherical": True, "query": {"kind": kind}}},
        {"$limit": 1}, {"$project": {"dist_m": 1}}])), None)
    return round(hit["dist_m"]) if hit else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--refresh", action="store_true", help="query Overpass again and replace the cache")
    ap.add_argument("--cache", type=Path, default=ROOT / "data" / "cache" / "osm.json")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)

    db = get_db()
    buildings = list(db.buildings.find({"location": {"$exists": True}}, {"location": 1}))
    if not buildings:
        log.error("no buildings with a location in Atlas: run survey_vision.py first")
        return 2

    if args.cache.exists() and not args.refresh:
        cache = json.loads(args.cache.read_text())
        missing = uncovered(buildings, cache)
        if missing:
            log.error("the cached OSM data (%s, fetched %s) does not cover %d buildings (%s ...): "
                      "run with --refresh", args.cache, cache["fetched_at"], len(missing), ", ".join(missing[:3]))
            return 2
        log.info("using cached OSM data from %s", cache["fetched_at"])
    else:
        cache = fetch_overpass(*query_area(buildings))
        args.cache.parent.mkdir(parents=True, exist_ok=True)
        args.cache.write_text(json.dumps(cache))

    pois = poi_docs(cache["elements"])
    db.pois.bulk_write([UpdateOne({"_id": p["_id"]}, {"$set": {k: v for k, v in p.items() if k != "_id"}}, upsert=True)
                        for p in pois])
    db.pois.delete_many({"_id": {"$nin": [p["_id"] for p in pois]}})  # pois mirror the cache exactly
    print("pois:", dict(Counter(p["kind"] for p in pois)))

    for b in buildings:
        dist = {k: nearest_m(db.pois, b["location"], k) for k in domain.SERVICE_KINDS}
        db.buildings.update_one({"_id": b["_id"]}, {"$set": {"services": {
            **{f"{k}_m": v for k, v in dist.items()}, "score": domain.services_score(dist)}}})
    ranked = repo.recompute_ranks(db)

    scores = Counter(d["services"]["score"] for d in db.buildings.find({"services": {"$ne": None}}, {"services": 1}))
    print(f"services computed for {len(buildings)} buildings, {ranked} ranked; score distribution:",
          dict(sorted(scores.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())

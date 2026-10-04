#!/usr/bin/env python3
"""Building footprints and context buildings from OpenStreetMap.

    python pipeline/geo.py [--photos data/photos] [--labels data/labels.csv] [--refresh]

For every building: take the photographer's point (photo EXIF, else labels.csv)
and, if the photo has GPSImgDirection, project 18 m forward (photos are taken from
the opposite pavement). Snap to the OSM footprint that contains that point, else
the nearest one within 20 m. No footprint, or one over 800 m2 (a merged terrace):
footprint null and the front end draws a prism at the point.
$set: footprint, location (footprint centre, else the projected point), geo_method,
height_m. Context buildings within 250 m go to data/export/context.geojson.

The photographer's point is always re-read from the photo or labels.csv, never
from the stored location, so re-running does not move buildings further.
One Overpass fetch, cached in data/cache/osm_buildings.json; never run live in the demo.
"""
import argparse
import json
import logging
import math
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import Point, Polygon, mapping
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import domain, imaging  # noqa: E402
from app.db import get_db  # noqa: E402
from survey_vision import _float, find_photos, load_labels  # noqa: E402

log = logging.getLogger("geo")

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]
USER_AGENT = "HomesAbove-hackathon/1.0 (Build for Ireland 2026)"
FORWARD_M = 18        # photographer to facade
SNAP_M = 20           # nearest footprint allowed
MAX_AREA_M2 = 800     # larger means a merged terrace: no footprint
SNAP_RADIUS_M = 300   # OSM buildings fetched around every photographer point
CONTEXT_M = 250
CLUSTER_M = 200       # photographer points this close share one Overpass clause
M_PER_DEG = 111_320

QUERY = """[out:json][timeout:90];(
{clauses}
);out geom tags;"""
CLAUSE = '  way["building"](around:{r},{lat},{lon});'


def project(lat: float, lon: float, bearing_deg: float, meters: float) -> tuple[float, float]:
    """The point `meters` ahead of (lat, lon) along a compass bearing (small distances)."""
    b = math.radians(bearing_deg)
    return (lat + meters * math.cos(b) / M_PER_DEG,
            lon + meters * math.sin(b) / (M_PER_DEG * math.cos(math.radians(lat))))


def clusters(points: list[tuple[float, float]]) -> list[tuple[float, float, int]]:
    """Group points into (lat, lon, radius_m) circles that together keep SNAP_RADIUS_M around every point."""
    groups: list[list[tuple[float, float]]] = []
    for p in points:
        for g in groups:
            if domain.haversine_m(g[0][0], g[0][1], p[0], p[1]) <= CLUSTER_M:
                g.append(p)
                break
        else:
            groups.append([p])
    return [(g[0][0], g[0][1], SNAP_RADIUS_M + math.ceil(max(domain.haversine_m(g[0][0], g[0][1], *p) for p in g) / 10) * 10)
            for g in groups]


def fetch_buildings(circles: list[tuple[float, float, int]]) -> dict:
    query = QUERY.format(clauses="\n".join(CLAUSE.format(r=r, lat=lat, lon=lon) for lat, lon, r in circles))
    last_error = None
    for url in OVERPASS:
        try:
            log.info("Overpass buildings query, %d circles: %s", len(circles), url)
            r = requests.post(url, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=150)
            r.raise_for_status()
            return {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "circles": circles,
                    "elements": r.json()["elements"]}
        except (requests.RequestException, ValueError, KeyError) as exc:
            last_error = exc
            log.warning("%s failed: %s", url, exc)
    raise RuntimeError(f"Overpass failed on every endpoint: {last_error}")


def covered(cache: dict, point: tuple[float, float]) -> bool:
    return any(domain.haversine_m(lat, lon, *point) + SNAP_RADIUS_M <= r for lat, lon, r in cache["circles"])


class Footprints:
    """OSM building polygons in a local metre grid, with lookups by point."""

    def __init__(self, elements: list[dict], lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx, self.ky = M_PER_DEG * math.cos(math.radians(lat0)), M_PER_DEG
        self.items: list[dict] = []
        for el in elements:
            geom = el.get("geometry") or []
            if el.get("type") != "way" or len(geom) < 4:
                continue
            ring = [(g["lon"], g["lat"]) for g in geom]
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            poly_m = Polygon([self.to_m(lat=la, lon=lo) for lo, la in ring])
            if not poly_m.is_valid:
                poly_m = poly_m.buffer(0)
            if poly_m.is_empty or poly_m.geom_type != "Polygon":
                continue
            self.items.append({"id": f"way/{el['id']}", "tags": el.get("tags") or {}, "ring": ring,
                               "poly": poly_m, "area": poly_m.area})
        self.tree = STRtree([i["poly"] for i in self.items])

    def to_m(self, lat: float, lon: float) -> tuple[float, float]:
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def to_ll(self, x: float, y: float) -> tuple[float, float]:
        return self.lat0 + y / self.ky, self.lon0 + x / self.kx

    def snap(self, lat: float, lon: float) -> tuple[dict | None, str]:
        """(footprint item or None, 'contains' | 'nearest' | 'none')."""
        pt = Point(self.to_m(lat, lon))
        inside = [self.items[i] for i in self.tree.query(pt, predicate="within")]
        if inside:
            return min(inside, key=lambda it: it["area"]), "contains"
        near = [(it["poly"].distance(pt), it) for it in (self.items[i] for i in self.tree.query(pt.buffer(SNAP_M)))]
        near = [(d, it) for d, it in near if d <= SNAP_M]
        if near:
            return min(near, key=lambda x: x[0])[1], "nearest"
        return None, "none"


def context_height_m(tags: dict) -> float:
    try:
        return round(float(str(tags["height"]).split(";")[0].lower().replace("m", "").strip()), 1)
    except (KeyError, ValueError):
        pass
    try:
        return round(float(str(tags["building:levels"]).split(";")[0]) * 3.2, 1)
    except (KeyError, ValueError):
        return 9.0


def source_points(buildings: list[dict], photos: dict[str, Path], labels: dict[str, dict]) -> dict[str, dict]:
    """id -> {lat, lon, direction} straight from the photo or labels.csv."""
    out = {}
    for b in buildings:
        pid = b["_id"]
        exif = imaging.read_exif(photos[pid]) if pid in photos else {"lat": None, "lon": None, "direction": None}
        lat, lon = exif["lat"], exif["lon"]
        if lat is None:
            row = labels.get(pid.lower(), {})
            lat, lon = _float(row.get("lat")), _float(row.get("lon"))
        if lat is None and b.get("geo_method") in ("exif_point", "labels_point"):  # pass 1's own, unmoved point
            lon, lat = b["location"]["coordinates"]
        if lat is None:
            log.warning("%s: no photo, labels.csv row or unmoved stored point: left as it is", pid)
            continue
        out[pid] = {"lat": lat, "lon": lon, "direction": exif["direction"]}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--photos", type=Path, default=ROOT / "data" / "photos")
    ap.add_argument("--labels", type=Path, default=ROOT / "data" / "labels.csv")
    ap.add_argument("--cache", type=Path, default=ROOT / "data" / "cache" / "osm_buildings.json")
    ap.add_argument("--context-out", type=Path, default=ROOT / "data" / "export" / "context.geojson")
    ap.add_argument("--refresh", action="store_true", help="query Overpass again and replace the cache")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)

    db = get_db()
    buildings = list(db.buildings.find({"location": {"$exists": True}}, {"location": 1, "geo_method": 1, "upper_floors": 1}))
    if not buildings:
        log.error("no buildings with a location in Atlas: run survey_vision.py first")
        return 2
    photos = {p.stem: p for p in find_photos(args.photos, None)} if args.photos.is_dir() else {}
    points = source_points(buildings, photos, load_labels(args.labels))
    if not points:
        log.error("no usable photographer points")
        return 2

    where = [(p["lat"], p["lon"]) for p in points.values()]
    if args.cache.exists() and not args.refresh:
        cache = json.loads(args.cache.read_text())
        missing = [pid for pid, p in points.items() if not covered(cache, (p["lat"], p["lon"]))]
        if missing:
            log.error("cached OSM buildings (fetched %s) do not cover %d buildings (%s ...): run with --refresh",
                      cache["fetched_at"], len(missing), ", ".join(missing[:3]))
            return 2
        log.info("using cached OSM buildings from %s", cache["fetched_at"])
    else:
        cache = fetch_buildings(clusters(where))
        args.cache.parent.mkdir(parents=True, exist_ok=True)
        args.cache.write_text(json.dumps(cache))

    lat0 = sum(w[0] for w in where) / len(where)
    lon0 = sum(w[1] for w in where) / len(where)
    fp = Footprints(cache["elements"], lat0, lon0)
    log.info("%d OSM building polygons", len(fp.items))

    used_ids, final_points, methods = set(), [], {}
    for b in buildings:
        src = points.get(b["_id"])
        if not src:  # left as it is: its stored location still keeps its footprint out of the context layer
            final_points.append(Point(fp.to_m(b["location"]["coordinates"][1], b["location"]["coordinates"][0])))
            continue
        projected = src["direction"] is not None
        lat, lon = project(src["lat"], src["lon"], src["direction"], FORWARD_M) if projected else (src["lat"], src["lon"])
        item, how = fp.snap(lat, lon)
        too_big = item is not None and item["area"] > MAX_AREA_M2
        if item is None or too_big:
            footprint, point = None, (lat, lon)
            how = "prism"
        else:
            used_ids.add(item["id"])
            footprint = {"type": "Polygon", "coordinates": [[[round(lo, 7), round(la, 7)] for lo, la in item["ring"]]]}
            c = item["poly"].representative_point()
            point = fp.to_ll(c.x, c.y)
        method = f"{'projected' if projected else 'point'}_{how}"
        methods[method] = methods.get(method, 0) + 1
        final_points.append(Point(fp.to_m(*point)))
        db.buildings.update_one({"_id": b["_id"]}, {"$set": {
            "footprint": footprint, "geo_method": method, "height_m": domain.height_m(b.get("upper_floors")),
            "location": {"type": "Point", "coordinates": [round(point[1], 7), round(point[0], 7)]}}})
        log.info("%s: %s%s", b["_id"], method, f" ({item['area']:.0f} m2, too large for a footprint)" if too_big else "")

    features = []
    for it in fp.items:
        if it["id"] in used_ids or any(it["poly"].contains(s) for s in final_points):
            continue  # the surveyed building itself, or the merged terrace its prism stands in
        if min((it["poly"].distance(s) for s in final_points), default=1e9) > CONTEXT_M:
            continue
        features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[round(lo, 6), round(la, 6)] for lo, la in it["ring"]]]},
                         "properties": {"osm_id": it["id"], "height_m": context_height_m(it["tags"])}})
    args.context_out.parent.mkdir(parents=True, exist_ok=True)
    args.context_out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"geo: {len(points)} of {len(buildings)} buildings placed {methods}; {len(features)} context buildings -> {args.context_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

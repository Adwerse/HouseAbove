#!/usr/bin/env python3
"""Generate the front end's demo dataset: three walks along real Dublin streets, the
facades captured on them, and what the two AI passes said.

    python pipeline/demo_route.py

THIS IS DEMO DATA. The geometry is real OpenStreetMap data (ODbL): building
footprints, street centrelines and the services nearby. Everything else is invented
to show the product: the walks, times, statuses, signals, evidence, shop answers,
eval rows and agent answers. Buildings are labelled by capture order ("Talbot St ·
facade 2"), never by a real house number, so no invented judgement is attached to a
real address. Facade images are drawn illustrations, not photos.

Inputs (OSM caches; see data/cache/demo/): osm_buildings.json, osm_streets.json,
osm_pois.json. Outputs:
  web/src/mocks/demo-data.json
  web/public/demo/facades/<id>.svg
"""
import json
import math
import random
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import domain  # noqa: E402
from app.gamification.engine import CATALOG  # noqa: E402
from services import poi_docs  # noqa: E402

CACHE = ROOT / "data" / "cache" / "demo"
OUT_JSON = ROOT / "web" / "src" / "mocks" / "demo-data.json"
OUT_SVG = ROOT / "web" / "public" / "demo" / "facades"

WALKER = {"id": "w_rodion", "name": "Rodion", "town": "Dublin"}
VISION, VERIFIER = "deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"
M = 111_320
LAT0, LON0 = 53.350, -6.260
KX, KY = M * math.cos(math.radians(LAT0)), M
SPEED = 1.3          # m/s, an easy walking pace
PAUSE_S = 14         # stop to frame and take each photo
PAVEMENT_M = 7       # walker's offset from the street centreline
rng = random.Random(4102026)

SIGNALS = {
    "boarded": "boarded window on the second floor",
    "no_curtains": "no curtains or blinds on any upper window",
    "dirty_glass": "grimy, unwashed glass on the upper floors",
    "vegetation": "buddleia growing from the parapet",
    "to_let": "to-let sign on the first floor",
    "broken_pane": "broken pane on the third floor",
    "peeling": "faded, peeling window frames",
}
FOR_USE = ["curtains on every upper window", "plants on the window sills", "a light on in a second-floor room",
           "blinds half drawn", "window boxes kept up", "a satellite dish in use"]

# (upper_status, confidence, verifier_status, separate_entrance, signals, shop answer)
WALKS = [
    {"id": "walk_capel_0310", "street": "Capel Street", "segments": [("Capel Street", 0.08, 0.92)],
     "walker_side": "east", "start": "2026-10-03T17:05:00Z", "ground": "open", "plan": [
         ("likely_used", .87, "likely_used", "unclear", [], None),
         ("likely_underused", .80, "likely_underused", "yes", ["boarded", "vegetation"], None),
         ("likely_used", .90, "likely_used", "unclear", [], None),
         ("likely_underused", .66, "unclear", "unclear", ["dirty_glass"], None),
         ("likely_underused", .71, "likely_underused", "unclear", ["no_curtains", "to_let"], None),
         ("unclear", .61, "unclear", "unclear", [], None),
         ("likely_used", .84, "likely_used", "yes", [], None),
         ("likely_underused", .76, "likely_underused", "unclear", ["dirty_glass", "no_curtains"], None)]},
    {"id": "walk_talbot_0410_am", "street": "Talbot Street",
     "segments": [("North Earl Street", 0.0, 1.0), ("Talbot Street", 0.0, 0.97)],
     "walker_side": "south", "start": "2026-10-04T08:12:00Z", "ground": "unclear", "plan": [
         ("likely_used", .88, "likely_used", "unclear", [], None),
         ("likely_underused", .84, "likely_underused", "yes", ["boarded", "no_curtains"], None),
         ("likely_underused", .72, "likely_used", "unclear", ["dirty_glass"], None),
         ("unclear", .64, "unclear", "unclear", [], None),
         ("likely_used", .81, "likely_used", "yes", [], None),
         ("likely_underused", .77, "likely_underused", "unclear", ["vegetation", "no_curtains"], None),
         ("likely_used", .90, "likely_used", "unclear", [], None),
         ("unclear", .48, "likely_underused", "unclear", [], None),
         ("likely_underused", .69, "likely_underused", "no", ["to_let"], None),
         ("likely_used", .83, "likely_used", "unclear", [], None),
         ("likely_underused", .63, "likely_underused", "unclear", ["broken_pane", "no_curtains"], None),
         ("likely_used", .79, "likely_used", "unclear", [], None)]},
    {"id": "walk_talbot_0410_lunch", "street": "Talbot Street", "segments": [("Talbot Street", 0.95, 0.25)],
     "walker_side": "north", "start": "2026-10-04T12:05:00Z", "ground": "open", "plan": [
         ("likely_underused", .74, "likely_underused", "yes", ["no_curtains", "peeling"],
          "Nobody's lived up there for years, it's only used for storage."),
         ("likely_used", .86, "likely_used", "unclear", [], "Yes, the owner's family has the flat upstairs."),
         ("unclear", .58, "likely_used", "unclear", [], None),
         ("likely_used", .80, "likely_used", "unclear", [], None)]},
]
CONFIRMED = "capel_02"   # inspected before the demo starts
PROTECTED = {"capel_05", "talbot_06"}
DERELICT = {"talbot_09"}


def xy(lon: float, lat: float) -> tuple[float, float]:
    return (lon - LON0) * KX, (lat - LAT0) * KY


def ll(x: float, y: float) -> tuple[float, float]:
    return LON0 + x / KX, LAT0 + y / KY


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slug(street: str) -> str:
    return street.lower().replace(" street", "").replace("north ", "n").replace(" ", "_")


def short(street: str) -> str:
    return street.replace("Street", "St")


# ---------------------------------------------------------------- streets

def centreline(ways: list[dict], name: str) -> LineString:
    """One ordered centreline per street (metres), from every OSM way that carries the name.
    Nodes are ordered along the street's main axis and averaged in 8 m buckets, which
    merges dual carriageways, footways and cycle tracks into one line."""
    pts = [xy(g["lon"], g["lat"]) for w in ways if w["tags"].get("name") == name
           and w["tags"].get("highway") not in ("proposed", "construction")
           for g in w["geometry"]]
    mx, my = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(angle), math.sin(angle)
    if (name == "Capel Street" and uy < 0) or (name != "Capel Street" and ux < 0):
        ux, uy = -ux, -uy  # Capel runs south to north, the others west to east
    buckets: dict[int, list] = {}
    for p in pts:
        t = (p[0] - mx) * ux + (p[1] - my) * uy
        buckets.setdefault(int(t // 8), []).append(p)
    line = [(sum(q[0] for q in b) / len(b), sum(q[1] for q in b) / len(b)) for _, b in sorted(buckets.items())]
    return LineString(line).simplify(1.5)


def offset_side(line: LineString, side: str) -> float:
    """+1 when `side` (a compass side) is to the left of the line's direction, else -1."""
    (x0, y0), (x1, y1) = line.coords[0], line.coords[-1]
    left = (-(y1 - y0), x1 - x0)  # left normal
    want = {"north": (0, 1), "south": (0, -1), "east": (1, 0), "west": (-1, 0)}[side]
    return 1.0 if left[0] * want[0] + left[1] * want[1] > 0 else -1.0


def segment(line: LineString, a: float, b: float) -> LineString:
    """The part of `line` from fraction a to fraction b (b < a walks it backwards)."""
    lo, hi = sorted((a, b))
    n = max(2, int(line.length * (hi - lo) / 4))
    pts = [line.interpolate(lo + (hi - lo) * i / (n - 1), normalized=True) for i in range(n)]
    pts = [(p.x, p.y) for p in pts]
    return LineString(pts if a <= b else pts[::-1])


# ---------------------------------------------------------------- buildings

def load_buildings() -> list[dict]:
    out = []
    for el in json.loads((CACHE / "osm_buildings.json").read_text())["elements"]:
        g = el.get("geometry") or []
        if el.get("type") != "way" or len(g) < 4:
            continue
        ring = [(p["lon"], p["lat"]) for p in g]
        poly = Polygon([xy(*p) for p in ring])
        if not poly.is_valid or poly.area < 45 or poly.area > 700:
            continue  # tiny sheds, broken rings and merged terraces are poor demo facades
        box = poly.minimum_rotated_rectangle
        sides = sorted(LineString(box.exterior.coords[i:i + 2]).length for i in range(2))
        if sides[1] > 30 or sides[1] > 3.2 * max(sides[0], 1):
            continue  # long bars read as blocks, not houses
        out.append({"osm": el["id"], "tags": el.get("tags") or {}, "ring": ring, "poly": poly})
    return out


def captures_along(path: LineString, side: str, buildings: list[dict], used: set, n: int) -> list[dict]:
    """Buildings on the far side of the street from the walker, ordered along the walk,
    at least 9 m apart."""
    sign = offset_side(path, side)
    far = []
    for b in buildings:
        if b["osm"] in used:
            continue
        c = b["poly"].representative_point()
        t = path.project(c)
        if t < 6 or t > path.length - 6:
            continue
        p = path.interpolate(t)
        q = path.interpolate(min(path.length, t + 1))
        dx, dy = q.x - p.x, q.y - p.y
        cross = dx * (c.y - p.y) - dy * (c.x - p.x)  # > 0: left of the walking direction
        dist = path.distance(c)
        if 5 <= dist <= 28 and (cross > 0) != (sign > 0):
            far.append((t, dist, b))
    far.sort(key=lambda x: x[0])
    picked, last = [], -1e9
    for t, dist, b in far:
        if t - last >= 9:
            picked.append((t, b))
            last = t
    if len(picked) > n:  # spread the picks evenly along the walk
        step = len(picked) / n
        picked = [picked[int(i * step)] for i in range(n)]
    return [{"t": t, **b} for t, b in picked[:n]]


# ---------------------------------------------------------------- services

def nearest_services(lon: float, lat: float, pois: list[dict]) -> tuple[dict, list[dict]]:
    best: dict[str, tuple[float, dict]] = {}
    for p in pois:
        plon, plat = p["location"]["coordinates"]
        d = domain.haversine_m(lat, lon, plat, plon)
        if d <= 1000 and (p["kind"] not in best or d < best[p["kind"]][0]):
            best[p["kind"]] = (d, p)
    dist = {k: (round(best[k][0]) if k in best else None) for k in domain.SERVICE_KINDS}
    services = {**{f"{k}_m": v for k, v in dist.items()}, "score": domain.services_score(dist)}
    near = [{"id": p["_id"], "kind": k, "name": p["name"], "lat": p["location"]["coordinates"][1],
             "lon": p["location"]["coordinates"][0], "dist_m": round(d)}
            for k, (d, p) in sorted(best.items(), key=lambda kv: kv[1][0])]
    return services, near


# ---------------------------------------------------------------- text

def evidence(status: str, signals: list[str], for_use: list[str], ground: str) -> str:
    shop = {"open": "an open shopfront", "unclear": "a shuttered shopfront", "vacant": "an unused shopfront"}[ground]
    if status == "likely_underused":
        s = [SIGNALS[k] for k in signals]
        return f"{s[0][0].upper() + s[0][1:]}{' and ' + s[1] if len(s) > 1 else ''} above {shop}."
    if status == "likely_used":
        return f"{for_use[0][0].upper() + for_use[0][1:]} and {for_use[1]} on the upper floors."
    return "Upper floors are partly hidden by a shop sign and glare; no clear signals either way."


# ---------------------------------------------------------------- facade illustrations

def facade_svg(b: dict) -> str:
    """A drawn facade (not a photo): floors, windows and the visible signals."""
    floors = b["upper_floors"] or 2
    sig = set(b["_signal_keys"])
    used = b["upper_status"] == "likely_used"
    W, floor_h, ground_h = 240, 58, 74
    H = ground_h + floors * floor_h + 26
    wall = rng.choice(["#E9E2D6", "#E4DCCF", "#D9CDBE", "#EDE7DD", "#C9B7A4", "#B79C88"])
    trim = "#F8F6F1"
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
             f'<rect width="{W}" height="{H}" fill="#F3F5EF"/>',
             f'<rect x="12" y="14" width="{W - 24}" height="{H - 14}" fill="{wall}"/>',
             f'<rect x="8" y="10" width="{W - 16}" height="8" fill="{trim}"/>']
    if "vegetation" in sig:
        parts.append('<path d="M40 14 q6 -14 12 0 q4 -10 10 0" fill="#4E8F4A"/><path d="M180 14 q5 -12 11 0" fill="#5FA35A"/>')
    for f in range(floors):
        y = 26 + f * floor_h
        for i, x in enumerate((34, 102, 170)):
            glass = "#2B3A36" if not used else "#3C4F57"
            parts.append(f'<rect x="{x}" y="{y}" width="36" height="{floor_h - 18}" rx="2" fill="{trim}"/>')
            parts.append(f'<rect x="{x + 3}" y="{y + 3}" width="30" height="{floor_h - 24}" fill="{glass}"/>')
            if used and (f + i) % 2 == 0:
                parts.append(f'<rect x="{x + 3}" y="{y + 3}" width="30" height="{(floor_h - 24) // 2}" fill="#F2D49B"/>')
            if used and (f + i) % 3 == 1:
                parts.append(f'<rect x="{x + 3}" y="{y + 3}" width="9" height="{floor_h - 24}" fill="#C46B5A"/>'
                             f'<rect x="{x + 24}" y="{y + 3}" width="9" height="{floor_h - 24}" fill="#C46B5A"/>')
            if "boarded" in sig and f == min(1, floors - 1) and i == 1:
                parts.append(f'<rect x="{x + 1}" y="{y + 1}" width="34" height="{floor_h - 20}" fill="#9C7A55"/>'
                             f'<line x1="{x + 1}" y1="{y + 12}" x2="{x + 35}" y2="{y + 12}" stroke="#7A5C3E" stroke-width="2"/>'
                             f'<line x1="{x + 1}" y1="{y + 26}" x2="{x + 35}" y2="{y + 26}" stroke="#7A5C3E" stroke-width="2"/>')
            if "broken_pane" in sig and f == floors - 1 and i == 2:
                parts.append(f'<path d="M{x + 8} {y + 6} l10 12 l-6 4 l12 10" stroke="#E8EEF0" stroke-width="1.6" fill="none"/>')
            if "dirty_glass" in sig:
                parts.append(f'<rect x="{x + 3}" y="{y + 3}" width="30" height="{floor_h - 24}" fill="#8C8270" opacity="0.35"/>')
            if used and f == 0 and i == 0 and "a satellite dish in use" in b["_for_use"]:
                parts.append(f'<circle cx="{x + 46}" cy="{y + 10}" r="6" fill="#DADFE0"/>')
        if "to_let" in sig and f == 0:
            parts.append(f'<rect x="140" y="{y + 30}" width="46" height="18" fill="#FFFFFF" stroke="#C0392B" stroke-width="2"/>'
                         f'<text x="163" y="{y + 43}" font-family="Arial" font-size="10" font-weight="700" fill="#C0392B" text-anchor="middle">TO LET</text>')
    gy = H - ground_h
    parts.append(f'<rect x="12" y="{gy}" width="{W - 24}" height="8" fill="#1C2A24"/>')
    if b["ground_floor"] == "unclear":
        parts.append(f'<rect x="22" y="{gy + 12}" width="{W - 44}" height="{ground_h - 14}" fill="#A7ACA8"/>')
        for k in range(0, ground_h - 14, 6):
            parts.append(f'<line x1="22" y1="{gy + 12 + k}" x2="{W - 22}" y2="{gy + 12 + k}" stroke="#8E948F" stroke-width="1"/>')
    else:
        parts.append(f'<rect x="22" y="{gy + 12}" width="{W - 92}" height="{ground_h - 14}" fill="#33494A"/>'
                     f'<rect x="{W - 64}" y="{gy + 12}" width="42" height="{ground_h - 14}" fill="#2A3B3C"/>'
                     f'<rect x="26" y="{gy + 16}" width="{W - 100}" height="{ground_h - 24}" fill="#F2E3B8" opacity="0.55"/>')
    if b["separate_entrance"] == "yes":
        parts.append(f'<rect x="{W - 30}" y="{gy - 2}" width="18" height="{ground_h + 2}" fill="#20594A"/>')
    parts.append("</svg>")
    return "".join(parts)


# ---------------------------------------------------------------- main

def main() -> int:
    streets_raw = json.loads((CACHE / "osm_streets.json").read_text())["elements"]
    lines = {n: centreline(streets_raw, n) for n in ("Talbot Street", "North Earl Street", "Capel Street")}
    candidates = load_buildings()
    pois = poi_docs(json.loads((CACHE / "osm_pois.json").read_text())["elements"])

    buildings, walks, used, cameras = [], [], set(), {}
    counter: dict[str, int] = {}
    for spec in WALKS:
        path = LineString([c for name, a, b in spec["segments"] for c in segment(lines[name], a, b).coords])
        picks = captures_along(path, spec["walker_side"], candidates, used, len(spec["plan"]))
        if len(picks) < len(spec["plan"]):
            print(f"{spec['id']}: only {len(picks)} facades found", file=sys.stderr)
        # the walker's own line: the street centreline moved onto the pavement
        sign = offset_side(path, spec["walker_side"])
        walk_line = path.parallel_offset(PAVEMENT_M, "left" if sign > 0 else "right", join_style=2)
        if walk_line.geom_type != "LineString":
            walk_line = max(walk_line.geoms, key=lambda g: g.length)
        if Point(walk_line.coords[0]).distance(Point(path.coords[0])) > Point(walk_line.coords[-1]).distance(Point(path.coords[0])):
            walk_line = LineString(list(walk_line.coords)[::-1])
        dense = segment(walk_line, 0, 1)

        start = datetime.fromisoformat(spec["start"].replace("Z", "+00:00"))
        stops = sorted(dense.project(Point(path.interpolate(p["t"]).x, path.interpolate(p["t"]).y)) for p in picks)
        coords, times, captures, building_ids = [], [], [], []
        for x, y in dense.coords:
            d = dense.project(Point(x, y))
            pauses = sum(1 for s in stops if s < d)
            coords.append([round(v, 7) for v in ll(x, y)])
            times.append(iso(start + timedelta(seconds=d / SPEED + pauses * PAUSE_S)))

        seg_lines = [(name, segment(lines[name], a, b)) for name, a, b in spec["segments"]]
        for (status, conf, vstatus, entrance, sig, staff), pick in zip(spec["plan"], picks):
            street = min(seg_lines, key=lambda nl: nl[1].distance(pick["poly"].representative_point()))[0]
            s = slug(street)
            counter[s] = counter.get(s, 0) + 1
            bid = f"{s}_{counter[s]:02d}"
            used.add(pick["osm"])
            stop = dense.project(Point(path.interpolate(pick["t"]).x, path.interpolate(pick["t"]).y))
            pauses = sum(1 for st in stops if st < stop)
            at = start + timedelta(seconds=stop / SPEED + pauses * PAUSE_S + PAUSE_S / 2)
            px, py = dense.interpolate(stop).coords[0]
            rep = pick["poly"].representative_point()
            lon, lat = ll(rep.x, rep.y)
            levels = pick["tags"].get("building:levels")
            try:
                upper = max(1, min(5, int(float(levels)) - 1)) if levels else rng.choice([2, 3, 3, 4])
            except ValueError:
                upper = 3
            for_use = rng.sample(FOR_USE, 2) if status != "likely_underused" else []
            review = domain.review_fields(status, conf, vstatus)
            ground = spec["ground"] if not (spec["ground"] == "open" and rng.random() < 0.15) else "unclear"
            services, near = nearest_services(lon, lat, pois)
            b = {
                "id": bid, "label": f"{short(street)} · facade {counter[s]}", "street": street,
                "location": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                "footprint": {"type": "Polygon", "coordinates": [[[round(a, 7), round(c, 7)] for a, c in pick["ring"]]]},
                "geo_method": "demo_osm_footprint", "photo": f"/demo/facades/{bid}.svg", "source": "demo",
                "ground_floor": ground, "upper_floors": upper, "upper_status": status,
                "upper_signals": [SIGNALS[k] for k in sig], "separate_entrance": entrance, "confidence": conf,
                "evidence": evidence(status, sig, for_use, ground),
                "verifier": {"agree": review["agree"],
                             "for_use": for_use if vstatus != "likely_underused" else [],
                             "against_use": [SIGNALS[k] for k in sig] if vstatus != "likely_used" else [],
                             "status": vstatus, "model": VERIFIER},
                "needs_human": review["needs_human"], "services": services,
                "registers": {"derelict": bid in DERELICT, "protected": bid in PROTECTED},
                "rank": None, "height_m": domain.height_m(upper), "models": {"vision": VISION, "verifier": VERIFIER},
                "human_label": None, "shop_staff_answer": staff, "inspection": None,
                "captured_by": WALKER["id"], "captured_at": iso(at), "walk_id": spec["id"], "phash": None,
                "_signal_keys": sig, "_for_use": for_use, "_pois": near,
            }
            if status == "likely_used" and not b["verifier"]["for_use"]:
                b["verifier"]["for_use"] = for_use
            if bid == CONFIRMED:
                b["inspection"] = {"outcome": "confirmed_candidate", "note": "Site visit with the owner; two floors empty.",
                                   "at": "2026-10-04T10:30:00Z"}
            buildings.append(b)
            building_ids.append(bid)
            plon, plat = ll(px, py)
            captures.append({"building_id": bid, "lon": round(plon, 7), "lat": round(plat, 7), "t": iso(at),
                             "thumb": b["photo"]})

        walks.append({"id": spec["id"], "walker_id": WALKER["id"], "started_at": times[0], "ended_at": times[-1],
                      "path": {"type": "LineString", "coordinates": coords}, "times": times,
                      "distance_m": round(dense.length), "building_ids": building_ids, "captures": captures})

        mid = path.interpolate(0.5, normalized=True)
        (x0, y0), (x1, y1) = path.coords[0], path.coords[-1]
        axis = math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360          # compass bearing of the walk
        look = (axis + (90 if offset_side(path, spec["walker_side"]) > 0 else -90)) % 360  # towards the captured side
        clon, clat = ll(mid.x, mid.y)
        cameras.setdefault(spec["street"], {"center": [round(clon, 6), round(clat, 6)], "zoom": 17.1, "pitch": 62,
                                            "bearing": round((look + 32) % 360, 1)})

    for b in buildings:
        b["display_status"] = domain.display_status(b)
    by_rank = sorted((dict(b, _id=b["id"]) for b in buildings), key=domain.rank_key)
    for n, b in enumerate(by_rank, start=1):
        next(x for x in buildings if x["id"] == b["id"])["rank"] = n

    # similar facades: overlap of signals plus the same reading
    def words(b):
        return set(re.findall(r"[a-z]+", " ".join(b["upper_signals"] + b["verifier"]["for_use"]).lower())) | {b["upper_status"]}
    similar = {}
    for b in buildings:
        scored = []
        for o in buildings:
            if o is b:
                continue
            a, c = words(b), words(o)
            scored.append((0.74 + 0.22 * len(a & c) / max(1, len(a | c)), o))
        scored.sort(key=lambda x: -x[0])
        similar[b["id"]] = [{"id": o["id"], "label": o["label"], "score": round(s, 3),
                             "display_status": o["display_status"], "photo": o["photo"]} for s, o in scored[:5]]

    # badges, as B's engine would award them
    caps = sorted(buildings, key=lambda b: b["captured_at"])
    distance = sum(w["distance_m"] for w in walks)
    minutes = round(sum((datetime.fromisoformat(w["ended_at"].replace("Z", "+00:00")) -
                         datetime.fromisoformat(w["started_at"].replace("Z", "+00:00"))).total_seconds() for w in walks) / 60)
    per_street: dict[str, int] = {}
    for b in caps:
        per_street[b["street"]] = per_street.get(b["street"], 0) + 1
    days = {b["captured_at"][:10] for b in caps}
    staff = [b for b in caps if b["shop_staff_answer"]]
    stats = {"distance_m": distance, "minutes": minutes, "facades": len(caps), "streets": len(per_street),
             "floors_scanned": sum(b["upper_floors"] for b in caps), "streak_days": len(days)}
    current = {"first_look": len(caps), "street_scout": len(caps), "main_street": max(per_street.values()),
               "five_k": distance, "streak_3": len(days), "local_knowledge": len(staff), "second_look": 0,
               "homes_above": 1, "lights_on": 0}
    awards = []
    for badge in CATALOG:
        bid_ = badge["id"]
        if current[bid_] >= badge["target"] and bid_ not in ("homes_above", "lights_on"):
            when = {"first_look": caps[0]["captured_at"], "street_scout": caps[9]["captured_at"],
                    "local_knowledge": staff[0]["captured_at"] if staff else caps[-1]["captured_at"]}.get(bid_, caps[-1]["captured_at"])
            awards.append({"id": f"award_{bid_}", "walker_id": WALKER["id"], "badge_id": bid_, "building_id": None,
                           "at": when, "reason": badge["description"], "title": badge["title"]})
    awards.append({"id": f"award_homes_above_{CONFIRMED}", "walker_id": WALKER["id"], "badge_id": "homes_above",
                   "building_id": CONFIRMED, "at": "2026-10-04T10:30:00Z",
                   "reason": "A facade you captured was confirmed by a council inspection.", "title": "Homes Above"})
    progress = [{"badge_id": b["id"], "current": min(current[b["id"]], b["target"]), "target": b["target"]} for b in CATALOG]

    # eval (demo numbers)
    rows, mismatch = [], {"talbot_03", "capel_06"}
    for b in sorted(buildings, key=lambda b: b["rank"])[:15]:
        human = b["upper_status"] if b["id"] not in mismatch else (
            "likely_used" if b["upper_status"] != "likely_used" else "unclear")
        reading = None
        if b["shop_staff_answer"]:
            reading = "empty_upstairs" if "Nobody" in b["shop_staff_answer"] else "lives_upstairs"
        confirms = None if reading is None else ({"empty_upstairs": "likely_underused", "lives_upstairs": "likely_used"}[reading] == b["upper_status"])
        rows.append({"id": b["id"], "label": b["label"], "street": b["street"], "ai": b["upper_status"],
                     "ai_confidence": b["confidence"], "verifier": b["verifier"]["status"],
                     "verifier_agrees": b["verifier"]["agree"], "human": human,
                     "ai_matches_human": human == b["upper_status"], "escalated": b["needs_human"],
                     "shop_staff_answer": b["shop_staff_answer"], "shop_staff_reading": reading,
                     "shop_staff_confirms_ai": confirms})
    for b in buildings:
        if b["shop_staff_answer"] and b["id"] not in {r["id"] for r in rows}:
            reading = "empty_upstairs" if "Nobody" in b["shop_staff_answer"] else "lives_upstairs"
            rows.append({"id": b["id"], "label": b["label"], "street": b["street"], "ai": b["upper_status"],
                         "ai_confidence": b["confidence"], "verifier": b["verifier"]["status"],
                         "verifier_agrees": b["verifier"]["agree"], "human": None, "ai_matches_human": None,
                         "escalated": b["needs_human"], "shop_staff_answer": b["shop_staff_answer"],
                         "shop_staff_reading": reading,
                         "shop_staff_confirms_ai": {"empty_upstairs": "likely_underused", "lives_upstairs": "likely_used"}[reading] == b["upper_status"]})
    screened = [r for r in rows if r["human"]]
    clear = [r for r in rows if r["shop_staff_confirms_ai"] is not None]
    eval_ = {"rows": rows, "agreement": f"{sum(r['ai_matches_human'] for r in screened)}/{len(screened)}",
             "escalated": sum(b["needs_human"] for b in buildings),
             "shop_confirmed": f"{sum(r['shop_staff_confirms_ai'] for r in clear)}/{len(clear)}",
             "shop_answers_total": len(clear), "shop_answers_unsure": 0, "buildings_read_by_ai": len(buildings),
             "note": "Demo data, generated to show the evaluation view; these numbers were not measured.",
             "generated_at": iso(datetime.now(timezone.utc))}

    for b in buildings:  # write illustrations, then drop the private helper keys
        OUT_SVG.mkdir(parents=True, exist_ok=True)
        (OUT_SVG / f"{b['id']}.svg").write_text(facade_svg(b), encoding="utf-8")
    services = {b["id"]: {"services": b["services"], "pois": b.pop("_pois")} for b in buildings}
    for b in buildings:
        b.pop("_signal_keys"), b.pop("_for_use")

    out = {"note": "DEMO DATA. Real OpenStreetMap geometry (ODbL); walks, readings, statuses and answers are invented.",
           "walker": WALKER, "cameras": cameras, "buildings": sorted(buildings, key=lambda b: b["rank"]),
           "services": services, "similar": similar, "walks": walks, "stats": stats, "awards": awards,
           "progress": progress, "badges": CATALOG, "eval": eval_}
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {}
    for b in buildings:
        counts[b["display_status"]] = counts.get(b["display_status"], 0) + 1
    print(f"demo: {len(buildings)} facades on {len(per_street)} streets {counts}; {len(walks)} walks, "
          f"{distance} m, {minutes} min; {len(awards)} awards -> {OUT_JSON.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

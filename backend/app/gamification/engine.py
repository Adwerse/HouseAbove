"""Badge engine (CONTRACT: "Badge engine interface"). B implements, C's routes call.

    evaluate_walker(db, walker_id) -> new awards (idempotent)
    on_inspection(db, building_id, outcome) -> new awards (homes_above / lights_on)
    stats(db, walker_id) -> {distance_m, minutes, facades, streets, floors_scanned, streak_days}

Badges reward walking and coverage, never what the AI thinks of a building: the
engine reads only B's capture fields, the street, upper_floors and shop_staff_answer.

Awards: {_id, walker_id, badge_id, building_id|null, at, reason}. The unique index
(walker_id, badge_id, building_id) is created here on first use; _id is the same
triple as a string, so a duplicate insert fails even before the index exists.
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError, OperationFailure

from app.domain import haversine_m, street_key

log = logging.getLogger("gamification")

DUBLIN = ZoneInfo("Europe/Dublin")
SECOND_LOOK_MAX_HAMMING = 8
SECOND_LOOK_MAX_M = 30.0

# icon = lucide icon name; target/unit drive the progress bars.
CATALOG: list[dict] = [
    {"id": "first_look", "title": "First Look", "description": "Captured your first facade.",
     "tier": "bronze", "icon": "camera", "target": 1, "unit": "facades"},
    {"id": "street_scout", "title": "Street Scout", "description": "Captured 10 facades.",
     "tier": "silver", "icon": "footprints", "target": 10, "unit": "facades"},
    {"id": "main_street", "title": "Main Street", "description": "Captured 20 facades on one street.",
     "tier": "gold", "icon": "store", "target": 20, "unit": "facades"},
    {"id": "five_k", "title": "5K for Homes", "description": "Walked 5 km while capturing, in total.",
     "tier": "gold", "icon": "route", "target": 5000, "unit": "m"},
    {"id": "streak_3", "title": "Three-Day Streak", "description": "Captured facades on 3 different days.",
     "tier": "silver", "icon": "flame", "target": 3, "unit": "days"},
    {"id": "local_knowledge", "title": "Local Knowledge", "description": "Logged an answer from shop staff.",
     "tier": "bronze", "icon": "message-circle", "target": 1, "unit": "answers"},
    {"id": "second_look", "title": "Second Look",
     "description": "Re-captured a facade another walker captured first.",
     "tier": "silver", "icon": "repeat", "target": 1, "unit": "facades"},
    {"id": "homes_above", "title": "Homes Above",
     "description": "A facade you captured was confirmed by a council inspection.",
     "tier": "civic", "icon": "house", "target": 1, "unit": "buildings"},
    {"id": "lights_on", "title": "Lights On",
     "description": "A building you captured returned to use as homes.",
     "tier": "civic", "icon": "lightbulb", "target": 1, "unit": "buildings"},
]
BADGES = {b["id"]: b for b in CATALOG}
# One award per building for these; every other badge is awarded once per walker.
PER_BUILDING = {"homes_above", "lights_on"}
STAT_KEYS = ("distance_m", "minutes", "facades", "streets", "floors_scanned", "streak_days")
INSPECTION_BADGES = {"confirmed_candidate": "homes_above", "returned_to_use": "lights_on"}

_CAPTURE_FIELDS = {"captured_by": 1, "captured_at": 1, "walk_id": 1, "phash": 1, "street": 1,
                   "location": 1, "upper_floors": 1, "shop_staff_answer": 1}
_indexed: list[tuple] = []  # (client, db name) pairs that already have the awards index


def title(badge_id: str) -> str:
    return BADGES.get(badge_id, {}).get("title") or badge_id.replace("_", " ").title()


# ---------- helpers ----------

def _utc(dt: datetime | None) -> datetime | None:
    """pymongo returns naive UTC datetimes; make them aware."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _ensure_indexes(db) -> None:
    if any(client is db.client and name == db.name for client, name in _indexed):
        return
    try:
        db.awards.create_index([("walker_id", 1), ("badge_id", 1), ("building_id", 1)],
                               unique=True, name="walker_badge_building")
    except OperationFailure as e:  # e.g. same keys under another name: uniqueness still holds via _id
        log.warning("awards index not created: %s", e)
    _indexed.append((db.client, db.name))


def hamming(a: str | None, b: str | None) -> int | None:
    """Bits that differ between two imagehash hex strings; None when either is missing or broken."""
    if not a or not b or len(a) != len(b):
        return None
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return None


def _street(b: dict) -> str:
    # Stored street only: deriving it from the id turns "IMG_8528" into "Img Street".
    return street_key(b.get("street") or "")


def _photographer_positions(db, walker_id: str | None = None) -> dict[str, tuple[float, float]]:
    """building_id -> (lon, lat) where the photo was taken, from walks.captures."""
    query = {"walker_id": walker_id} if walker_id else {}
    out = {}
    for w in db.walks.find(query, {"captures": 1}):
        for c in w.get("captures") or []:
            if c.get("lon") is not None and c.get("lat") is not None:
                out[c["building_id"]] = (float(c["lon"]), float(c["lat"]))
    return out


def position(b: dict, positions: dict[str, tuple[float, float]]) -> tuple[float, float] | None:
    """Photographer position if the walk recorded it, else the building's location."""
    if b["_id"] in positions:
        return positions[b["_id"]]
    coords = (b.get("location") or {}).get("coordinates")
    return (float(coords[0]), float(coords[1])) if coords and len(coords) == 2 else None


def _captures(db, walker_id: str) -> list[dict]:
    """The walker's captured buildings, oldest first. One document per building_id,
    so a facade counts once per walker."""
    docs = list(db.buildings.find({"captured_by": walker_id}, _CAPTURE_FIELDS))
    far_future = datetime.max.replace(tzinfo=timezone.utc)
    return sorted(docs, key=lambda b: (_utc(b.get("captured_at")) or far_future, b["_id"]))


def _facts(db, walker_id: str) -> dict:
    caps = _captures(db, walker_id)
    walks = list(db.walks.find({"walker_id": walker_id}, {"distance_m": 1, "started_at": 1, "ended_at": 1}))
    seconds = sum((_utc(w["ended_at"]) - _utc(w["started_at"])).total_seconds()
                  for w in walks if w.get("started_at") and w.get("ended_at"))
    per_street = Counter(s for s in (_street(b) for b in caps) if s)
    days = {_utc(b["captured_at"]).astimezone(DUBLIN).date() for b in caps if b.get("captured_at")}
    return {
        "captures": caps,
        "distance_m": round(sum(float(w.get("distance_m") or 0) for w in walks)),
        "minutes": round(seconds / 60),
        "facades": len(caps),
        "streets": len(per_street),
        "best_street": max(per_street.values(), default=0),
        "floors_scanned": sum(int(b.get("upper_floors") or 0) for b in caps),
        "streak_days": len(days),
        "staff_answers": [b for b in caps if str(b.get("shop_staff_answer") or "").strip()],
    }


def _second_look(db, walker_id: str, caps: list[dict]) -> tuple[dict, dict] | None:
    """(my capture, earlier capture by someone else) for the first match, else None.

    Match: pHash Hamming distance <= 8, positions within 30 m, the other capture earlier."""
    others = [o for o in db.buildings.find({"captured_by": {"$nin": [walker_id, None]},
                                            "phash": {"$exists": True}}, _CAPTURE_FIELDS)
              if o.get("captured_at")]
    if not others:
        return None
    positions = _photographer_positions(db)
    for mine in caps:
        mine_at, mine_pos = _utc(mine.get("captured_at")), position(mine, positions)
        if mine_at is None or mine_pos is None:
            continue
        for o in sorted(others, key=lambda o: (_utc(o["captured_at"]), o["_id"])):
            if _utc(o["captured_at"]) >= mine_at:
                break
            d = hamming(mine.get("phash"), o.get("phash"))
            o_pos = position(o, positions)
            if d is None or d > SECOND_LOOK_MAX_HAMMING or o_pos is None:
                continue
            if haversine_m(mine_pos[1], mine_pos[0], o_pos[1], o_pos[0]) <= SECOND_LOOK_MAX_M:
                return mine, o
    return None


def _grant(db, walker_id: str, badge_id: str, building_id: str | None, reason: str) -> dict | None:
    """Insert one award; None if it already exists."""
    if badge_id not in PER_BUILDING and db.awards.find_one({"walker_id": walker_id, "badge_id": badge_id}):
        return None
    award = {"_id": f"{walker_id}:{badge_id}:{building_id or '-'}", "walker_id": walker_id,
             "badge_id": badge_id, "building_id": building_id,
             "at": datetime.now(timezone.utc), "reason": reason}
    try:
        db.awards.insert_one(award)
    except DuplicateKeyError:
        return None
    return award


# ---------- contract interface ----------

def stats(db, walker_id: str) -> dict:
    f = _facts(db, walker_id)
    return {k: f[k] for k in STAT_KEYS}


def evaluate_walker(db, walker_id: str) -> list[dict]:
    """Idempotent; returns only the new awards. homes_above and lights_on are not
    checked here: they come only from on_inspection."""
    _ensure_indexes(db)
    f = _facts(db, walker_id)
    caps = f["captures"]
    candidates: list[tuple[str, str | None, str]] = []
    if f["facades"] >= 1:
        candidates.append(("first_look", None, "first facade captured"))
    if f["facades"] >= 10:
        candidates.append(("street_scout", None, f"{f['facades']} facades captured"))
    if f["best_street"] >= 20:
        candidates.append(("main_street", None, f"{f['best_street']} facades on one street"))
    if f["distance_m"] >= 5000:
        candidates.append(("five_k", None, f"{f['distance_m'] / 1000:.1f} km walked while capturing"))
    if f["streak_days"] >= 3:
        candidates.append(("streak_3", None, f"captures on {f['streak_days']} different days"))
    if f["staff_answers"]:
        candidates.append(("local_knowledge", f["staff_answers"][0]["_id"], "logged a shop-staff answer"))
    if caps and not db.awards.find_one({"walker_id": walker_id, "badge_id": "second_look"}):
        match = _second_look(db, walker_id, caps)
        if match:
            candidates.append(("second_look", match[0]["_id"],
                               "re-captured a facade first captured by another walker"))

    new = []
    for badge_id, building_id, reason in candidates:
        award = _grant(db, walker_id, badge_id, building_id, reason)
        if award:
            new.append(award)
    return new


def on_inspection(db, building_id: str, outcome: str) -> list[dict]:
    """homes_above for confirmed_candidate, lights_on for returned_to_use, to captured_by."""
    badge_id = INSPECTION_BADGES.get(outcome)
    if not badge_id:
        return []
    building = db.buildings.find_one({"_id": building_id}, {"captured_by": 1})
    walker_id = (building or {}).get("captured_by")
    if not walker_id:
        return []
    _ensure_indexes(db)
    award = _grant(db, walker_id, badge_id, building_id, f"council inspection: {outcome}")
    return [award] if award else []


# ---------- read model for the walker routes ----------

def progress(db, walker_id: str, facts: dict | None = None, awards: list[dict] | None = None) -> list[dict]:
    """[{badge_id, current, target}] for every badge in the catalog; current is capped at target."""
    f = facts or _facts(db, walker_id)
    if awards is None:
        awards = list(db.awards.find({"walker_id": walker_id}))
    earned = Counter(a["badge_id"] for a in awards)
    current = {
        "first_look": f["facades"],
        "street_scout": f["facades"],
        "main_street": f["best_street"],
        "five_k": f["distance_m"],
        "streak_3": f["streak_days"],
        "local_knowledge": len(f["staff_answers"]),
        "second_look": earned["second_look"],
        "homes_above": earned["homes_above"],
        "lights_on": earned["lights_on"],
    }
    return [{"badge_id": b["id"], "current": min(current[b["id"]], b["target"]), "target": b["target"]}
            for b in CATALOG]


def profile(db, walker_id: str) -> dict:
    """{stats, awards, progress} for GET /walkers/{id}; awards oldest first, each with its title."""
    f = _facts(db, walker_id)
    awards = sorted(db.awards.find({"walker_id": walker_id}), key=lambda a: (_utc(a.get("at")), a["_id"]))
    return {
        "stats": {k: f[k] for k in STAT_KEYS},
        "awards": [{**a, "title": title(a["badge_id"])} for a in awards],
        "progress": progress(db, walker_id, f, awards),
    }

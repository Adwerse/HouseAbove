"""Every read and write of Atlas for the API (and, in C3, MCP) goes through here.

Functions return plain JSON-friendly dicts (embedding removed, id and
display_status added). They never publish events: the API routes do.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from bson import ObjectId
from fastapi.encoders import jsonable_encoder
from pymongo import UpdateOne
from pymongo.database import Database

from app import domain
from app.db import get_db

# C's contract fields. A building the pipeline has not finished yet still comes
# back with every key, so the front end never meets a missing one.
CONTRACT_DEFAULTS = {
    "label": None, "street": None, "location": None, "footprint": None, "geo_method": None,
    "photo": None, "source": None, "ground_floor": None, "upper_floors": None, "upper_status": None,
    "upper_signals": [], "separate_entrance": None, "confidence": None, "evidence": None,
    "verifier": None, "needs_human": False, "services": None,
    "registers": {"derelict": None, "protected": None}, "rank": None, "height_m": None,
    "models": {"vision": None, "verifier": None}, "human_label": None, "shop_staff_answer": None,
    "inspection": None,
}
HUMAN_LABELS = ("likely_underused", "likely_used", "unclear")
INSPECTION_OUTCOMES = ("confirmed_candidate", "not_suitable", "returned_to_use")


def _utc_iso(d: datetime) -> str:
    """pymongo hands back naive datetimes that are UTC: say so, or browsers read them as local time."""
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()


def to_json(obj):
    return jsonable_encoder(obj, custom_encoder={datetime: _utc_iso, ObjectId: str})


def _db(db: Database | None) -> Database:
    return db if db is not None else get_db()


def public(doc: dict) -> dict:
    """The building as the API shows it: no embedding, id instead of _id, display_status added."""
    out = {**{k: (v.copy() if isinstance(v, (dict, list)) else v) for k, v in CONTRACT_DEFAULTS.items()},
           **{k: v for k, v in doc.items() if k not in ("_id", "embedding")}}
    out["id"] = doc["_id"]
    out["display_status"] = domain.display_status(doc)
    return to_json(out)


def get_building(building_id: str, db: Database | None = None) -> dict | None:
    doc = _db(db).buildings.find_one({"_id": building_id}, {"embedding": 0})
    return public(doc) if doc else None


def list_buildings(street: str | None = None, status: str | None = None,
                   db: Database | None = None) -> list[dict]:
    """Best rank first; buildings without a rank last."""
    docs = _db(db).buildings.find({}, {"embedding": 0})
    out = [public(d) for d in docs
           if not street or domain.street_key(d.get("street")) == domain.street_key(street)]
    if status:
        out = [b for b in out if b["display_status"] == status]
    return sorted(out, key=lambda b: (b["rank"] is None, b["rank"] or 0, b["id"]))


def review_queue(db: Database | None = None) -> list[dict]:
    return list_buildings(status="review", db=db)


def nearest_pois(db: Database, location: dict) -> list[dict]:
    """The nearest POI of each kind within 1000 m, by $geoNear."""
    out = []
    for kind in domain.SERVICE_KINDS:
        hit = next(iter(db.pois.aggregate([
            {"$geoNear": {"near": location, "distanceField": "dist_m", "maxDistance": 1000,
                          "spherical": True, "query": {"kind": kind}}},
            {"$limit": 1}])), None)
        if hit:
            lon, lat = hit["location"]["coordinates"]
            out.append({"kind": kind, "name": hit["name"], "lat": lat, "lon": lon,
                        "dist_m": round(hit["dist_m"])})
    return out


def building_services(building_id: str, db: Database | None = None) -> dict | None:
    db = _db(db)
    doc = db.buildings.find_one({"_id": building_id}, {"services": 1, "location": 1})
    if doc is None:
        return None
    pois = nearest_pois(db, doc["location"]) if doc.get("location") else []
    return {"services": doc.get("services"), "pois": pois}


def similar(building_id: str, k: int = 5, db: Database | None = None) -> tuple[list[dict], str]:
    """(results, db_op). db_op is "$vectorSearch" or "cosine-fallback" once C4 builds
    embeddings; "none" means no search ran."""
    return [], "none"  # filled in C4


def public_registers(building_id: str, db: Database | None = None) -> dict | None:
    """derelict / protected are None until registers.py has checked the building:
    None means "not checked", never "not on the register"."""
    doc = _db(db).buildings.find_one({"_id": building_id}, {"registers": 1})
    if doc is None:
        return None
    reg = doc.get("registers") or {}
    out = {"derelict": reg.get("derelict"), "protected": reg.get("protected")}
    return {**out, "checked": all(v is not None for v in out.values())}


def street_summary(street: str, db: Database | None = None) -> dict:
    docs = [d for d in _db(db).buildings.find({}, {"embedding": 0})
            if domain.street_key(d.get("street")) == domain.street_key(street)]
    shown = [domain.display_status(d) for d in docs]
    return {"total": len(docs),
            "processed": sum(1 for d in docs if (d.get("models") or {}).get("vision")),
            "likely_underused": shown.count("likely_underused"), "review": shown.count("review"),
            "confirmed": shown.count("confirmed"), "home": shown.count("home")}


CONTEXT_FILE = Path(__file__).resolve().parents[2] / "data" / "export" / "context.geojson"


def context_buildings(db: Database | None = None) -> dict:
    """Surrounding OSM buildings (properties.height_m), written by pipeline/geo.py."""
    if CONTEXT_FILE.exists():
        return json.loads(CONTEXT_FILE.read_text())
    return {"type": "FeatureCollection", "features": []}


def eval_summary(db: Database | None = None) -> dict:
    """C4 fills rows, agreement and shop_confirmed; escalated is already real."""
    escalated = _db(db).buildings.count_documents({"needs_human": True})
    return {"rows": [], "agreement": "0/0", "escalated": escalated, "shop_confirmed": "0/0"}


def recompute_ranks(db: Database | None = None) -> int:
    """Rank every processed building 1..N with domain.rank_key (brief order).
    Returns how many were ranked."""
    db = _db(db)
    docs = list(db.buildings.find({"upper_status": {"$exists": True, "$ne": None}},
                                  {"inspection": 1, "human_label": 1, "upper_status": 1,
                                   "separate_entrance": 1, "services": 1, "confidence": 1}))
    docs.sort(key=domain.rank_key)
    if docs:
        db.buildings.bulk_write([UpdateOne({"_id": d["_id"]}, {"$set": {"rank": n}})
                                 for n, d in enumerate(docs, start=1)])
    return len(docs)


def set_human_label(building_id: str, label: str | None, db: Database | None = None) -> dict | None:
    db = _db(db)
    if db.buildings.update_one({"_id": building_id}, {"$set": {"human_label": label}}).matched_count == 0:
        return None
    recompute_ranks(db)
    return get_building(building_id, db)


def record_inspection(building_id: str, outcome: str, note: str | None,
                      db: Database | None = None) -> dict | None:
    db = _db(db)
    inspection = {"outcome": outcome, "note": note, "at": datetime.now(timezone.utc)}
    if db.buildings.update_one({"_id": building_id}, {"$set": {"inspection": inspection}}).matched_count == 0:
        return None
    recompute_ranks(db)
    return get_building(building_id, db)

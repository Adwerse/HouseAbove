"""B's REST routes (CONTRACT "REST"): /walkers and /badges.

Privacy: walker views show only the walker's own captures. Building fields are read
through an explicit projection, so AI fields (upper_status, signals, display_status,
verifier, ...) never reach these responses.
"""
from fastapi import APIRouter, HTTPException

from app import events
from app.db import get_db
from app.gamification import engine
from app.repo import to_json

router = APIRouter(prefix="/api", tags=["walkers"])

WALK_FIELDS = ("walker_id", "started_at", "ended_at", "path", "times", "distance_m", "building_ids")
WALKER_FIELDS = ("name", "town")


def walker_walks(db, walker_id: str) -> list[dict]:
    """The walker's walks, oldest first, each with captures [{building_id, lon, lat, t, thumb}]."""
    own = {b["_id"]: b for b in db.buildings.find({"captured_by": walker_id},
                                                  {"captured_at": 1, "location": 1, "photo": 1})}
    out = []
    for w in db.walks.find({"walker_id": walker_id}).sort([("started_at", 1), ("_id", 1)]):
        stored = {c["building_id"]: c for c in w.get("captures") or [] if c.get("building_id")}
        captures = []
        for bid in w.get("building_ids") or []:
            b = own.get(bid)
            if b is None:  # captured_by changed or building gone: not this walker's capture
                continue
            c = stored.get(bid, {})
            pos = (c["lon"], c["lat"]) if c.get("lon") is not None and c.get("lat") is not None \
                else engine.position(b, {})
            captures.append({
                "building_id": bid,
                "lon": pos[0] if pos else None,
                "lat": pos[1] if pos else None,
                "t": c.get("t") or b.get("captured_at"),
                "thumb": b.get("photo") or f"/photos/{bid}.jpg",
            })
        out.append({"_id": w["_id"], "id": w["_id"], **{k: w[k] for k in WALK_FIELDS if k in w},
                    "captures": captures})
    return out


@router.get("/badges")
def badges() -> list:
    return engine.CATALOG


@router.get("/walkers/{walker_id}")
def get_walker(walker_id: str) -> dict:
    db = get_db()
    walker = db.walkers.find_one({"_id": walker_id})
    if walker is None:
        raise HTTPException(status_code=404, detail=f"no walker {walker_id!r}")
    w = {"_id": walker_id, "id": walker_id, **{k: walker[k] for k in WALKER_FIELDS if k in walker}}
    return to_json({"walker": w, **engine.profile(db, walker_id)})


@router.get("/walkers/{walker_id}/walks")
def get_walks(walker_id: str) -> list:
    return to_json(walker_walks(get_db(), walker_id))


@router.post("/walkers/{walker_id}/evaluate")
def evaluate(walker_id: str) -> dict:
    awards = engine.evaluate_walker(get_db(), walker_id)
    for a in awards:
        events.publish("badge.awarded", {"walker_id": a["walker_id"], "badge_id": a["badge_id"],
                                         "building_id": a["building_id"], "title": engine.title(a["badge_id"])})
    return {"awards": to_json([engine.public_award(a) for a in awards])}

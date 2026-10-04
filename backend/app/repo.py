"""Every read and write of Atlas for the API (and MCP) goes through here."""
from pymongo import UpdateOne
from pymongo.database import Database

from app import domain
from app.db import get_db


def recompute_ranks(db: Database | None = None) -> int:
    """Rank every processed building 1..N with domain.rank_key (brief order).
    Returns how many were ranked."""
    db = db if db is not None else get_db()
    docs = list(db.buildings.find({"upper_status": {"$exists": True, "$ne": None}},
                                  {"inspection": 1, "human_label": 1, "upper_status": 1,
                                   "separate_entrance": 1, "services": 1, "confidence": 1}))
    docs.sort(key=domain.rank_key)
    if docs:
        db.buildings.bulk_write([UpdateOne({"_id": d["_id"]}, {"$set": {"rank": n}})
                                 for n, d in enumerate(docs, start=1)])
    return len(docs)

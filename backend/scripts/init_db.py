#!/usr/bin/env python3
"""Create collections and indexes. Safe to re-run.

    python backend/scripts/init_db.py [--no-wait]

Needs MONGODB_URI and EMBED_DIM (run pipeline/probe_providers.py first).

If the Atlas vector index cannot be created (e.g. on M0) the script logs it and
carries on: similar search then falls back to in-Python cosine and reports
db_op "cosine-fallback".
"""
import argparse
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo.operations import SearchIndexModel  # noqa: E402

from app.db import get_db  # noqa: E402

log = logging.getLogger("init_db")

FACADE_COLLECTION = "buildings"
VECTOR_INDEX = "facade_vec"

# (collection, keys, options), from CONTRACT "MongoDB Atlas M0"
INDEXES = [
    ("buildings", [("location", "2dsphere")], {}),
    ("pois", [("location", "2dsphere")], {}),
    # awards are unique per (walker, badge, building); building_id may be null
    ("awards", [("walker_id", 1), ("badge_id", 1), ("building_id", 1)], {"unique": True}),
]


def create_regular_indexes(db) -> None:
    for collection, keys, options in INDEXES:
        name = db[collection].create_index(keys, **options)
        log.info("index %s.%s ok", collection, name)


def vector_index_definition(dim: int) -> dict:
    return {"fields": [
        {"type": "vector", "path": "embedding", "numDimensions": dim, "similarity": "cosine"},
        {"type": "filter", "path": "street"},
        {"type": "filter", "path": "upper_status"},
    ]}


def create_vector_index(db, dim: int, wait: bool) -> bool:
    coll = db[FACADE_COLLECTION]
    try:
        existing = {i["name"]: i for i in coll.list_search_indexes()}
        if VECTOR_INDEX in existing:
            have = existing[VECTOR_INDEX].get("latestDefinition", {}).get("fields", [])
            dims = [f.get("numDimensions") for f in have if f.get("type") == "vector"]
            if dims != [dim]:
                log.warning("%s exists with numDimensions %s but EMBED_DIM is %s: drop and re-run",
                            VECTOR_INDEX, dims, dim)
            else:
                log.info("vector index %s already exists", VECTOR_INDEX)
            return True
        coll.create_search_index(SearchIndexModel(
            definition=vector_index_definition(dim), name=VECTOR_INDEX, type="vectorSearch"))
        log.info("vector index %s created (%d dims, cosine)", VECTOR_INDEX, dim)
        if wait:
            deadline = time.time() + 90
            while time.time() < deadline:
                state = next((i for i in coll.list_search_indexes(VECTOR_INDEX)), {})
                if state.get("queryable"):
                    log.info("vector index %s is queryable", VECTOR_INDEX)
                    return True
                time.sleep(3)
            log.warning("vector index %s not queryable after 90s; it may still be building", VECTOR_INDEX)
        return True
    except Exception as exc:
        log.warning("vector index NOT created (%s: %s). Similar search will use in-Python cosine "
                    "and report db_op 'cosine-fallback'.", type(exc).__name__, str(exc)[:200])
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--no-wait", action="store_true", help="do not wait for the vector index to become queryable")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    try:
        dim = int(os.environ["EMBED_DIM"])
    except (KeyError, ValueError):
        log.error("EMBED_DIM is not set: run pipeline/probe_providers.py and put its .env lines in .env")
        return 2

    db = get_db()
    if FACADE_COLLECTION not in db.list_collection_names():
        db.create_collection(FACADE_COLLECTION)  # search indexes need an existing collection
    create_regular_indexes(db)
    create_vector_index(db, dim, wait=not args.no_wait)
    return 0


if __name__ == "__main__":
    sys.exit(main())

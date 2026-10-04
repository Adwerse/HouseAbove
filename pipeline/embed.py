#!/usr/bin/env python3
"""Facade embeddings, for "similar facades" (GET /api/buildings/{id}/similar).

    python pipeline/embed.py [--force]

Text per building = label + signals + evidence + the verifier's signs for and
against. EMBED_MODEL comes from .env: a TensorX embedding model, or
"fastembed:<name>" for a local one. The vector length must equal EMBED_DIM.
Then the Atlas vector index "facade_vec" is created if it is missing.
"""
import argparse
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

from openai import OpenAI  # noqa: E402

import init_db  # noqa: E402
from app import llm  # noqa: E402
from app.db import get_db  # noqa: E402

log = logging.getLogger("embed")
BATCH = 16


def describe(b: dict) -> str:
    v = b.get("verifier") or {}
    parts = [b.get("label"),
             "Signals: " + "; ".join(b.get("upper_signals") or []) if b.get("upper_signals") else None,
             b.get("evidence"),
             "Signs of use: " + "; ".join(v["for_use"]) if v.get("for_use") else None,
             "Signs against use: " + "; ".join(v["against_use"]) if v.get("against_use") else None]
    return ". ".join(p.rstrip(".") for p in parts if p)


def embedder(model: str):
    """texts -> vectors."""
    if model.startswith("fastembed:"):
        from fastembed import TextEmbedding
        local = TextEmbedding(model.split(":", 1)[1])
        return lambda texts: [list(map(float, v)) for v in local.embed(texts)]
    client = OpenAI(base_url=os.environ["TENSORX_BASE_URL"], api_key=os.environ["TENSORX_API_KEY"], max_retries=3)

    def remote(texts: list[str]) -> list[list[float]]:
        resp = client.embeddings.create(model=model, input=texts, timeout=120)
        return [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]
    return remote


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--force", action="store_true", help="embed buildings that already have an embedding")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    model = llm.model_from_env("EMBED_MODEL")
    try:
        dim = int(os.environ["EMBED_DIM"])
    except (KeyError, ValueError):
        log.error("EMBED_DIM is not set: put the probe_providers.py output in .env")
        return 2

    db = get_db()
    docs = [d for d in db.buildings.find({"models.vision": {"$nin": [None, ""]}})
            if args.force or not d.get("embedding")]
    log.info("%d buildings to embed with %s (%d dims)", len(docs), model, dim)
    embed = embedder(model) if docs else None
    for i in range(0, len(docs), BATCH):
        batch = docs[i:i + BATCH]
        vectors = embed([describe(d) for d in batch])
        # Never claim a batch completed when a provider returned fewer (or more)
        # vectors than requested. Validate the whole batch before writing any of
        # it, so a retry is clean and every write remains a $set of embedding.
        if len(vectors) != len(batch):
            log.error("%s returned %d vectors for %d buildings", model, len(vectors), len(batch))
            return 2
        for vec in vectors:
            if len(vec) != dim:
                log.error("%s returned %d dimensions but EMBED_DIM is %d", model, len(vec), dim)
                return 2
        for d, vec in zip(batch, vectors):
            db.buildings.update_one({"_id": d["_id"]}, {"$set": {"embedding": vec}})
    print(f"embed: {len(docs)} buildings embedded")
    init_db.create_vector_index(db, dim, wait=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

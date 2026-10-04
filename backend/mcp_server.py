"""MCP server "homesabove": eight read-only tools over the same repo.py functions the API uses.

    python backend/mcp_server.py           streamable HTTP on 127.0.0.1:8001, path /mcp
    python backend/mcp_server.py --stdio   terminal backup (pipeline/agent_cli.py)

Every result carries trace {db_op, ms}. In --stdio mode stdout is the MCP
protocol: never print(); log to stderr.
"""
import argparse
import functools
import logging
import sys
import time

from mcp.server.mcpserver import MCPServer

from app import repo
from app.db import get_db

log = logging.getLogger("mcp_server")

mcp = MCPServer(
    "homesabove",
    instructions="Read-only tools over HomesAbove building records. Statuses describe visible "
                 "signals on a facade, not occupancy. Every candidate needs human verification.",
)

# Amounts and the official FAQ come from the product brief; no eligibility rules here.
GRANT = {
    "name": "Vacant Above the Shop grant (launched April 2026)",
    "amounts_eur": {"one_unit": 95000, "two_units": 115000, "three_or_more_units": 135000},
    "energy_upgrades": "up to EUR 25,000 more from SEAI for energy upgrades",
    "official_faq": "https://www.sdcc.ie/en/services/housing/vacant-homes/vacant-above-the-shop-grant-faqs.pdf",
    "note": "Amounts only. Whether a building qualifies is decided by the council under the official "
            "FAQ; HomesAbove does not assess eligibility.",
}


def traced(db_op: str):
    """Add trace {db_op, ms} to a tool's dict result. A tool may return (result, db_op)
    when the operation depends on what ran."""
    def decorate(fn):
        @functools.wraps(fn)
        def run(*args, **kwargs):
            start = time.perf_counter()
            result = fn(*args, **kwargs)
            op = db_op
            if isinstance(result, tuple):
                result, op = result
            return {**result, "trace": {"db_op": op, "ms": round((time.perf_counter() - start) * 1000)}}
        return run
    return decorate


def _brief(b: dict) -> dict:
    services, verifier = b.get("services") or {}, b.get("verifier") or {}
    return {"id": b["id"], "label": b["label"], "street": b["street"], "rank": b["rank"],
            "status": b["display_status"], "upper_status": b["upper_status"],
            "upper_floors": b["upper_floors"], "confidence": b["confidence"],
            "separate_entrance": b["separate_entrance"], "services_score": services.get("score"),
            "signals": b["upper_signals"], "evidence": b["evidence"], "needs_human": b["needs_human"],
            "verifier_agrees": verifier.get("agree"), "human_label": b["human_label"]}


def _missing(building_id: str) -> dict:
    return {"error": f"no building with id {building_id!r}", "summary": f"No building {building_id!r}."}


@mcp.tool()
@traced("find")
def street_candidates(street: str, limit: int = 5) -> dict:
    """Buildings on a street, best rank first. Rank order: likely underused, then unclear,
    then likely used; separate entrance first; higher services score; higher confidence."""
    buildings = [b for b in repo.list_buildings(street=street) if b["rank"] is not None]
    top = [_brief(b) for b in buildings[:max(1, min(limit, 20))]]
    names = ", ".join(f"#{b['rank']} {b['id']}" for b in top)
    return {"street": street, "ranked_on_street": len(buildings), "candidates": top,
            "summary": f"{len(top)} of {len(buildings)} ranked buildings on {street}: {names}"}


@mcp.tool()
@traced("find")
def building(id: str) -> dict:
    """One building: photo, signals, evidence, confidence and the verifier's view."""
    b = repo.get_building(id)
    if b is None:
        return _missing(id)
    ground = {"open": "open", "vacant": "appears unused", "unclear": "unclear"}.get(b["ground_floor"], b["ground_floor"])
    v = b["verifier"] or {}
    detail = {**_brief(b), "ground_floor": ground, "photo": b["photo"],
              "verifier": {"status": v.get("status"), "agrees": v.get("agree"), "signs_for_use": v.get("for_use"),
                           "signs_against_use": v.get("against_use"), "model": v.get("model")} if v else None,
              "shop_staff_answer": b["shop_staff_answer"], "inspection": b["inspection"], "models": b["models"]}
    return {"building": detail,
            "summary": f"{id}: {b['display_status']}, rank {b['rank']}, confidence {b['confidence']}"}


@mcp.tool()
@traced("$geoNear")
def services_nearby(id: str) -> dict:
    """Services within walking distance of a building: nearest bus stop, grocery, school,
    GP or pharmacy and park, with distances and a score out of 5."""
    found = repo.building_services(id)
    if found is None:
        return _missing(id)
    score = (found["services"] or {}).get("score")
    near = ", ".join(f"{p['kind']} {p['dist_m']} m" for p in found["pois"])
    return {**found, "summary": f"{id}: services score {score}/5 within walking distance ({near or 'none within 1 km'})"}


@mcp.tool()
@traced("find")
def review_queue() -> dict:
    """Buildings waiting for a human decision (the two model passes disagree or confidence is low)."""
    queue = [_brief(b) for b in repo.review_queue()]
    return {"count": len(queue), "buildings": queue,
            "summary": f"{len(queue)} buildings need a human check: " + ", ".join(b["id"] for b in queue[:8])}


@mcp.tool()
@traced("find")
def street_summary(street: str) -> dict:
    """Aggregate counts for a street only: total, processed, likely underused, in review, confirmed, home."""
    s = repo.street_summary(street)
    follow_up = s["likely_underused"] + s["review"]
    return {"street": street, **s, "need_follow_up": follow_up,
            "summary": f"{follow_up} of {s['total']} facades on {street} need follow-up"}


@mcp.tool()
@traced("static")
def grant_info() -> dict:
    """Grant amounts and the link to the official FAQ. No eligibility statements."""
    return {**GRANT, "summary": "Grant amounts and the official FAQ link; eligibility is the council's call."}


@mcp.tool()
@traced("$vectorSearch")
def similar_facades(id: str, k: int = 5) -> dict:
    """Facades that look like this one (vector search over facade descriptions)."""
    if repo.get_building(id) is None:
        return _missing(id)
    results, db_op = repo.similar(id, max(1, min(k, 10)))
    note = "" if db_op != "none" else " (no facade embeddings yet)"
    return {"similar": results, "summary": f"{len(results)} facades similar to {id}{note}"}, db_op


@mcp.tool()
@traced("find")
def public_registers(id: str) -> dict:
    """Whether the building is on the DCC Derelict Sites Register or the Record of Protected
    Structures. A null value means not checked yet, not "not listed"."""
    reg = repo.public_registers(id)
    if reg is None:
        return _missing(id)
    state = "checked" if reg["checked"] else "not checked yet"
    return {**reg, "summary": f"{id}: derelict {reg['derelict']}, protected {reg['protected']} ({state})"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--stdio", action="store_true", help="serve over stdio instead of HTTP")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8001)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(levelname)s %(name)s: %(message)s")
    try:
        get_db().command("ping")
    except Exception as exc:  # tools will report their own errors; do not stop the server
        log.error("Atlas ping failed: %s", exc)
    if args.stdio:
        mcp.run("stdio")
    else:
        log.info("MCP on http://%s:%d/mcp", args.host, args.port)
        mcp.run("streamable-http", host=args.host, port=args.port, streamable_http_path="/mcp")


if __name__ == "__main__":
    main()

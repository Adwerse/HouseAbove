"""C's REST routes (CONTRACT "REST"). B's /walkers and /badges live in gamification/routes.py."""
import json
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app import agent_cache, events, repo
from app.db import get_db
from app.gamification import engine

log = logging.getLogger("api")
router = APIRouter(prefix="/api")

# CONTRACT "Badge catalog", used when an award carries no title and the engine has no catalog.
BADGE_TITLES = {
    "first_look": "First Look", "street_scout": "Street Scout", "main_street": "Main Street",
    "five_k": "5K for Homes", "streak_3": "Three-Day Streak", "local_knowledge": "Local Knowledge",
    "second_look": "Second Look", "homes_above": "Homes Above", "lights_on": "Lights On",
}


class HumanLabelIn(BaseModel):
    label: Literal["likely_underused", "likely_used", "unclear"] | None


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class InspectionIn(BaseModel):
    outcome: Literal["confirmed_candidate", "not_suitable", "returned_to_use"]
    note: str | None = None


def _or_404(value, building_id: str):
    if value is None:
        raise HTTPException(status_code=404, detail=f"no building {building_id!r}")
    return value


def _feature(b: dict) -> dict | None:
    """GeoJSON feature: the footprint if there is one, else the point. None if it cannot be placed."""
    geometry = b["footprint"] or b["location"]
    if not geometry:
        return None
    return {"type": "Feature", "id": b["id"], "geometry": geometry, "properties": b}


def _badge_title(award: dict) -> str:
    if award.get("title"):
        return award["title"]
    catalog = getattr(engine, "CATALOG", None) or []
    for entry in (catalog.values() if isinstance(catalog, dict) else catalog):
        get = entry.get if isinstance(entry, dict) else lambda k, e=entry: getattr(e, k, None)
        if get("id") == award.get("badge_id") and get("title"):
            return get("title")
    return BADGE_TITLES.get(award.get("badge_id"), str(award.get("badge_id")).replace("_", " ").title())


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/buildings")
def list_buildings(street: str | None = None, status: str | None = None) -> dict:
    features = [f for f in map(_feature, repo.list_buildings(street, status)) if f]
    return {"type": "FeatureCollection", "features": features}


@router.get("/buildings/{building_id}")
def get_building(building_id: str) -> dict:
    return _or_404(repo.get_building(building_id), building_id)


@router.get("/buildings/{building_id}/services")
def building_services(building_id: str) -> dict:
    return _or_404(repo.building_services(building_id), building_id)


@router.get("/buildings/{building_id}/similar")
def similar(building_id: str, k: int = 5) -> list:
    _or_404(repo.get_building(building_id), building_id)
    return repo.similar(building_id, k)[0]


@router.get("/review-queue")
def review_queue() -> list:
    return repo.review_queue()


@router.post("/buildings/{building_id}/human-label")
def human_label(building_id: str, body: HumanLabelIn) -> dict:
    building = _or_404(repo.set_human_label(building_id, body.label), building_id)
    events.publish("building.updated", {"id": building_id})
    return building


@router.post("/buildings/{building_id}/inspection")
def inspection(building_id: str, body: InspectionIn) -> dict:
    building = _or_404(repo.record_inspection(building_id, body.outcome, body.note), building_id)
    try:
        awards = engine.on_inspection(get_db(), building_id, body.outcome)
    except Exception:  # the inspection is recorded; do not fail the officer's click over a badge
        log.exception("on_inspection failed for %s", building_id)
        awards = []
    events.publish("building.updated", {"id": building_id})
    events.publish("inspection.recorded", {"id": building_id, "outcome": body.outcome})
    for award in awards:
        events.publish("badge.awarded", {"walker_id": award.get("walker_id"), "badge_id": award.get("badge_id"),
                                         "building_id": award.get("building_id"), "title": _badge_title(award)})
    return {"building": building, "awards": repo.to_json(awards)}


@router.get("/streets/{street}/summary")
def street_summary(street: str) -> dict:
    return repo.street_summary(street)


@router.get("/context-buildings")
def context_buildings() -> dict:
    return repo.context_buildings()


@router.get("/eval")
def eval_summary() -> dict:
    return repo.eval_summary()


@router.post("/agent/ask")
async def agent_ask(body: AskIn) -> EventSourceResponse:
    """SSE: tool_call, tool_result, delta, done (CONTRACT)."""

    async def stream():
        async for event, data in agent_cache.answer(body.question):
            yield {"event": event, "data": json.dumps(data)}

    return EventSourceResponse(stream(), ping=15)

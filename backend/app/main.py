"""Run from backend/:  uvicorn app.main:app --reload --port 8000"""
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from app.api import router as api_router
from app.events import subscribe
from app.gamification.routes import router as gamification_router

PHOTOS_DIR = Path(__file__).resolve().parents[2] / "data" / "photos_web"
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="HomesAbove API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/events")
async def events() -> EventSourceResponse:
    """SSE stream. Each message is the JSON envelope {"type", "payload", "ts"}."""

    async def stream():
        with subscribe() as sub:
            async for event in sub:
                yield {"data": json.dumps(event)}

    return EventSourceResponse(stream(), ping=15)


app.include_router(api_router)
app.include_router(gamification_router)
app.mount("/photos", StaticFiles(directory=PHOTOS_DIR), name="photos")

"""Demo cache for the agent.

Every completed live run is saved to data/export/agent/<slug>.jsonl, one event per
line: {"t_ms": ms since the question, "event": ..., "data": {...}}. index.json
maps each question to its file, so a static front end can find it.
With DEMO_CACHE=1 the same question replays from disk with its original timings
(gaps capped at MAX_GAP_S), with no model and no MCP involved. A question that is
not cached runs live. Failed runs are never saved.
"""
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from app import agent

log = logging.getLogger("agent_cache")

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "export" / "agent"
MAX_GAP_S = 3.0


def normalize(question: str) -> str:
    return re.sub(r"\s+", " ", question.strip().lower()).rstrip("?!. ")


def slug(question: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize(question)).strip("-")[:80] or "question"


def path_for(question: str) -> Path:
    return CACHE_DIR / f"{slug(question)}.jsonl"


def load(question: str) -> list[dict] | None:
    path = path_for(question)
    if not path.exists():
        return None
    lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return lines if lines and lines[-1]["event"] == "done" else None


def save(question: str, events: list[dict]) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = path_for(question)
    path.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events), encoding="utf-8")
    index_path = CACHE_DIR / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"questions": []}
    entry = {"question": question.strip(), "file": path.name, "recorded_at": datetime.now(timezone.utc).isoformat(),
             "model": os.environ.get("AGENT_MODEL")}
    index["questions"] = [q for q in index["questions"] if q["file"] != path.name] + [entry]
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


async def replay(events: list[dict]) -> AsyncIterator[tuple[str, dict]]:
    previous = 0
    for e in events:
        await asyncio.sleep(min(max(e["t_ms"] - previous, 0) / 1000, MAX_GAP_S))
        previous = e["t_ms"]
        yield e["event"], e["data"]


async def answer(question: str) -> AsyncIterator[tuple[str, dict]]:
    """The contract's agent stream: from the cache when DEMO_CACHE=1 and cached, else live (and saved)."""
    if os.environ.get("DEMO_CACHE") == "1":
        cached = load(question)
        if cached:
            async for event in replay(cached):
                yield event
            return
        log.warning("DEMO_CACHE=1 but %r is not cached: running live", question)

    recorded, start = [], time.monotonic()
    async for event, data in agent.stream_agent(question):
        recorded.append({"t_ms": round((time.monotonic() - start) * 1000), "event": event, "data": data})
        yield event, data
    if recorded and recorded[-1]["event"] == "done" and not recorded[-1]["data"].get("error"):
        log.info("saved %s", save(question, recorded))

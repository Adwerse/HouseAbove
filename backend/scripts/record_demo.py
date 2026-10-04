#!/usr/bin/env python3
"""Record the five demo questions into data/export/agent/ and verify the replay.

    python backend/scripts/record_demo.py [--street "Talbot Street"] [--only 1,3] [--cache-dir DIR]

Needs the MCP server (python backend/mcp_server.py), processed buildings in Atlas
and AGENT_MODEL in .env. Questions 2 and 4 use the street's rank-1 building.
Re-run with --only 4 after the facade embeddings exist (C4).
"""
import argparse
import asyncio
import logging
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import agent_cache, repo  # noqa: E402

FLAG = re.compile(r"\bvacant\b(?! above the shop)|\bempty\b|\beligib", re.I)  # wording to check before the demo (the grant's own name is fine)


def questions(street: str, top: str) -> list[str]:
    return [f"Where on {street} should we inspect first?", f"Why is {top} ranked first?",
            "Which buildings need a human check?", f"Find facades similar to {top}",
            "What is the grant and where is the official FAQ?"]


async def collect(question: str) -> tuple[list[tuple[str, dict]], float]:
    start = time.monotonic()
    events = [e async for e in agent_cache.answer(question)]
    return events, time.monotonic() - start


async def main_async(args) -> int:
    ranked = [b for b in repo.list_buildings(street=args.street) if b["rank"] is not None]
    if not ranked:
        print(f"no ranked buildings on {args.street!r}: run the pipeline first", file=sys.stderr)
        return 2
    top = ranked[0]["id"]
    qs = questions(args.street, top)
    chosen = {int(n) for n in args.only.split(",")} if args.only else set(range(1, 6))
    failed = 0

    for number, q in enumerate(qs, start=1):
        if number not in chosen:
            continue
        os.environ["DEMO_CACHE"] = "0"
        events, live_s = await collect(q)
        calls = [d for e, d in events if e == "tool_call"]
        results = [d for e, d in events if e == "tool_result"]
        final = events[-1][1] if events else {}
        problems = []
        if not calls or len(results) < len(calls):
            problems.append("no tool calls or a call without a result")
        if any(r.get("ms") is None or r.get("db_op") in (None, "error") for r in results):
            problems.append("a tool result has no ms or db_op")
        if events[-1:] and events[-1][0] != "done" or final.get("error"):
            problems.append("the run failed: " + str(final.get("text"))[:120])
        if number == 5 and "sdcc.ie" not in final.get("text", ""):
            problems.append("the answer does not include the official FAQ link")

        os.environ["DEMO_CACHE"] = "1"
        replayed, replay_s = await collect(q)
        if replayed != events:
            problems.append("replay differs from the recording")

        print(f"\n[{number}] {q}")
        print(f"    live {live_s:.1f}s, replay {replay_s:.1f}s; tools: " +
              ", ".join(f"{r['name']} ({r['db_op']}, {r['ms']} ms)" for r in results))
        print("    " + final.get("text", "").replace("\n", "\n    "))
        flagged = sorted({m.group(0).lower() for m in FLAG.finditer(final.get("text", ""))})
        if flagged:
            print(f"    CHECK WORDING: {flagged}")
        if number == 4 and any(r["db_op"] == "none" for r in results):
            print("    NOTE: no facade embeddings yet, so this answer says so. Re-record with --only 4 after C4.")
        for p in problems:
            print("    PROBLEM:", p)
        failed += bool(problems)
    print(f"\n{len(chosen) - failed} of {len(chosen)} questions recorded and replay-verified")
    return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--street", default="Talbot Street")
    ap.add_argument("--only", help="comma-separated question numbers, e.g. 1,3")
    ap.add_argument("--cache-dir", type=Path, help="default: data/export/agent")
    args = ap.parse_args()
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    if args.cache_dir:
        agent_cache.CACHE_DIR = args.cache_dir
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())

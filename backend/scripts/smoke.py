#!/usr/bin/env python3
"""Hit every contract endpoint and assert the response shapes.

    python backend/scripts/smoke.py [--api http://127.0.0.1:8000] [--mcp http://127.0.0.1:8001/mcp]
                                    [--walker w_rodion] [--write] [--inspect BUILDING_ID]
                                    [--skip-agent] [--skip-mcp]

Read-only by default. --write also re-sets one building's human label to its
current value (changes no data) to prove building.updated arrives on /api/events,
and POSTs /api/walkers/<id>/evaluate (idempotent). --inspect ID records a real
inspection on that building and checks the three event types.
Each check is tagged with the owner of the code it exercises: [C] or [B].
Exit code 1 if anything failed.
"""
import argparse
import asyncio
import json
import re
import sys
import threading
import time

import requests

CONTRACT_FIELDS = {"id", "label", "street", "location", "footprint", "geo_method", "photo", "source", "ground_floor",
                   "upper_floors", "upper_status", "upper_signals", "separate_entrance", "confidence", "evidence",
                   "verifier", "needs_human", "services", "registers", "rank", "height_m", "models", "human_label",
                   "shop_staff_answer", "inspection", "display_status"}
DISPLAY = {"likely_underused", "review", "unclear", "likely_used", "confirmed", "home"}
KINDS = {"bus", "grocery", "school", "gp_or_pharmacy", "park"}
BADGES = {"first_look", "street_scout", "main_street", "five_k", "streak_3", "local_knowledge", "second_look",
          "homes_above", "lights_on"}

results: list[tuple[bool, str, str, str]] = []  # ok, owner, name, detail


def check(owner: str, name: str):
    def decorate(fn):
        try:
            detail = fn() or ""
            results.append((True, owner, name, str(detail)))
        except Exception as exc:  # AssertionError, request errors, KeyError on a wrong shape
            results.append((False, owner, name, f"{type(exc).__name__}: {str(exc)[:300]}"))
        r = results[-1]
        print(f"{'ok  ' if r[0] else 'FAIL'} [{r[1]}] {r[2]}" + (f"  {r[3]}" if r[3] else ""))
        return fn
    return decorate


def sse(method: str, url: str, body: dict | None = None, timeout: float = 90):
    """Yield (event, data) from an SSE response."""
    with requests.request(method, url, json=body, stream=True, timeout=timeout) as r:
        assert r.status_code == 200, f"HTTP {r.status_code}"
        assert r.headers["content-type"].startswith("text/event-stream"), r.headers["content-type"]
        event = None
        for line in r.iter_lines(decode_unicode=True):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                yield event, json.loads(line[5:])
                if event == "done":
                    return


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--mcp", default="http://127.0.0.1:8001/mcp")
    ap.add_argument("--walker", default="w_rodion")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--inspect", metavar="BUILDING_ID")
    ap.add_argument("--skip-agent", action="store_true")
    ap.add_argument("--skip-mcp", action="store_true")
    args = ap.parse_args()
    api = args.api.rstrip("/") + "/api"
    get = lambda path, **kw: requests.get(api + path, timeout=30, **kw)  # noqa: E731
    state: dict = {}

    @check("C", "GET /health")
    def _():
        assert get("/health").json() == {"ok": True}

    @check("C", "GET /buildings is a GeoJSON FeatureCollection with every contract field")
    def _():
        fc = get("/buildings").json()
        assert fc["type"] == "FeatureCollection" and isinstance(fc["features"], list)
        for f in fc["features"]:
            p = f["properties"]
            assert f["type"] == "Feature" and f["id"] == p["id"], f
            assert f["geometry"]["type"] in ("Point", "Polygon"), f["geometry"]
            assert CONTRACT_FIELDS <= set(p), f"{p['id']} lacks {sorted(CONTRACT_FIELDS - set(p))}"
            assert "embedding" not in p and p["display_status"] in DISPLAY, p["id"]
            assert isinstance(p["upper_signals"], list) and isinstance(p["needs_human"], bool)
            if p["services"]:
                assert {"bus_m", "grocery_m", "school_m", "gp_or_pharmacy_m", "park_m", "score"} <= set(p["services"])
            if p["verifier"]:
                assert {"agree", "for_use", "against_use", "status", "model"} <= set(p["verifier"])
        state["features"] = fc["features"]
        return f"{len(fc['features'])} buildings"

    features = state.get("features", [])
    if features:
        first = features[0]["properties"]
        state["id"], state["street"] = first["id"], first["street"]

        @check("C", "GET /buildings?street=&status= filters")
        def _():
            by_street = get("/buildings", params={"street": state["street"]}).json()["features"]
            assert by_street and all(f["properties"]["street"] == state["street"] for f in by_street)
            status = first["display_status"]
            by_status = get("/buildings", params={"status": status}).json()["features"]
            assert by_status and all(f["properties"]["display_status"] == status for f in by_status)

        @check("C", "GET /buildings/{id} and 404")
        def _():
            assert get(f"/buildings/{state['id']}").json()["id"] == state["id"]
            assert get("/buildings/does_not_exist").status_code == 404

        @check("C", "GET /buildings/{id}/services")
        def _():
            s = get(f"/buildings/{state['id']}/services").json()
            assert set(s) == {"services", "pois"}
            for p in s["pois"]:
                assert {"kind", "name", "lat", "lon", "dist_m"} <= set(p) and p["kind"] in KINDS
            return f"{len(s['pois'])} nearest services"

        @check("C", "GET /buildings/{id}/similar?k=5")
        def _():
            s = get(f"/buildings/{state['id']}/similar", params={"k": 5}).json()
            assert isinstance(s, list) and len(s) <= 5
            for item in s:
                assert {"id", "label", "score", "display_status", "photo"} <= set(item)
            return f"{len(s)} similar" + (" (embeddings not built yet)" if not s else "")

        @check("C", "GET /streets/{street}/summary")
        def _():
            s = get(f"/streets/{state['street']}/summary").json()
            assert set(s) == {"total", "processed", "likely_underused", "review", "confirmed", "home"}
            assert all(isinstance(v, int) for v in s.values()) and s["total"] >= 1
            return str(s)
    else:
        print("skip: no buildings in Atlas, so the per-building checks are not run")

    @check("C", "GET /review-queue")
    def _():
        q = get("/review-queue").json()
        assert isinstance(q, list) and all(b["display_status"] == "review" for b in q)
        return f"{len(q)} waiting"

    @check("C", "GET /context-buildings")
    def _():
        fc = get("/context-buildings").json()
        assert fc["type"] == "FeatureCollection"
        return f"{len(fc['features'])} context buildings" + (" (C4 not done yet)" if not fc["features"] else "")

    @check("C", "GET /eval")
    def _():
        e = get("/eval").json()
        assert isinstance(e["rows"], list) and isinstance(e["escalated"], int)
        assert re.fullmatch(r"\d+/\d+", e["agreement"]) and re.fullmatch(r"\d+/\d+", e["shop_confirmed"]), e
        return f"agreement {e['agreement']}, escalated {e['escalated']}, shop {e['shop_confirmed']}" + (
            " (C4 not done yet)" if not e["rows"] else "")

    # --- B's endpoints --------------------------------------------------------
    w = args.walker

    @check("B", f"GET /walkers/{w}")
    def _():
        r = get(f"/walkers/{w}")
        assert r.status_code == 200, f"HTTP {r.status_code}"
        d = r.json()
        assert {"walker", "stats", "awards", "progress"} <= set(d), sorted(d)
        assert {"distance_m", "minutes", "facades", "streets", "floors_scanned", "streak_days"} <= set(d["stats"])
        assert all({"badge_id", "current", "target"} <= set(p) for p in d["progress"])

    @check("B", f"GET /walkers/{w}/walks has captures and never AI status fields")
    def _():
        r = get(f"/walkers/{w}/walks")
        assert r.status_code == 200, f"HTTP {r.status_code}"
        walks = r.json()
        assert isinstance(walks, list)
        for walk in walks:
            for c in walk["captures"]:
                assert {"building_id", "lon", "lat", "t", "thumb"} <= set(c)
        leaked = re.findall(r'"(upper_status|display_status|upper_signals|needs_human|verifier)"', r.text)
        assert not leaked, f"AI fields in a walker view: {sorted(set(leaked))}"
        return f"{len(walks)} walks"

    @check("B", "GET /badges is the catalog with the nine fixed ids")
    def _():
        r = get("/badges")
        assert r.status_code == 200, f"HTTP {r.status_code}"
        d = r.json()
        ids = {b["id"] for b in (d.values() if isinstance(d, dict) else d)} if not isinstance(d, dict) or "badges" not in d \
            else {b["id"] for b in d["badges"]}
        assert BADGES <= ids, f"missing {sorted(BADGES - ids)}"

    # --- events and writes ----------------------------------------------------
    @check("C", "GET /events is an SSE stream")
    def _():
        with requests.get(api + "/events", stream=True, timeout=10) as r:
            assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")

    def listen(seconds: float) -> tuple[list, threading.Thread]:
        seen: list[tuple[str, dict]] = []

        def run():
            try:
                with requests.get(api + "/events", stream=True, timeout=seconds + 5) as r:
                    event, end = None, time.time() + seconds
                    for line in r.iter_lines(decode_unicode=True):
                        if line.startswith("event:"):
                            event = line[6:].strip()
                        elif line.startswith("data:"):
                            seen.append((event, json.loads(line[5:])))
                        if time.time() > end:
                            return
            except requests.RequestException:
                pass
        t = threading.Thread(target=run, daemon=True)
        t.start()
        time.sleep(1.0)
        return seen, t

    if args.write and features:
        @check("C", "POST /buildings/{id}/human-label (same value) publishes building.updated")
        def _():
            seen, t = listen(6)
            r = requests.post(f"{api}/buildings/{state['id']}/human-label", json={"label": first["human_label"]}, timeout=30)
            assert r.status_code == 200 and r.json()["human_label"] == first["human_label"], r.text[:200]
            t.join()
            assert ("building.updated", {"id": state["id"]}) in seen, seen

        @check("B", f"POST /walkers/{w}/evaluate")
        def _():
            r = requests.post(f"{api}/walkers/{w}/evaluate", timeout=30)
            assert r.status_code == 200 and isinstance(r.json()["awards"], list), f"HTTP {r.status_code} {r.text[:150]}"

    if args.inspect:
        @check("C", f"POST /buildings/{args.inspect}/inspection publishes the three event types")
        def _():
            seen, t = listen(6)
            r = requests.post(f"{api}/buildings/{args.inspect}/inspection",
                              json={"outcome": "confirmed_candidate", "note": "smoke test"}, timeout=30)
            assert r.status_code == 200, f"HTTP {r.status_code} {r.text[:200]}"
            body = r.json()
            assert set(body) == {"building", "awards"} and body["building"]["display_status"] == "confirmed"
            t.join()
            kinds = [e for e, _ in seen]
            assert "building.updated" in kinds and ("inspection.recorded", {"id": args.inspect, "outcome": "confirmed_candidate"}) in seen, seen
            assert kinds.count("badge.awarded") == len(body["awards"]), seen
            return f"{len(body['awards'])} awards"

    # --- agent and MCP --------------------------------------------------------
    if not args.skip_agent and features:
        @check("C", "POST /agent/ask streams >= 2 tool calls with db_op and ms, then done")
        def _():
            events = list(sse("POST", f"{api}/agent/ask", {"question": f"Where on {state['street']} should we inspect first?"}))
            kinds = [e for e, _ in events]
            calls = [d for e, d in events if e == "tool_call"]
            res = [d for e, d in events if e == "tool_result"]
            assert kinds[-1] == "done" and not events[-1][1].get("error"), events[-1]
            assert len(calls) >= 2 and len(res) >= 2, f"{len(calls)} tool calls"
            assert all({"id", "name", "args"} <= set(d) for d in calls)
            assert all({"id", "name", "ms", "db_op", "summary"} <= set(d) and d["ms"] is not None and d["db_op"] for d in res)
            return f"{len(calls)} tool calls: " + ", ".join(f"{d['name']} ({d['db_op']}, {d['ms']} ms)" for d in res)

    if not args.skip_mcp:
        @check("C", "MCP server lists 8 tools and every result has trace {db_op, ms}")
        def _():
            from agents.mcp import MCPServerStreamableHttp

            async def go():
                async with MCPServerStreamableHttp({"url": args.mcp}, client_session_timeout_seconds=30) as s:
                    names = {t.name for t in await s.list_tools()}
                    assert names == {"street_candidates", "building", "services_nearby", "review_queue", "street_summary",
                                     "grant_info", "similar_facades", "public_registers"}, sorted(names)
                    out = json.loads((await s.call_tool("grant_info", {})).content[0].text)
                    assert set(out["trace"]) == {"db_op", "ms"} and "sdcc.ie" in out["official_faq"]
                    return len(names)
            return f"{asyncio.run(go())} tools"

    failed = [r for r in results if not r[0]]
    by_owner = {o: sum(1 for r in failed if r[1] == o) for o in ("C", "B")}
    print(f"\n{len(results) - len(failed)} ok, {len(failed)} failed (C: {by_owner['C']}, B: {by_owner['B']})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

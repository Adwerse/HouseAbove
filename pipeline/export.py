#!/usr/bin/env python3
"""Static snapshot for the front end's static mode (A runs `npm run sync-data`).

    python pipeline/export.py [--api http://127.0.0.1:8000] [--out data/export]

Writes, in data/export/:
  buildings.geojson   same as GET /api/buildings (no embedding)
  context.geojson     surrounding OSM buildings (pipeline/geo.py)
  pois.json           [{id, kind, name, lat, lon}]
  summary.json        {"streets": {<street>: GET /streets/<street>/summary}, "all": {...}}
  eval.json           same as GET /api/eval
  walkers/<id>.json   {profile: GET /walkers/<id>, walks: GET /walkers/<id>/walks, awards}
  photos/             copies of data/photos_web (1024 px, no EXIF). Git-ignored: the contract
                      says never commit photos, so A gets them another way (or the team decides).
  agent/              the cached agent runs (written by the API / scripts/record_demo.py)
Walker files come from the running API (B's routes) so shapes match; if the API or those
routes are not available the raw walkers, walks and awards collections are written instead.
"""
import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import repo  # noqa: E402
from app.db import get_db  # noqa: E402

log = logging.getLogger("export")
DEFAULT_OUT = ROOT / "data" / "export"


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def walker_files(db, api: str, out: Path) -> tuple[int, int]:
    """-> (walkers written from the API, walkers written from raw collections)."""
    from_api = raw = 0
    for walker in db.walkers.find():
        wid = walker["_id"]
        try:
            profile = requests.get(f"{api}/api/walkers/{wid}", timeout=15)
            walks = requests.get(f"{api}/api/walkers/{wid}/walks", timeout=15)
            if profile.status_code != 200 or walks.status_code != 200:
                raise RuntimeError(f"HTTP {profile.status_code} / {walks.status_code}")
            data = {"profile": profile.json(), "walks": walks.json(), "awards": profile.json().get("awards", [])}
            from_api += 1
        except (requests.RequestException, RuntimeError, ValueError) as exc:
            log.warning("%s: walker routes not usable (%s): wrote the raw collections", wid, exc)
            data = {"profile": {"walker": repo.to_json(walker)},
                    "walks": repo.to_json(list(db.walks.find({"walker_id": wid}))),
                    "awards": repo.to_json(list(db.awards.find({"walker_id": wid})))}
            raw += 1
        write_json(out / "walkers" / f"{wid}.json", data)
    return from_api, raw


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--photos-web", type=Path, default=ROOT / "data" / "photos_web")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    out, db = args.out, get_db()

    fc = repo.buildings_geojson(db=db)
    write_json(out / "buildings.geojson", fc)
    context = repo.context_buildings()
    write_json(out / "context.geojson", context)
    pois = [{"id": p["_id"], "kind": p["kind"], "name": p["name"], "lat": p["location"]["coordinates"][1],
             "lon": p["location"]["coordinates"][0]} for p in db.pois.find()]
    write_json(out / "pois.json", pois)
    streets = sorted({b["street"] for b in repo.list_buildings(db=db) if b["street"]})
    total = {k: 0 for k in ("total", "processed", "likely_underused", "review", "confirmed", "home")}
    summaries = {}
    for street in streets:
        summaries[street] = repo.street_summary(street, db)
        for k in total:
            total[k] += summaries[street][k]
    write_json(out / "summary.json", {"streets": summaries, "all": total})
    write_json(out / "eval.json", repo.eval_summary(db))
    from_api, raw = walker_files(db, args.api.rstrip("/"), out)

    photos = sorted(args.photos_web.glob("*.jpg")) if args.photos_web.is_dir() else []
    (out / "photos").mkdir(parents=True, exist_ok=True)
    for p in photos:
        shutil.copy2(p, out / "photos" / p.name)
    agent_src = DEFAULT_OUT / "agent"
    if agent_src.exists() and agent_src.resolve() != (out / "agent").resolve():
        shutil.copytree(agent_src, out / "agent", dirs_exist_ok=True)
    runs = len(list((out / "agent").glob("*.jsonl"))) if (out / "agent").exists() else 0

    print(f"export -> {out}: {len(fc['features'])} buildings, {len(context['features'])} context, {len(pois)} pois, "
          f"{len(streets)} streets, {from_api + raw} walkers ({from_api} via API, {raw} raw), {len(photos)} photos, "
          f"{runs} cached agent runs")
    if not runs:
        log.warning("no cached agent runs yet: run backend/scripts/record_demo.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())

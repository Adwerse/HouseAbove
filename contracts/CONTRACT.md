CONTRACT
Один и тот же блок для всех. Вставляется целиком под промптом №1. C коммитит его в contracts/CONTRACT.md в первые 10 минут, дальше агенты читают его из репозитория.

# HomesAbove CONTRACT v1.1 (frozen at 12:15; changes only by team agreement)

## Ownership (edit only your paths)
A: web/** except web/src/walker/**
B: web/src/walker/**, backend/app/gamification/**, walker/**, data/labels.csv, data/photos/ (shared folder, never in git)
C: backend/** except backend/app/gamification/**, pipeline/**, data/export/**, data/cache/**, data/photos_web/
Single owner of shared files: web/package.json + lockfile (A), backend/requirements.txt (C), backend/app/main.py (C), .env.example (C), README.md (A), contracts/ (team).
C creates stub files for B in step 0; after that push they belong to B. A creates web/src/walker/index.tsx placeholder in step 0; after that push it belongs to B.

## Git
Trunk on main. Small commits. git pull --rebase before every push. Never run repo-wide formatters or lint --fix outside your paths. Never commit .env or photos. Need a change in someone else's file: ask the owner.

## Runtime
web :5173 (Vite proxy /api and /photos -> :8000) | API :8000 | MCP :8001 (streamable HTTP, path /mcp)
All model inference goes through TensorX (OpenAI-compatible, EU-hosted). No OpenAI key at runtime. chat.completions only.
Env: MONGODB_URI, TENSORX_API_KEY, TENSORX_BASE_URL, VISION_MODEL, VERIFIER_MODEL, AGENT_MODEL, EMBED_MODEL, EMBED_DIM, DEMO_CACHE=0|1, VITE_DATA_MODE=api|static, VITE_DEMO_WALKER
Python modules C provides in step 0: backend/app/db.py get_db() -> pymongo Database; backend/app/events.py publish(type, payload), subscribe()

## MongoDB Atlas M0 (db "homesabove"). Never replace documents; $set only fields you own.
buildings: _id = photo stem, e.g. "talbot_12"
 C: label ("Talbot St 12"), street, location{Point [lon,lat]}, footprint (Polygon|null), geo_method, photo ("/photos/<id>.jpg"), source,
    ground_floor, upper_floors, upper_status (likely_underused|likely_used|unclear), upper_signals[],
    separate_entrance (yes|no|unclear), confidence, evidence, verifier{agree, for_use[], against_use[], status, model},
    needs_human, services{bus_m, grocery_m, school_m, gp_or_pharmacy_m, park_m, score}, registers{derelict, protected},
    rank, height_m, embedding[EMBED_DIM], models{vision, verifier},
    human_label, shop_staff_answer, inspection{outcome (confirmed_candidate|not_suitable|returned_to_use), note, at}
 B: captured_by, captured_at, walk_id, phash
pois: {_id, kind (bus|grocery|school|gp_or_pharmacy|park), name, location{Point}}   (C)
walkers: {_id e.g. "w_rodion", name, town}   (B)
walks: {_id, walker_id, started_at, ended_at, path{LineString}, times[], distance_m, building_ids[]}   (B)
awards: {_id, walker_id, badge_id, building_id|null, at, reason}, unique (walker_id, badge_id, building_id)   (B)
Indexes: buildings.location 2dsphere, pois.location 2dsphere, vector index "facade_vec" on buildings.embedding (EMBED_DIM, cosine, filters: street, upper_status).
models.vision and verifier.model must be different model families.

## Display status (derive identically everywhere)
inspection.outcome returned_to_use -> home; confirmed_candidate -> confirmed; not_suitable -> likely_used;
else needs_human && !human_label -> review; else human_label ?? upper_status.
Colors: likely_underused #FF5A4E | review #FFB020 | unclear #94A3B8 | likely_used #475569 | confirmed #8B5CF6 | home #FFD166

## REST (/api, JSON)
GET  /buildings?street=&status=      GeoJSON FeatureCollection; properties = building minus embedding, plus display_status
GET  /buildings/{id}
GET  /buildings/{id}/services        {services, pois:[{kind, name, lat, lon, dist_m}]}
GET  /buildings/{id}/similar?k=5     [{id, label, score, display_status, photo}]
GET  /review-queue                   [building]
POST /buildings/{id}/human-label     {label}
POST /buildings/{id}/inspection      {outcome, note} -> {building, awards[]}
GET  /streets/{street}/summary       {total, processed, likely_underused, review, confirmed, home}
GET  /context-buildings              GeoJSON (properties.height_m)
GET  /eval                           {rows[], agreement:"X/N", escalated:Y, shop_confirmed:"Z/M"}
GET  /walkers/{id}                   {walker, stats{distance_m, minutes, facades, streets, floors_scanned, streak_days}, awards[], progress[{badge_id, current, target}]}
GET  /walkers/{id}/walks             [walk] with captures [{building_id, lon, lat, t, thumb}]; never AI status fields
POST /walkers/{id}/evaluate          -> {awards[]} (runs badge engine, publishes events)
GET  /badges                         catalog
GET  /events (SSE): building.updated{id} | inspection.recorded{id, outcome} | badge.awarded{walker_id, badge_id, building_id, title}
POST /agent/ask {question} (SSE): tool_call{id, name, args} | tool_result{id, name, ms, db_op, summary} | delta{text} | done{text}
Rule: the API route that creates awards publishes badge.awarded. Scripts call the API; they never publish events.

## Badge engine interface (B implements, C calls)
backend/app/gamification/engine.py
 evaluate_walker(db, walker_id) -> list[dict]           idempotent, returns only new awards
 on_inspection(db, building_id, outcome) -> list[dict]  homes_above for confirmed_candidate, lights_on for returned_to_use, to captured_by
 stats(db, walker_id) -> dict

## Badge catalog (ids fixed)
first_look       First Look        first facade captured
street_scout     Street Scout      10 facades
main_street      Main Street       20+ facades on one street
five_k           5K for Homes      5 km walked while capturing, cumulative
streak_3         Three-Day Streak  captures on 3 different days
local_knowledge  Local Knowledge   logged a shop-staff answer
second_look      Second Look       re-captured a facade first captured by another walker
homes_above      Homes Above       a facade you captured was confirmed by council inspection
lights_on        Lights On         a building you captured returned to use as homes

## Product rules (UI, prompts, agent)
Say "likely underused", "candidate for inspection", "services within walking distance". Never "vacant". Never state grant eligibility; link the official FAQ.
Badges reward walking and coverage, never "finding empty buildings".
Walker views show only the walker's own captures and coverage, never AI status. AI statuses and addresses appear only in the officer console.
The agent is read-only: it recommends; only humans record labels and inspections.
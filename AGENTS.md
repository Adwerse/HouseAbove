# HomesAbove — agent rules

Build for Ireland hackathon (OpenAI x Give(a)Go x Dogpatch Labs, Dublin, 4 Oct 2026).
`contracts/CONTRACT.md` is binding (v1.1, changes only by team agreement) and
`docs/BRIEF.md` is the product brief. Where they conflict the contract wins on
stack, ownership and interfaces. Feature freeze 15:00. Keep `main` runnable.

## Ownership (edit only your paths)

| Owner | Paths |
|---|---|
| A | `web/**` except `web/src/walker/**` |
| B | `web/src/walker/**`, `backend/app/gamification/**`, `walker/**`, `data/labels.csv`, `data/photos/` (shared folder, never in git) |
| C | `backend/**` except `backend/app/gamification/**`, `pipeline/**`, `data/export/**`, `data/cache/**`, `data/photos_web/` |

Single owner of shared files: `web/package.json` + lockfile (A),
`backend/requirements.txt` (C), `backend/app/main.py` (C), `.env.example` (C),
`README.md` (A), `contracts/` (team).

## Git

- Trunk on `main`. Small commits. `git pull --rebase` before every push.
- Never run repo-wide formatters or `lint --fix` outside your paths.
- Never commit `.env` or photos.
- Need a change in someone else's file: ask the owner.

## Runtime

- web :5173 (Vite proxies `/api` and `/photos` to :8000) | API :8000 | MCP :8001 (streamable HTTP, path `/mcp`).
- Backend runs from `backend/`: `uvicorn app.main:app --port 8000`.
- All model inference goes through TensorX (OpenAI-compatible, EU-hosted). No
  OpenAI key at runtime. `chat.completions` only.
- Env: `MONGODB_URI`, `TENSORX_API_KEY`, `TENSORX_BASE_URL`, `VISION_MODEL`,
  `VERIFIER_MODEL`, `AGENT_MODEL`, `EMBED_MODEL`, `EMBED_DIM`, `DEMO_CACHE`,
  `VITE_DATA_MODE`, `VITE_DEMO_WALKER`. See `.env.example`.
- MongoDB Atlas M0, db `homesabove`. Never replace documents; `$set` only the fields you own.
- Live updates: `app/events.py` `publish(type, payload)` / `subscribe()`, streamed
  by `GET /api/events` as `event: <type>` + `data: <payload json>`.
- Rule: the API route that creates awards publishes `badge.awarded`. Scripts call
  the API; they never publish events.

## Product rules (UI, prompts, agent)

- Say "likely underused", "candidate for inspection", "services within walking
  distance". Never "vacant". Never state grant eligibility; link the official FAQ.
- Badges reward walking and coverage, never "finding empty buildings".
- Walker views show only the walker's own captures and coverage, never AI status.
  AI statuses and addresses appear only in the officer console.
- The agent is read-only: it recommends; only humans record labels and inspections.
- `models.vision` and `verifier.model` must be different model families.
- Report ops honestly: similar search without the Atlas vector index falls back
  to in-Python cosine and reports `db_op: "cosine-fallback"`.
- Vision prompt rules, ranking, services scoring, eval method and the MCP tool
  list come from `docs/BRIEF.md`.

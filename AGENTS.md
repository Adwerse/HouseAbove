# HomesAbove — agent rules

Build for Ireland hackathon (OpenAI x Give(a)Go x Dogpatch Labs, Dublin, 4 Oct 2026).
`contracts/CONTRACT.md` is binding. `docs/BRIEF.md` is the product brief. If the
brief conflicts with the contract, the contract wins on stack, ownership and
interfaces. Feature freeze: 15:00. Keep `main` runnable.

> `contracts/CONTRACT.md` is still a placeholder. Until it is pasted, the
> ownership table, git rules and product rules below come from the C1 task
> prompt plus defaults, and must be reconciled with the contract.

## Ownership

| Path | Owner |
|---|---|
| `web/**` | A (React app, Vite on http://localhost:5173) |
| `backend/app/gamification/**` | B (stubs created by C once, then B's) |
| `backend/**` except `backend/app/gamification/**` | C |
| `pipeline/**`, `data/export/**`, `data/cache/**`, `data/photos_web/` | C |
| `walker/**` | not named in the C1 prompt, owner TBD |
| `contracts/**`, `docs/**` | shared; change only by agreement |

Never edit another person's paths. If you need a change there, ask the owner.

## Git rules (defaults until the contract is pasted)

- Work on `main`, small commits, keep `main` runnable.
- `git pull --rebase` before every push. Never force-push.
- Never commit secrets: `.env` is ignored, `.env.example` lists the variables.
- Never commit `data/photos/`, `data/photos_web/`, `data/cache/`, `node_modules/`, `.venv/`.

## Product rules

- Stack: Python 3.11 + FastAPI backend (`backend/`, run from `backend/` with
  `uvicorn app.main:app`), React front end (`web/`), MongoDB Atlas.
- All inference goes through TensorX (OpenAI-compatible, `TENSORX_BASE_URL`).
  Models come from env: `VISION_MODEL`, `VERIFIER_MODEL`, `AGENT_MODEL`, `EMBED_MODEL`.
- The agent runs inside the API, not as a separate process.
- MongoDB is the source of truth. `buildings.json` is only an export (`data/export/`).
- Live updates go through the in-process event bus (`app/events.py`) and `GET /api/events` (SSE).
- Be honest in reported ops: similar search without the Atlas vector index
  falls back to in-Python cosine and reports `db_op: "cosine-fallback"`.
- Vision prompt rules, ranking, services scoring, eval method and the MCP tool
  list come from `docs/BRIEF.md`.

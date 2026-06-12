# Deploying NoScroll on Railway

**Step-by-step UI walkthrough:** see **`DEPLOY_RAILWAY_STEPS.md`** in this repo.

Two services: **API** (Python/FastAPI) and **Frontend** (static Vite build behind nginx).

## Shared demo identity (forced for all visitors)

Everyone uses the same browser identity so **seeded friends, collections, and Friends’ Picks** match the API.

| Variable | Value (keep in sync) |
|----------|----------------------|
| `DEMO_USER_TOKEN` (backend) | `a1b2c3d4-e5f6-4789-a012-3456789abcde` |
| `VITE_DEMO_USER_TOKEN` (frontend build) | same |
| `VITE_USE_DEMO_USER` (frontend build) | `true` |

Optional backend overrides: `DEMO_USER_HANDLE` (default `demo`), `DEMO_USER_DISPLAY_NAME` (default `Demo explorer`).

## 1. API service

1. New project → **Deploy from GitHub** → select this repo.
2. Add a **service** → **Dockerfile** → set root directory to **`backend`** (or configure Dockerfile path to `backend/Dockerfile`).
3. **Variables** (minimum):
   - `SEED_FRIENDS_ON_STARTUP` = `true`
   - `DEMO_USER_TOKEN` = `a1b2c3d4-e5f6-4789-a012-3456789abcde`
4. **Volume**: mount a volume at **`/app/data`** so `noscroll.db` survives restarts and redeploys.
5. Deploy and copy the **public HTTPS URL** of the API (e.g. `https://xxx.up.railway.app`).

**Note:** First boot downloads `sentence-transformers` / model weights — may take memory and time. Upgrade instance RAM if the process exits (OOM).

## 2. Frontend service

1. New service from same repo.
2. **Dockerfile** path: **`frontend/Dockerfile`** (root directory `frontend`).
3. **Build arguments / variables** for the build step (names must match `ARG` in Dockerfile):

   - `VITE_API_URL` = your API URL, e.g. `https://xxx.up.railway.app`
   - `VITE_USE_DEMO_USER` = `true`
   - `VITE_DEMO_USER_TOKEN` = `a1b2c3d4-e5f6-4789-a012-3456789abcde`

4. Deploy and open the **frontend** public URL.

## CORS

The API already allows all origins (`allow_origins=["*"]`). No change needed for a separate frontend URL.

## Local Docker (optional)

From repo root:

```bash
docker build -t noscroll-api ./backend
docker run --rm -p 8000:8000 -e SEED_FRIENDS_ON_STARTUP=true \
  -v noscroll-data:/app/data noscroll-api
```

```bash
docker build -t noscroll-web ./frontend \
  --build-arg VITE_API_URL=http://localhost:8000 \
  --build-arg VITE_USE_DEMO_USER=true \
  --build-arg VITE_DEMO_USER_TOKEN=a1b2c3d4-e5f6-4789-a012-3456789abcde
docker run --rm -p 8080:80 noscroll-web
```

## Content corpus

The API ships **`backend/data/noscroll.seed.db.gz`** (full local corpus: contents + embeddings). On startup, when `CONTENT_DB_SEED_VERSION` changes, the API **merges** that seed into `/app/data/noscroll.db` (profile/friends tables are preserved).

- Default in root `Dockerfile`: `CONTENT_DB_SEED_VERSION=2025-06-12`
- To push a new corpus later: replace the `.gz`, bump the version env on the API service, redeploy once
- Marker file on the volume: `/app/data/.content_db_seed_version` (prevents re-merge on every restart)

If the DB is **empty** and no seed version is set, the older JSON fallback (`CONTENT_SEED_FILE`) still loads `creative_content_metadata.json`.

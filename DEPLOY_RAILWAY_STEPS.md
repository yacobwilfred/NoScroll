# Railway deploy — follow in order

You need **one login**: a **Railway** account linked to **GitHub** (same account that owns `yacobwilfred/NoScroll`).

---

## A. Log in to Railway

1. Open **[railway.app](https://railway.app)** → **Login**.
2. Choose **Login with GitHub** and approve access when GitHub asks.
3. The first time you deploy, GitHub may ask you to **install the Railway app** and pick which repos Railway can see — choose **only `NoScroll`** or **All repositories** (your choice).

---

## B. Create a project and deploy the API (backend)

1. **New Project** → **Deploy from GitHub repo**.
2. Select **`NoScroll`** (or `yacobwilfred/NoScroll`).
3. Railway may create one service — click it and open **Settings**:
   - **Root Directory** → set to **`backend`** (important).
   - **Builder** → **Dockerfile** (path `Dockerfile` inside `backend`).
4. Open the **Variables** tab and add:

   | Name | Value |
   |------|--------|
   | `SEED_FRIENDS_ON_STARTUP` | `true` |
   | `DEMO_USER_TOKEN` | `a1b2c3d4-e5f6-4789-a012-3456789abcde` |

5. Open **Volumes** (or **Settings → Volume**):
   - **Mount path:** `/app/data`
   - Create and attach the volume so SQLite survives restarts.

6. **Deploy** (or **Redeploy**). Wait until the build finishes (first deploy may take several minutes — ML dependencies).

7. Open **Settings → Networking → Generate Domain** (or **Public Networking**) so the API gets a URL like `https://something.up.railway.app`.

8. **Copy that HTTPS URL** — you need it for the frontend. Test in a browser:  
   `https://YOUR-API-URL/health` → should show `{"status":"ok"}`.

---

## C. Deploy the frontend (second service)

1. In the **same Railway project**, click **New** → **GitHub Repo** → select **`NoScroll`** again (second service from same repo).
2. **Settings**:
   - **Root Directory** → **`frontend`**
   - **Builder** → **Dockerfile**
3. **Variables** — add these (same names, exact spelling):

   | Name | Value |
   |------|--------|
   | `VITE_API_URL` | `https://YOUR-API-URL` ← paste the API URL from step B8 (**no trailing slash**) |
   | `VITE_USE_DEMO_USER` | `true` |
   | `VITE_DEMO_USER_TOKEN` | `a1b2c3d4-e5f6-4789-a012-3456789abcde` |

4. **Important:** These must be available when **Docker builds** the image (Vite bakes them in). In Railway:
   - Open each variable → if you see **“Available at Build Time”** / **Build** — enable it for all three, **or**
   - Add them in a **Build** section if your UI separates build vs runtime variables.

5. **Generate Domain** for this service too. That URL is what you share with testers (the **frontend**).

6. Redeploy after changing `VITE_*` variables so the static bundle rebuilds.

---

## D. Quick checks

- Frontend URL loads the app.
- **Friends’ Picks** / **Profile** work (demo user + seeded friends).
- **New Prompt** may need content in the DB on the server; if directions are empty, see **Content corpus** in `RAILWAY.md`.

---

## If something fails

### Build failed (red error on the service card)

1. Click the **NoScroll** service → **Deployments** → the failed deployment → **Build logs** (or **View logs**).
2. Scroll to the **last red / error lines** — that is the real reason (missing package, OOM, wrong root directory, etc.).
3. **Root directory** for the API service must be **`backend`** so Railway finds `backend/Dockerfile` and `requirements.txt`. If it’s empty or `.`, the build will fail.

Common fixes:

- **Out of memory / killed** during `pip install` or torch: in Railway → service → **Settings** → increase **memory** for the build, or use a paid plan with a larger builder; then **Redeploy**.
- After we updated the repo Dockerfile (CPU PyTorch + XML libs), **push to GitHub** and trigger **Redeploy** so Railway rebuilds from the latest commit.

### Runtime issues

| Symptom | What to check |
|--------|----------------|
| Frontend **502** / **Application failed** | Frontend logs; nginx must listen on `$PORT` (this repo uses `nginx.conf.template`). |
| Frontend calls **localhost** | Rebuild frontend with `VITE_API_URL` set to the **Railway API URL**, not localhost. |
| API **crashes / OOM** | Increase memory for the API service (sentence-transformers is heavy). |
| **CORS** errors | API already allows `*`; usually wrong `VITE_API_URL` (typo or http vs https). |

---

## What you must log in to

| Where | Why |
|-------|-----|
| **railway.app** | Deploy and manage services |
| **GitHub** (via Railway) | Let Railway read your repo |

No separate “NoScroll account” — identity is the demo token + localStorage in the browser.

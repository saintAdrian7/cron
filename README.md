# Astrid keep-alive

A tiny scheduled job that pings The Astrid **site** and **CMS** so Render's free
web services don't spin down. Render free web services sleep after ~15 minutes of
no inbound traffic and then cold-start (30–60s) on the next visitor; pinging every
10 minutes keeps them warm.

## What's here

| File | Purpose |
|---|---|
| `ping.mjs` | The pinger. Native `fetch` (Node ≥ 18), no dependencies. GETs every URL in `TARGETS`, retries on failure, exits non-zero if any are unreachable. |
| `render.yaml` | Render Blueprint that deploys this as a **Cron Job** (`*/10 * * * *`). |
| `.github/workflows/keepalive.yml` | Free alternative — runs the same `ping.mjs` on GitHub Actions. |
| `package.json` | `npm start` → `node ping.mjs`. |

## Configuration

One env var: **`TARGETS`** — a comma-separated list of URLs to GET. Use the cheap
health endpoints:

```
https://<your-site>.onrender.com/api/health,https://<your-cms>.onrender.com/api/health
```

- The **site** `/api/health` returns `{ ok: true, service: "site" }` (added to the site repo for this purpose).
- The **CMS** `/api/health` returns `{ ok, db }` and also checks the database connection, so it keeps the DB warm too.

Optional tuning (defaults in parentheses): `TIMEOUT_MS` (60000), `RETRIES` (2),
`RETRY_DELAY_MS` (5000). The timeout is deliberately generous because the first
ping after a sleep has to wait for the cold start.

## Run locally

```bash
TARGETS="https://example.com" node ping.mjs
```

## Deploy on Render (Cron Job)

> ⚠️ Render **Cron Jobs run on a paid instance** — they are not part of the free
> tier. If you want this for $0, use the GitHub Actions option below instead.

1. Push this folder to its own Git repo (GitHub/GitLab).
2. Render Dashboard → **New → Blueprint**, point it at the repo. It reads
   `render.yaml` and creates the `astrid-keepalive` cron job.
   *(Or: New → Cron Job, runtime Node, build `npm install`, start `node ping.mjs`,
   schedule `*/10 * * * *`.)*
3. On the service, set the **`TARGETS`** env var to your real site + CMS URLs.
4. Deploy. Use **Trigger Run** once to confirm the logs show `ok ... -> 200`.

The schedule is UTC. `*/10 * * * *` = every 10 minutes.

## Deploy free (GitHub Actions)

1. Put this repo on GitHub.
2. Settings → **Secrets and variables → Actions → Variables** → add a variable
   `TARGETS` with the comma-separated URLs.
3. The workflow runs every 10 min (and via **Run workflow** manually).

Caveats: scheduled Actions can be delayed a few minutes under load, and GitHub
disables scheduled workflows after 60 days of repo inactivity (any commit or
manual run re-enables them).

## Notes

- Keeping a free web service awake 24/7 uses ~720 of the 750 free instance-hours
  Render grants per month — fine for one service, but watch the total if you keep
  several awake.
- Render Postgres free databases don't "sleep" like web services, but the CMS
  health check connecting to the DB is harmless and confirms end-to-end health.
- A no-deploy alternative to either option: a free uptime monitor such as
  cron-job.org or UptimeRobot hitting the same two `/api/health` URLs.

# Deploying On TrueNAS 25.10.1

This app is set up for a Docker-based custom app deployment on TrueNAS 25.10.1.

## Recommended Approach

Use the TrueNAS Apps flow for a custom application and install via YAML with the contents of [docker-compose.truenas.yml](/C:/Users/jaxtm/OneDrive/Documents/New%20project/docker-compose.truenas.yml).

Before using that YAML, build this app image and push it to a registry your TrueNAS server can reach, then replace:

- `ghcr.io/your-org/nba-referee-analytics:latest`

Before deploying:

- push the app image to a reachable registry first
- replace `POOL` with your actual pool name
- replace the Postgres password
- replace the admin token
- make sure the mounted appdata paths exist and are writable

## What Runs

- `app`: the Node dashboard and sync service
- `db`: PostgreSQL for persistent storage

## Persistence

The app persists:

- PostgreSQL data in `/mnt/POOL/appdata/nba-ref-analytics/postgres`

The database volume is the source of truth on TrueNAS. The container's local file cache can be treated as disposable.

## Admin Access

If you set `ADMIN_TOKEN`, the dashboard's `Admin` tab supports secure browser sign-in and protected manual sync actions. The legacy token query flow still works for API callers:

```text
POST /api/admin/sync?token=YOUR_TOKEN
```

The `Admin` tab also supports one-time backfills with custom `from`, `to`, and `max games` overrides. Set `max games` to `0` to include every completed game in the selected range.

## Notes

- The app can serve from PostgreSQL first, then local cache, then seeded data as a final fallback.
- Background syncing is controlled with `AUTO_SYNC`, `SYNC_LOOKBACK_DAYS`, `SYNC_MAX_GAMES`, and `SYNC_INTERVAL_MINUTES`.
- New syncs preserve older games in PostgreSQL and only refresh the game IDs included in the current run.
- Stale-data warnings can be tuned with `SYNC_STALE_HOURS`.
- Admin session lifetime and cookie signing can be tuned with `ADMIN_SESSION_TTL_HOURS` and `ADMIN_SESSION_SECRET`.
- TrueNAS 25.10 supports custom apps installed from Docker Compose-style YAML in the Apps UI.

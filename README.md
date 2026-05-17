# WhistleIQ

A working NBA officiating analytics app with:

- a web dashboard
- live NBA sync jobs
- PostgreSQL-backed persistence
- coach's challenge tracking
- Last Two Minute correctness overlays
- Docker and TrueNAS deployment assets

## What The App Does

- Tracks foul events with referee, penalized player/team, benefited player/team, quarter, and score at whistle
- Lets you inspect game timelines, referee tendencies, and player/team exposure
- Includes score-state filters such as clutch, tie, one-possession, close game, and blowout
- Includes possession-adjusted whistle rate and expected-vs-actual signal views so raw counts are not the only story
- Syncs live game schedules, crews, play-by-play, raw events, coach's challenges, and L2M review rows
- Persists synced datasets in PostgreSQL when `DATABASE_URL` is configured
- Keeps previously synced games in PostgreSQL and refreshes only the games included in each new sync
- Supports recurring background syncs, signed admin sessions, and manual sync controls from the dashboard

## Run It

From the project root:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Sync Real NBA Data

To sync real completed games from NBA CDN:

```bash
npm run sync:live -- --from=2026-05-01 --to=2026-05-05 --max-games=4
```

To backfill all completed games in a range, set `max-games` to `0`:

```bash
npm run sync:live -- --from=2025-10-21 --to=2026-04-13 --max-games=0
```

What this does:

- pulls completed games from the official NBA schedule JSON
- fetches live boxscore and play-by-play JSON for each selected game
- attempts to fetch L2M review JSON where available
- normalizes referees, players, teams, raw events, foul events, challenge events, and L2M overlays
- writes the result to [data/liveData.json](/C:/Users/jaxtm/OneDrive/Documents/New%20project/data/liveData.json)
- writes the dataset into PostgreSQL when `DATABASE_URL` is set
- preserves previously synced games and only replaces the game IDs included in the current sync run

Load order:

- PostgreSQL cumulative retained dataset
- local [data/liveData.json](/C:/Users/jaxtm/OneDrive/Documents/New%20project/data/liveData.json) cache
- synthetic sample data fallback

## Environment

See [.env.example](/C:/Users/jaxtm/OneDrive/Documents/New%20project/.env.example).

Important variables:

- `DATABASE_URL`: enables PostgreSQL persistence
- `AUTO_SYNC`: runs sync automatically on server startup and interval
- `SYNC_LOOKBACK_DAYS`: rolling date window for background sync
- `SYNC_MAX_GAMES`: max completed games per sync run
- `SYNC_INTERVAL_MINUTES`: recurring sync interval
- `SYNC_STALE_HOURS`: overrides when the app starts flagging stale data
- `ADMIN_TOKEN`: required for admin sign-in and manual sync actions
- `ADMIN_SESSION_SECRET`: optional override for signing admin session cookies
- `ADMIN_SESSION_TTL_HOURS`: admin browser session lifetime

## Docker

Local Docker stack:

```bash
docker compose up --build
```

This starts:

- `app`: the Node dashboard and sync service
- `db`: PostgreSQL 16

Verified locally:

- the Docker build succeeds
- both containers start healthy
- the app reports `databaseEnabled=true`
- the containerized app synced live data into Postgres and served it successfully

## TrueNAS 25.10.1

Use [docker-compose.truenas.yml](/C:/Users/jaxtm/OneDrive/Documents/New%20project/docker-compose.truenas.yml) with the TrueNAS Apps custom YAML flow. Build and push the app image to a registry first, then replace the placeholder image reference in that file. Deployment notes are in [docs/truenas-deploy.md](/C:/Users/jaxtm/OneDrive/Documents/New%20project/docs/truenas-deploy.md).

## Project Structure

- [server.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/server.js) serves the frontend and local JSON API
- [db/repository.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/db/repository.js) manages PostgreSQL schema creation and dataset persistence
- [data/sampleData.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/data/sampleData.js) contains the seeded games, crews, players, and foul events
- [data/liveSync.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/data/liveSync.js) fetches live schedule, boxscore, play-by-play, and L2M data
- [data/transformLiveData.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/data/transformLiveData.js) normalizes real NBA payloads into the app dataset
- [data/loadDataset.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/data/loadDataset.js) switches between database, live cached data, and the sample fallback
- [public/app.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/public/app.js) renders the dashboard
- [public/analytics.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/public/analytics.js) contains the client-side analytics helpers
- [scripts/sync-live-data.js](/C:/Users/jaxtm/OneDrive/Documents/New%20project/scripts/sync-live-data.js) runs manual sync jobs
- [docker-compose.yml](/C:/Users/jaxtm/OneDrive/Documents/New%20project/docker-compose.yml) starts the local app and database stack
- [docs/product-spec.md](/C:/Users/jaxtm/OneDrive/Documents/New%20project/docs/product-spec.md) captures the broader roadmap and data model

## Current MVP Views

- `Overview`: call volume, quarter split, foul mix, top penalized teams, top beneficiaries, most active referees
- `Game Explorer`: full whistle timeline with quarter, clock, referee, score, challenge tags, and L2M decision tags
- `Referee Lens`: quarter splits and who that referee most often penalizes or benefits
- `Player / Team`: who gets whistles against or for a given player/team
- `Bias Lab`: possession-adjusted whistle signal table with shared exposure, confidence labels, and sample-size warnings
- `Close Games`: first-class dashboard for whistles in five-point games
- `Last Two`: first-class dashboard for late-game whistles
- `Admin`: signed admin login, sync control room, and stale-data / failure warnings
- `Retention`: persistent season-to-date storage with incremental game refreshes
- `Health / Sync APIs`: health, sync status, admin session, and admin-triggered sync

## Remaining Gaps

The app is now wired through live sync, persistence, recurring jobs, challenge tracking, and L2M overlays. The next highest-value upgrades would be:

- stronger challenge outcome inference beyond `unknown` when the live feed does not publish a clear resolution
- materialized analytical views or SQL endpoints for heavier queries
- clip/video linking beyond the official L2M video references

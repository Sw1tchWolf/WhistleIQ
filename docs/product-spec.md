# Product Spec: WhistleIQ

## Goal

Build an app that answers officiating questions at the event level, the game level, and the quarter level.

Primary goal:

- Track foul calls with enough context to analyze potential referee tendencies toward specific players, teams, and game situations.

Secondary goals:

- Support late-game review and call correctness overlays.
- Make the data explorable by casual users and credible enough for serious analysis.

## Core Questions

The app should be able to answer:

- Which referee calls the most personal fouls, shooting fouls, offensive fouls, loose-ball fouls, and technicals?
- Which players get called for fouls most often by a given ref?
- Which players draw fouls most often from a given ref?
- Which teams benefit or suffer most from a given ref?
- How do those patterns change by quarter?
- How do they change in close games versus blowouts?
- What is the score margin when those whistles happen?
- Which patterns remain after adjusting for context instead of looking only at raw totals?

## Recommended Product Shape

### 1. Game Explorer

For a single game, show:

- officiating crew
- quarter and game timeline
- every foul event
- referee who made the whistle
- foul type
- penalized player and team
- benefited player and team
- score at whistle
- score margin at whistle
- free throws awarded
- challenge or review outcome if applicable

### 2. Referee Profile

For a single referee, show:

- games worked
- total fouls called
- fouls by type
- fouls called by quarter
- top penalized players and teams
- top benefited players and teams
- home vs away split
- close-game split
- crew-partner split
- challenge overturn rate
- late-game correctness overlays when available

### 3. Player and Team Pages

For each player or team, show:

- most frequent refs against them
- most frequent refs benefiting them
- by-quarter patterns
- score-state patterns
- rates per game, per 48 minutes, and per 100 possessions

### 4. Bias Dashboard

This is where the app becomes much more valuable than a simple stat table.

Show both:

- raw counts
- expected-vs-actual residuals

Example:

- A player may draw many fouls from one ref simply because that player attacks the rim a lot.
- The real signal is whether the foul rate is unusually high after adjusting for the player's usage, opponent style, game state, and foul type.

## Data Model

The cleanest approach is to store both raw event data and a normalized foul-event table.

### Reference Tables

#### `teams`

- `id`
- `nba_team_id`
- `abbreviation`
- `city`
- `name`

#### `players`

- `id`
- `nba_player_id`
- `first_name`
- `last_name`
- `display_name`
- `primary_team_id`

#### `referees`

- `id`
- `nba_official_id`
- `first_name`
- `last_name`
- `display_name`
- `jersey_number`

### Game Tables

#### `games`

- `id`
- `nba_game_id`
- `season`
- `season_type`
- `game_date`
- `home_team_id`
- `away_team_id`
- `home_score_final`
- `away_score_final`
- `status`

#### `game_officials`

- `id`
- `game_id`
- `referee_id`
- `assignment_role`

Examples for `assignment_role`:

- `crew_chief`
- `referee`
- `umpire`
- `alternate`

### Event Tables

#### `raw_play_by_play_events`

Store the upstream event as close to original as possible.

- `id`
- `game_id`
- `source_event_id`
- `period`
- `clock`
- `action_type`
- `sub_type`
- `description`
- `home_score`
- `away_score`
- `score_margin`
- `official_id_raw`
- `team_id_raw`
- `person_id_raw`
- `payload_json`
- `occurred_at`

#### `foul_events`

This is the main analytics table.

- `id`
- `game_id`
- `raw_event_id`
- `period`
- `period_clock`
- `game_clock_seconds_elapsed`
- `referee_id`
- `foul_type`
- `foul_subtype`
- `penalized_team_id`
- `penalized_player_id`
- `benefited_team_id`
- `benefited_player_id`
- `home_score_at_whistle`
- `away_score_at_whistle`
- `score_margin_for_home`
- `leading_team_id`
- `is_home_whistle_against_home`
- `free_throws_awarded`
- `possession_team_id`
- `is_take_foul`
- `is_away_from_play`
- `is_in_bonus`
- `is_clutch`
- `challenge_reviewed`
- `challenge_overturned`
- `source_confidence`

### Optional Enrichment Tables

#### `last_two_minute_reviews`

- `id`
- `game_id`
- `foul_event_id`
- `period`
- `clock`
- `decision`
- `review_type`
- `notes`

Possible `decision` values:

- `correct_call`
- `incorrect_call`
- `correct_non_call`
- `incorrect_non_call`

#### `crew_combinations`

Useful if you want pre-aggregated crew analytics.

- `id`
- `game_id`
- `crew_hash`

## Important Modeling Choice

You asked for:

- which player was the foul against
- which player benefited from it

That is a very good product requirement, but it needs one careful rule:

- The penalized player is not always the same as the player directly involved in the action.
- The benefited player is sometimes obvious, like a shooting foul on the ball handler.
- In team-control, loose-ball, away-from-play, or defensive three-second situations, the benefited team can be clearer than the benefited player.

Recommended approach:

- Always store `benefited_team_id`.
- Store `benefited_player_id` only when the player is clearly attributable from the event data.
- Add a `source_confidence` or `attribution_confidence` field so analytics can exclude ambiguous events when needed.

## Ingestion Pipeline

### Step 1. Pull game and crew data

Use official schedule/boxscore sources to store:

- game metadata
- home/away teams
- officiating crew

### Step 2. Pull play-by-play

Store the raw event feed first.

This is important because:

- upstream formats change
- you may discover better normalization rules later
- you will want to reprocess old games without losing source data

### Step 3. Normalize foul events

For each foul-like event:

- map the event to a normalized `foul_type`
- identify the official if present
- infer penalized player/team
- infer benefited player/team
- stamp score and margin at whistle
- stamp quarter and clock

### Step 4. Enrich context

Add:

- close-game flags
- possession context
- bonus state
- home/away context
- player position and role
- opponent matchup context

### Step 5. Build aggregates

Precompute:

- referee by player matrices
- referee by team matrices
- quarter splits
- score-state splits
- crew splits

## Analytics You Should Definitely Include

### Basic

- total fouls called by ref
- fouls against each player by ref
- fouls drawn by each player by ref
- fouls against each team by ref
- fouls benefiting each team by ref
- quarter-by-quarter splits

### Better

- rates per game
- rates per 48 minutes
- rates per 100 possessions
- home vs away splits
- close-game vs non-close-game splits
- regular season vs playoffs splits

### Best

- expected-vs-actual foul rate models
- crew effect models
- ref-player interaction effects
- ref-team interaction effects
- challenge overturn tendencies
- late-game correctness overlays from review data

## Suggestions That Will Improve The App

### 1. Track more than fouls

If you only track fouls, you may miss important officiating patterns.

Eventually also track:

- technical fouls
- violations
- ejections
- coach's challenges
- replay reversals
- out-of-bounds reversals

### 2. Separate "bias" from "tendency"

This matters a lot analytically.

- A referee may look biased in raw counts but simply work many games involving a specific team.
- A player may look targeted because they defend aggressively.

Recommended language in the product:

- `tendency` for raw or descriptive stats
- `bias signal` only for adjusted or residual models

### 3. Add game leverage

Not every whistle matters equally.

Track:

- one-possession game
- final two minutes
- final five minutes
- overtime
- win probability swing if you later model it

### 4. Track referee crews

An individual official does not work alone.

Some patterns may be driven by:

- partner crews
- crew chief leadership
- assignment role

### 5. Add a manual review workflow

You will likely encounter ambiguous events.

Build an internal tool or admin panel where you can:

- inspect raw description
- see linked clip or video
- override player attribution
- mark confidence

### 6. Keep an audit trail

When a normalized event changes, save:

- previous attribution
- new attribution
- reason for change
- source version

This will make your analytics much more trustworthy.

## Recommended MVP Scope

Build this first:

1. Ingest games, officials, players, teams, and raw play-by-play.
2. Normalize foul events into one clean table.
3. Build a game page and a referee page.
4. Build quarter splits and score-state filters.
5. Add player and team breakdowns.

Defer this until later:

1. Advanced expected-vs-actual models.
2. Video review workflow.
3. Challenge and Last Two Minute overlays.
4. Crew interaction modeling.

## Suggested Technical Shape

If you want a practical stack for this app, a strong default is:

- `Next.js` for the app UI
- `PostgreSQL` for analytics-friendly relational storage
- `Prisma` or `Drizzle` for schema and queries
- `Python` or `TypeScript` ingestion jobs for play-by-play normalization
- scheduled ETL jobs for daily game ingestion

Why this works well:

- relational joins matter a lot here
- you will want ad hoc analytics and materialized views
- Postgres handles both normalized tables and JSON payload storage well

## Current External Inputs Worth Considering

As of May 5, 2026:

- NBA Official publishes referee assignments by game day.
- NBA Official publishes Last Two Minute reports for eligible games.
- NBA live/boxscore style feeds expose officiating crew data.
- NBA live play-by-play feeds expose action metadata that can be used for event-level normalization.

## Build Risks To Plan Around

- Some event records may not cleanly identify the benefited player.
- Some whistles may require inference from the event description.
- Referee attribution may be present for many actions but should still be validated during ingestion.
- Raw counts alone will produce misleading "bias" claims unless you normalize for context.

## Recommended Next Build Step

Choose one of these paths:

1. Product-first
   I scaffold the app with database schema, ingestion folders, and placeholder dashboard pages.
2. Data-first
   I build the schema and ingestion pipeline first so we can validate event attribution before UI work.
3. UI-first
   I build a demo dashboard with mocked data so we can lock the product shape before wiring live feeds.

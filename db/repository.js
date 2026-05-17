import { Pool } from "pg";

import { buildDatasetFromRecords } from "../data/transformLiveData.js";

let pool;

const schemaSql = `
CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  synced_at TIMESTAMPTZ NOT NULL,
  source_type TEXT NOT NULL,
  from_date DATE,
  to_date DATE,
  metadata_json JSONB NOT NULL,
  dataset_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  nba_team_id BIGINT,
  abbreviation TEXT NOT NULL,
  city TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  nba_player_id BIGINT,
  display_name TEXT NOT NULL,
  team_id TEXT,
  position TEXT
);

CREATE TABLE IF NOT EXISTS referees (
  id TEXT PRIMARY KEY,
  nba_official_id BIGINT,
  jersey_number TEXT,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  nba_game_id TEXT NOT NULL,
  season TEXT NOT NULL,
  season_type TEXT NOT NULL,
  game_date DATE NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  home_score_final INTEGER NOT NULL,
  away_score_final INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_officials (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  referee_id TEXT NOT NULL,
  assignment_role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_play_by_play_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  period INTEGER NOT NULL,
  clock TEXT NOT NULL,
  action_type TEXT NOT NULL,
  sub_type TEXT,
  description TEXT,
  home_score INTEGER,
  away_score INTEGER,
  score_margin INTEGER,
  possession_team_id TEXT,
  official_id_raw TEXT,
  team_id_raw TEXT,
  person_id_raw TEXT,
  payload_json JSONB NOT NULL,
  occurred_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS foul_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  raw_event_id TEXT NOT NULL,
  period INTEGER NOT NULL,
  period_clock TEXT NOT NULL,
  game_clock_seconds_elapsed INTEGER NOT NULL,
  referee_id TEXT,
  foul_type TEXT NOT NULL,
  foul_subtype TEXT NOT NULL,
  penalized_team_id TEXT,
  penalized_player_id TEXT,
  benefited_team_id TEXT,
  benefited_player_id TEXT,
  home_score_at_whistle INTEGER NOT NULL,
  away_score_at_whistle INTEGER NOT NULL,
  score_margin_for_home INTEGER NOT NULL,
  leading_team_id TEXT,
  is_home_whistle_against_home BOOLEAN NOT NULL,
  free_throws_awarded INTEGER NOT NULL,
  possession_team_id TEXT,
  is_take_foul BOOLEAN NOT NULL,
  is_away_from_play BOOLEAN NOT NULL,
  is_in_bonus BOOLEAN NOT NULL,
  is_clutch BOOLEAN NOT NULL,
  is_close_game BOOLEAN NOT NULL DEFAULT FALSE,
  is_last_two_minutes BOOLEAN NOT NULL DEFAULT FALSE,
  season TEXT,
  season_type TEXT,
  home_team_id TEXT,
  away_team_id TEXT,
  whistle_against_side TEXT,
  whistle_benefited_side TEXT,
  challenge_team_id TEXT,
  challenge_reviewed BOOLEAN NOT NULL,
  challenge_overturned BOOLEAN NOT NULL,
  challenge_outcome TEXT,
  challenge_target_type TEXT,
  challenge_outcome_source TEXT,
  challenge_inference_reason TEXT,
  challenge_inference_confidence NUMERIC(5,2),
  source_confidence NUMERIC(5,2) NOT NULL,
  description TEXT,
  l2m_decision TEXT,
  l2m_call_type TEXT,
  l2m_comment TEXT,
  l2m_video_url TEXT,
  correctness_bucket TEXT
);

CREATE TABLE IF NOT EXISTS challenge_events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  linked_raw_event_id TEXT,
  linked_foul_event_id TEXT,
  linked_referee_id TEXT,
  team_id TEXT,
  period INTEGER NOT NULL,
  period_clock TEXT NOT NULL,
  challenge_type TEXT NOT NULL,
  challenge_outcome TEXT NOT NULL,
  challenge_target_type TEXT,
  challenge_outcome_source TEXT,
  challenge_inference_reason TEXT,
  inference_confidence NUMERIC(5,2),
  challenge_overturned BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  payload_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS last_two_minute_reviews (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  foul_event_id TEXT,
  period INTEGER NOT NULL,
  clock TEXT NOT NULL,
  decision TEXT NOT NULL,
  call_type TEXT,
  review_type TEXT,
  committing_player_id TEXT,
  disadvantaged_player_id TEXT,
  comment TEXT,
  video_url TEXT,
  payload_json JSONB NOT NULL
);
`;

const migrationSql = `
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS is_close_game BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS is_last_two_minutes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS season TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS season_type TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS home_team_id TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS away_team_id TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS whistle_against_side TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS whistle_benefited_side TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS challenge_team_id TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS challenge_target_type TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS challenge_outcome_source TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS challenge_inference_reason TEXT;
ALTER TABLE foul_events ADD COLUMN IF NOT EXISTS challenge_inference_confidence NUMERIC(5,2);
ALTER TABLE challenge_events ADD COLUMN IF NOT EXISTS linked_referee_id TEXT;
ALTER TABLE challenge_events ADD COLUMN IF NOT EXISTS challenge_target_type TEXT;
ALTER TABLE challenge_events ADD COLUMN IF NOT EXISTS challenge_outcome_source TEXT;
ALTER TABLE challenge_events ADD COLUMN IF NOT EXISTS challenge_inference_reason TEXT;
ALTER TABLE challenge_events ADD COLUMN IF NOT EXISTS inference_confidence NUMERIC(5,2);
ALTER TABLE challenge_events ADD COLUMN IF NOT EXISTS challenge_overturned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE raw_play_by_play_events ADD COLUMN IF NOT EXISTS possession_team_id TEXT;
`;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  return pool;
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

async function ensureSchema(client) {
  await client.query(schemaSql);
  await client.query(migrationSql);
}

async function insertRows(client, query, rows) {
  for (const values of rows) {
    await client.query(query, values);
  }
}

async function deleteGameScopedRows(client, gameIds) {
  if (!gameIds.length) return;

  const params = [gameIds];
  await client.query(`DELETE FROM last_two_minute_reviews WHERE game_id = ANY($1::text[])`, params);
  await client.query(`DELETE FROM challenge_events WHERE game_id = ANY($1::text[])`, params);
  await client.query(`DELETE FROM foul_events WHERE game_id = ANY($1::text[])`, params);
  await client.query(`DELETE FROM raw_play_by_play_events WHERE game_id = ANY($1::text[])`, params);
  await client.query(`DELETE FROM game_officials WHERE game_id = ANY($1::text[])`, params);
}

function normalizeMetadata(latestMetadata, syncSummary, gameCount) {
  return {
    title: latestMetadata?.title || "NBA Referee Analytics",
    generatedAt: latestMetadata?.generatedAt || new Date().toISOString(),
    sampleType: "live_nba_sync",
    note: `Persistent NBA dataset assembled from ${syncSummary.syncCount} sync runs across ${gameCount} retained games.`,
    syncWindow: {
      from: syncSummary.fromDate || latestMetadata?.syncWindow?.from || null,
      to: syncSummary.toDate || latestMetadata?.syncWindow?.to || null,
      maxGames: latestMetadata?.syncWindow?.maxGames ?? null,
      gamesRequested: latestMetadata?.syncWindow?.gamesRequested ?? null,
      gamesSynced: gameCount,
      syncRuns: syncSummary.syncCount,
    },
    sources: latestMetadata?.sources || [
      "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json",
      "https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{game_id}.json",
      "https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_{game_id}.json",
      "https://official.nba.com/l2m/json/{game_id}.json",
    ],
    features: {
      persistentStorage: true,
      backgroundSyncReady: true,
      challengeTracking: true,
      challengeOutcomeInference: true,
      l2mOverlay: true,
      materializedSummaryTables: true,
      seasonFilters: true,
      venueSplits: true,
      lateGameDashboards: true,
      historicalRetention: true,
      incrementalSync: true,
      ...(latestMetadata?.features || {}),
    },
  };
}

function buildDatasetSnapshot(dataset) {
  return {
    metadata: dataset.metadata,
    counts: {
      teams: dataset.teams?.length || 0,
      players: dataset.players?.length || 0,
      referees: dataset.referees?.length || 0,
      games: dataset.games?.length || 0,
      gameOfficials: dataset.gameOfficials?.length || 0,
      rawPlayByPlayEvents: dataset.rawPlayByPlayEvents?.length || 0,
      foulEvents: dataset.foulEvents?.length || 0,
      challengeEvents: dataset.challengeEvents?.length || 0,
      lastTwoMinuteReviews: dataset.lastTwoMinuteReviews?.length || 0,
    },
    retainedGameIds: [...new Set((dataset.games || []).map((game) => game.id))],
    generatedAt: dataset.metadata?.generatedAt || new Date().toISOString(),
  };
}

function normalizeSyncSummaryRow(row = {}) {
  return {
    fromDate: row?.from_date || null,
    toDate: row?.to_date || null,
    syncCount: Number(row?.sync_count || 0),
  };
}

function mapRawPlayByPlayEventRow(row) {
  return {
    id: row.id,
    gameId: row.game_id,
    sourceEventId: row.source_event_id,
    period: row.period,
    clock: row.clock,
    actionType: row.action_type,
    subType: row.sub_type || "",
    description: row.description || "",
    homeScore: row.home_score,
    awayScore: row.away_score,
    scoreMargin: row.score_margin,
    possessionTeamId: row.possession_team_id,
    officialIdRaw: row.official_id_raw,
    teamIdRaw: row.team_id_raw,
    personIdRaw: row.person_id_raw,
    occurredAt: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
  };
}

export async function loadDatasetSummaryFromDatabase() {
  if (!hasDatabase()) return null;

  const db = getPool();
  const [
    latestSyncResult,
    syncSummaryResult,
    gamesCountResult,
    foulCountResult,
    refereesCountResult,
    challengesCountResult,
    reviewsCountResult,
  ] = await Promise.all([
    db.query(
      `SELECT synced_at, metadata_json
       FROM sync_runs
       ORDER BY synced_at DESC
       LIMIT 1`,
    ),
    db.query(
      `SELECT
         MIN(from_date) AS from_date,
         MAX(to_date) AS to_date,
         COUNT(*)::int AS sync_count
       FROM sync_runs`,
    ),
    db.query(`SELECT COUNT(*)::int AS count FROM games`),
    db.query(`SELECT COUNT(*)::int AS count FROM foul_events`),
    db.query(`SELECT COUNT(*)::int AS count FROM referees`),
    db.query(`SELECT COUNT(*)::int AS count FROM challenge_events`),
    db.query(`SELECT COUNT(*)::int AS count FROM last_two_minute_reviews`),
  ]);

  const gameCount = Number(gamesCountResult.rows[0]?.count || 0);
  if (!gameCount) {
    return null;
  }

  const latestMetadata = latestSyncResult.rows[0]?.metadata_json || {};
  const syncSummary = normalizeSyncSummaryRow(syncSummaryResult.rows[0]);
  const metadata = normalizeMetadata(latestMetadata, syncSummary, gameCount);

  return {
    sampleType: metadata.sampleType,
    generatedAt: metadata.generatedAt,
    syncWindow: metadata.syncWindow,
    games: gameCount,
    foulEvents: Number(foulCountResult.rows[0]?.count || 0),
    referees: Number(refereesCountResult.rows[0]?.count || 0),
    challenges: Number(challengesCountResult.rows[0]?.count || 0),
    l2mReviews: Number(reviewsCountResult.rows[0]?.count || 0),
  };
}

export async function loadRawPlayByPlayEventsFromDatabase() {
  if (!hasDatabase()) return null;

  const db = getPool();
  const result = await db.query(
    `SELECT
       id, game_id, source_event_id, period, clock, action_type, sub_type, description,
       home_score, away_score, score_margin, possession_team_id, official_id_raw, team_id_raw, person_id_raw,
       occurred_at
     FROM raw_play_by_play_events`,
  );

  return result.rows.map(mapRawPlayByPlayEventRow);
}

export async function loadDatasetFromDatabase(options = {}) {
  if (!hasDatabase()) return null;
  const includeRawPlayByPlay = options.includeRawPlayByPlay !== false;

  const db = getPool();
  const [
    latestSyncResult,
    syncSummaryResult,
    teamsResult,
    playersResult,
    refereesResult,
    gamesResult,
    officialsResult,
    rawEventsResult,
    foulEventsResult,
    challengesResult,
    reviewsResult,
  ] = await Promise.all([
    db.query(
      `SELECT synced_at, metadata_json
       FROM sync_runs
       ORDER BY synced_at DESC
       LIMIT 1`,
    ),
    db.query(
      `SELECT
         MIN(from_date) AS from_date,
         MAX(to_date) AS to_date,
         COUNT(*)::int AS sync_count
       FROM sync_runs`,
    ),
    db.query(`SELECT id, nba_team_id, abbreviation, city, name FROM teams`),
    db.query(`SELECT id, nba_player_id, display_name, team_id, position FROM players`),
    db.query(`SELECT id, nba_official_id, jersey_number, display_name FROM referees`),
    db.query(
      `SELECT
         id, nba_game_id, season, season_type, game_date, home_team_id, away_team_id,
         home_score_final, away_score_final, status
       FROM games`,
    ),
    db.query(`SELECT id, game_id, referee_id, assignment_role FROM game_officials`),
    includeRawPlayByPlay
      ? db.query(
          `SELECT
             id, game_id, source_event_id, period, clock, action_type, sub_type, description,
             home_score, away_score, score_margin, possession_team_id, official_id_raw, team_id_raw, person_id_raw,
             occurred_at
           FROM raw_play_by_play_events`,
        )
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT
         id, game_id, raw_event_id, period, period_clock, game_clock_seconds_elapsed, referee_id,
         foul_type, foul_subtype, penalized_team_id, penalized_player_id, benefited_team_id,
         benefited_player_id, home_score_at_whistle, away_score_at_whistle, score_margin_for_home,
         leading_team_id, is_home_whistle_against_home, free_throws_awarded, possession_team_id,
         is_take_foul, is_away_from_play, is_in_bonus, is_clutch, is_close_game, is_last_two_minutes,
         season, season_type, home_team_id, away_team_id, whistle_against_side, whistle_benefited_side,
         challenge_team_id, challenge_reviewed, challenge_overturned, challenge_outcome, challenge_target_type,
         challenge_outcome_source, challenge_inference_reason, challenge_inference_confidence,
         source_confidence, description, l2m_decision, l2m_call_type, l2m_comment, l2m_video_url,
         correctness_bucket
       FROM foul_events`,
    ),
    db.query(
      `SELECT
         id, game_id, linked_raw_event_id, linked_foul_event_id, linked_referee_id, team_id, period, period_clock,
         challenge_type, challenge_outcome, challenge_target_type, challenge_outcome_source, challenge_inference_reason, inference_confidence,
         challenge_overturned, description, payload_json
       FROM challenge_events`,
    ),
    db.query(
      `SELECT
         id, game_id, foul_event_id, period, clock, decision, call_type, review_type,
         committing_player_id, disadvantaged_player_id, comment, video_url, payload_json
       FROM last_two_minute_reviews`,
    ),
  ]);

  if (!gamesResult.rowCount) {
    return null;
  }

  const latestMetadata = latestSyncResult.rows[0]?.metadata_json || {};
  const syncSummary = normalizeSyncSummaryRow(syncSummaryResult.rows[0]);

  return buildDatasetFromRecords({
    metadata: normalizeMetadata(latestMetadata, syncSummary, gamesResult.rowCount),
    teams: teamsResult.rows.map((row) => ({
      id: row.id,
      nbaTeamId: row.nba_team_id,
      abbreviation: row.abbreviation,
      city: row.city,
      name: row.name,
    })),
    players: playersResult.rows.map((row) => ({
      id: row.id,
      nbaPlayerId: row.nba_player_id,
      displayName: row.display_name,
      teamId: row.team_id,
      position: row.position || "",
    })),
    referees: refereesResult.rows.map((row) => ({
      id: row.id,
      nbaOfficialId: row.nba_official_id,
      jerseyNumber: row.jersey_number,
      displayName: row.display_name,
    })),
    games: gamesResult.rows.map((row) => ({
      id: row.id,
      nbaGameId: row.nba_game_id,
      season: row.season,
      seasonType: row.season_type,
      gameDate: row.game_date instanceof Date ? row.game_date.toISOString().slice(0, 10) : String(row.game_date).slice(0, 10),
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeScoreFinal: row.home_score_final,
      awayScoreFinal: row.away_score_final,
      status: row.status,
    })),
    gameOfficials: officialsResult.rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      refereeId: row.referee_id,
      assignmentRole: row.assignment_role,
    })),
    rawPlayByPlayEvents: rawEventsResult.rows.map(mapRawPlayByPlayEventRow),
    foulEvents: foulEventsResult.rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      rawEventId: row.raw_event_id,
      period: row.period,
      periodClock: row.period_clock,
      gameClockSecondsElapsed: row.game_clock_seconds_elapsed,
      refereeId: row.referee_id,
      foulType: row.foul_type,
      foulSubtype: row.foul_subtype,
      penalizedTeamId: row.penalized_team_id,
      penalizedPlayerId: row.penalized_player_id,
      benefitedTeamId: row.benefited_team_id,
      benefitedPlayerId: row.benefited_player_id,
      homeScoreAtWhistle: row.home_score_at_whistle,
      awayScoreAtWhistle: row.away_score_at_whistle,
      scoreMarginForHome: row.score_margin_for_home,
      leadingTeamId: row.leading_team_id,
      isHomeWhistleAgainstHome: row.is_home_whistle_against_home,
      freeThrowsAwarded: row.free_throws_awarded,
      possessionTeamId: row.possession_team_id,
      isTakeFoul: row.is_take_foul,
      isAwayFromPlay: row.is_away_from_play,
      isInBonus: row.is_in_bonus,
      isClutch: row.is_clutch,
      isCloseGame: row.is_close_game,
      isLastTwoMinutes: row.is_last_two_minutes,
      season: row.season,
      seasonType: row.season_type,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      whistleAgainstSide: row.whistle_against_side,
      whistleBenefitedSide: row.whistle_benefited_side,
      challengeTeamId: row.challenge_team_id,
      challengeReviewed: row.challenge_reviewed,
      challengeOverturned: row.challenge_overturned,
      challengeOutcome: row.challenge_outcome,
      challengeTargetType: row.challenge_target_type,
      challengeOutcomeSource: row.challenge_outcome_source,
      challengeInferenceReason: row.challenge_inference_reason,
      challengeInferenceConfidence: row.challenge_inference_confidence == null ? null : Number(row.challenge_inference_confidence),
      sourceConfidence: Number(row.source_confidence),
      description: row.description,
      l2mDecision: row.l2m_decision,
      l2mCallType: row.l2m_call_type,
      l2mComment: row.l2m_comment,
      l2mVideoUrl: row.l2m_video_url,
      correctnessBucket: row.correctness_bucket,
    })),
    challengeEvents: challengesResult.rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      linkedRawEventId: row.linked_raw_event_id,
      linkedFoulEventId: row.linked_foul_event_id,
      linkedRefereeId: row.linked_referee_id,
      teamId: row.team_id,
      period: row.period,
      periodClock: row.period_clock,
      challengeType: row.challenge_type,
      challengeOutcome: row.challenge_outcome,
      challengeTargetType: row.challenge_target_type,
      challengeOutcomeSource: row.challenge_outcome_source,
      challengeInferenceReason: row.challenge_inference_reason,
      inferenceConfidence: row.inference_confidence == null ? null : Number(row.inference_confidence),
      challengeOverturned: row.challenge_overturned,
      description: row.description,
      payloadJson: row.payload_json,
    })),
    lastTwoMinuteReviews: reviewsResult.rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      foulEventId: row.foul_event_id,
      period: row.period,
      clock: row.clock,
      decision: row.decision,
      callType: row.call_type,
      reviewType: row.review_type,
      committingPlayerId: row.committing_player_id,
      disadvantagedPlayerId: row.disadvantaged_player_id,
      comment: row.comment,
      videoUrl: row.video_url,
      payloadJson: row.payload_json,
    })),
  });
}

export async function saveDatasetToDatabase(dataset) {
  if (!hasDatabase()) {
    return false;
  }

  const client = await getPool().connect();
  const gameIds = [...new Set((dataset.games || []).map((game) => game.id))];

  try {
    await client.query("BEGIN");
    await ensureSchema(client);

    await client.query(
      `INSERT INTO sync_runs (synced_at, source_type, from_date, to_date, metadata_json, dataset_json)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        dataset.metadata.generatedAt,
        dataset.metadata.sampleType,
        dataset.metadata.syncWindow?.from || null,
        dataset.metadata.syncWindow?.to || null,
        JSON.stringify(dataset.metadata),
        JSON.stringify(buildDatasetSnapshot(dataset)),
      ],
    );

    await deleteGameScopedRows(client, gameIds);

    await insertRows(
      client,
      `INSERT INTO teams (id, nba_team_id, abbreviation, city, name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         nba_team_id = EXCLUDED.nba_team_id,
         abbreviation = EXCLUDED.abbreviation,
         city = EXCLUDED.city,
         name = EXCLUDED.name`,
      dataset.teams.map((team) => [team.id, team.nbaTeamId, team.abbreviation, team.city, team.name]),
    );

    await insertRows(
      client,
      `INSERT INTO players (id, nba_player_id, display_name, team_id, position)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         nba_player_id = EXCLUDED.nba_player_id,
         display_name = EXCLUDED.display_name,
         team_id = EXCLUDED.team_id,
         position = EXCLUDED.position`,
      dataset.players.map((player) => [player.id, player.nbaPlayerId, player.displayName, player.teamId, player.position]),
    );

    await insertRows(
      client,
      `INSERT INTO referees (id, nba_official_id, jersey_number, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         nba_official_id = EXCLUDED.nba_official_id,
         jersey_number = EXCLUDED.jersey_number,
         display_name = EXCLUDED.display_name`,
      dataset.referees.map((referee) => [referee.id, referee.nbaOfficialId, referee.jerseyNumber, referee.displayName]),
    );

    await insertRows(
      client,
      `INSERT INTO games (
         id, nba_game_id, season, season_type, game_date, home_team_id, away_team_id, home_score_final, away_score_final, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         nba_game_id = EXCLUDED.nba_game_id,
         season = EXCLUDED.season,
         season_type = EXCLUDED.season_type,
         game_date = EXCLUDED.game_date,
         home_team_id = EXCLUDED.home_team_id,
         away_team_id = EXCLUDED.away_team_id,
         home_score_final = EXCLUDED.home_score_final,
         away_score_final = EXCLUDED.away_score_final,
         status = EXCLUDED.status`,
      dataset.games.map((game) => [
        game.id,
        game.nbaGameId,
        game.season,
        game.seasonType,
        game.gameDate,
        game.homeTeamId,
        game.awayTeamId,
        game.homeScoreFinal,
        game.awayScoreFinal,
        game.status,
      ]),
    );

    await insertRows(
      client,
      `INSERT INTO game_officials (id, game_id, referee_id, assignment_role)
       VALUES ($1, $2, $3, $4)`,
      dataset.gameOfficials
        .filter((official) => gameIds.includes(official.gameId))
        .map((official) => [official.id, official.gameId, official.refereeId, official.assignmentRole]),
    );

    await insertRows(
      client,
      `INSERT INTO raw_play_by_play_events (
         id, game_id, source_event_id, period, clock, action_type, sub_type, description,
         home_score, away_score, score_margin, possession_team_id, official_id_raw, team_id_raw, person_id_raw, payload_json, occurred_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)`,
      (dataset.rawPlayByPlayEvents || [])
        .filter((event) => gameIds.includes(event.gameId))
        .map((event) => [
          event.id,
          event.gameId,
          event.sourceEventId,
          event.period,
          event.clock,
          event.actionType,
          event.subType,
          event.description,
          event.homeScore,
          event.awayScore,
          event.scoreMargin,
          event.possessionTeamId,
          event.officialIdRaw,
          event.teamIdRaw,
          event.personIdRaw,
          JSON.stringify(event.payloadJson),
          event.occurredAt,
        ]),
    );

    await insertRows(
      client,
      `INSERT INTO foul_events (
         id, game_id, raw_event_id, period, period_clock, game_clock_seconds_elapsed, referee_id, foul_type, foul_subtype,
         penalized_team_id, penalized_player_id, benefited_team_id, benefited_player_id, home_score_at_whistle,
         away_score_at_whistle, score_margin_for_home, leading_team_id, is_home_whistle_against_home, free_throws_awarded,
         possession_team_id, is_take_foul, is_away_from_play, is_in_bonus, is_clutch, is_close_game, is_last_two_minutes,
         season, season_type, home_team_id, away_team_id, whistle_against_side, whistle_benefited_side, challenge_team_id, challenge_reviewed,
         challenge_overturned, challenge_outcome, challenge_target_type, challenge_outcome_source, challenge_inference_reason, challenge_inference_confidence, source_confidence, description,
         l2m_decision, l2m_call_type, l2m_comment, l2m_video_url, correctness_bucket
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47)`,
      dataset.foulEvents
        .filter((event) => gameIds.includes(event.gameId))
        .map((event) => [
          event.id,
          event.gameId,
          event.rawEventId,
          event.period,
          event.periodClock,
          event.gameClockSecondsElapsed,
          event.refereeId,
          event.foulType,
          event.foulSubtype,
          event.penalizedTeamId,
          event.penalizedPlayerId,
          event.benefitedTeamId,
          event.benefitedPlayerId,
          event.homeScoreAtWhistle,
          event.awayScoreAtWhistle,
          event.scoreMarginForHome,
          event.leadingTeamId,
          event.isHomeWhistleAgainstHome,
          event.freeThrowsAwarded,
          event.possessionTeamId,
          event.isTakeFoul,
          event.isAwayFromPlay,
          event.isInBonus,
          event.isClutch,
          event.isCloseGame,
          event.isLastTwoMinutes,
          event.season,
          event.seasonType,
          event.homeTeamId,
          event.awayTeamId,
          event.whistleAgainstSide,
          event.whistleBenefitedSide,
          event.challengeTeamId,
          event.challengeReviewed,
          event.challengeOverturned,
          event.challengeOutcome,
          event.challengeTargetType,
          event.challengeOutcomeSource,
          event.challengeInferenceReason,
          event.challengeInferenceConfidence,
          event.sourceConfidence,
          event.description,
          event.l2mDecision,
          event.l2mCallType,
          event.l2mComment,
          event.l2mVideoUrl,
          event.correctnessBucket,
        ]),
    );

    await insertRows(
      client,
      `INSERT INTO challenge_events (
         id, game_id, linked_raw_event_id, linked_foul_event_id, linked_referee_id, team_id, period, period_clock, challenge_type,
         challenge_outcome, challenge_target_type, challenge_outcome_source, challenge_inference_reason, inference_confidence, challenge_overturned, description, payload_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)`,
      (dataset.challengeEvents || [])
        .filter((event) => gameIds.includes(event.gameId))
        .map((event) => [
          event.id,
          event.gameId,
          event.linkedRawEventId,
          event.linkedFoulEventId,
          event.linkedRefereeId,
          event.teamId,
          event.period,
          event.periodClock,
          event.challengeType,
          event.challengeOutcome,
          event.challengeTargetType,
          event.challengeOutcomeSource,
          event.challengeInferenceReason,
          event.inferenceConfidence,
          event.challengeOverturned,
          event.description,
          JSON.stringify(event.payloadJson),
        ]),
    );

    await insertRows(
      client,
      `INSERT INTO last_two_minute_reviews (
         id, game_id, foul_event_id, period, clock, decision, call_type, review_type,
         committing_player_id, disadvantaged_player_id, comment, video_url, payload_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      (dataset.lastTwoMinuteReviews || [])
        .filter((review) => gameIds.includes(review.gameId))
        .map((review) => [
          review.id,
          review.gameId,
          review.foulEventId,
          review.period,
          review.clock,
          review.decision,
          review.callType,
          review.reviewType,
          review.committingPlayerId,
          review.disadvantagedPlayerId,
          review.comment,
          review.videoUrl,
          JSON.stringify(review.payloadJson),
        ]),
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadDatasetFromDatabase,
  loadDatasetSummaryFromDatabase,
  loadRawPlayByPlayEventsFromDatabase,
} from "../db/repository.js";
import { buildDataset as buildSampleDataset } from "./sampleData.js";
import { buildSummaryTables } from "./transformLiveData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const liveDatasetPath = path.join(__dirname, "liveData.json");

function summarizeDataset(dataset) {
  return {
    sampleType: dataset?.metadata?.sampleType || "unknown",
    generatedAt: dataset?.metadata?.generatedAt || null,
    syncWindow: dataset?.metadata?.syncWindow || null,
    games: dataset?.games?.length || 0,
    foulEvents: dataset?.foulEvents?.length || 0,
    referees: dataset?.referees?.length || 0,
    challenges: dataset?.challengeEvents?.length || 0,
    l2mReviews: dataset?.lastTwoMinuteReviews?.length || 0,
  };
}

function stripRawPlayByPlayPayload(events = []) {
  return events.map((event) => ({
    id: event.id,
    gameId: event.gameId,
    sourceEventId: event.sourceEventId,
    period: event.period,
    clock: event.clock,
    actionType: event.actionType,
    subType: event.subType || "",
    description: event.description || "",
    homeScore: event.homeScore ?? null,
    awayScore: event.awayScore ?? null,
    scoreMargin: event.scoreMargin ?? null,
    possessionTeamId:
      event.possessionTeamId ?? (event.payloadJson?.possession != null ? String(event.payloadJson.possession) : null),
    officialIdRaw: event.officialIdRaw ?? null,
    teamIdRaw: event.teamIdRaw ?? null,
    personIdRaw: event.personIdRaw ?? null,
    occurredAt: event.occurredAt || null,
  }));
}

function ensureSummaryTables(dataset) {
  if (!dataset) return dataset;

  const summaryTables = dataset.summaryTables || {};
  if (
    summaryTables.challengeRefereeOverview &&
    summaryTables.challengeTeamOverview &&
    summaryTables.challengeOutcomeOverview &&
    summaryTables.crewOverview &&
    summaryTables.crewChallengeOverview
  ) {
    return dataset;
  }

  dataset.summaryTables = {
    ...summaryTables,
    ...buildSummaryTables(dataset.foulEvents || [], dataset.challengeEvents || [], dataset.gameOfficials || []),
  };

  return dataset;
}

export async function loadDataset(options = {}) {
  const includeRawPlayByPlay = options.includeRawPlayByPlay !== false;

  try {
    const databaseDataset = await loadDatasetFromDatabase({ includeRawPlayByPlay });
    if (databaseDataset) {
      return ensureSummaryTables(databaseDataset);
    }
  } catch {
    // Fall through to file or sample data if the database is unavailable.
  }

  try {
    await access(liveDatasetPath);
    const content = await readFile(liveDatasetPath, "utf8");
    const parsed = JSON.parse(content);
    if (!includeRawPlayByPlay) {
      parsed.rawPlayByPlayEvents = [];
    }
    return ensureSummaryTables(parsed);
  } catch {
    const sampleDataset = buildSampleDataset();
    if (!includeRawPlayByPlay) {
      sampleDataset.rawPlayByPlayEvents = [];
    }
    return ensureSummaryTables(sampleDataset);
  }
}

export async function loadDatasetSummary() {
  try {
    const databaseSummary = await loadDatasetSummaryFromDatabase();
    if (databaseSummary) {
      return databaseSummary;
    }
  } catch {
    // Fall through to file or sample data if the database is unavailable.
  }

  return summarizeDataset(await loadDataset({ includeRawPlayByPlay: false }));
}

export async function loadRawPlayByPlayEvents() {
  try {
    const databaseEvents = await loadRawPlayByPlayEventsFromDatabase();
    if (databaseEvents) {
      return databaseEvents;
    }
  } catch {
    // Fall through to file or sample data if the database is unavailable.
  }

  const dataset = await loadDataset({ includeRawPlayByPlay: true });
  return stripRawPlayByPlayPayload(dataset.rawPlayByPlayEvents || []);
}

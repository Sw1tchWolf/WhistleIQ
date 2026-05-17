import crypto from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasDatabase } from "./db/repository.js";
import { getLiveSyncDefaults, syncLiveDataset } from "./data/liveSync.js";
import { loadDataset, loadDatasetSummary, loadRawPlayByPlayEvents } from "./data/loadDataset.js";
import {
  buildBiasRows,
  buildLookups,
  getBiasExplainability,
  getCoverageSummary,
  getCrewAnalytics,
  getGameLabel,
  getRefereeProfileData,
  matchesFilters,
} from "./public/analytics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const packageJson = JSON.parse(await readFile(path.join(__dirname, "package.json"), "utf8"));
const appVersion = packageJson.version || "0.0.0";
const port = Number(process.env.PORT || 3000);
const autoSyncEnabled = String(process.env.AUTO_SYNC || "false").toLowerCase() === "true";
const adminToken = process.env.ADMIN_TOKEN || "";
const adminSessionCookieName = "nba_ref_admin_session";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || adminToken;
const adminSessionTtlHours = Math.max(1, Number(process.env.ADMIN_SESSION_TTL_HOURS || 12));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const syncState = {
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastFailedAt: null,
  lastError: null,
  lastSummary: null,
  consecutiveFailures: 0,
};
let activeSyncPromise = null;

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(payload);
}

async function serveFile(response, filePath, headers = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";
  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    ...headers,
  });
  response.end(content);
}

function getIntervalMinutes() {
  return Number(process.env.SYNC_INTERVAL_MINUTES || 180);
}

function getStaleThresholdHours() {
  const derivedThreshold = Math.max(12, Math.ceil((getIntervalMinutes() * 2) / 60));
  return Math.max(2, Number(process.env.SYNC_STALE_HOURS || derivedThreshold));
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, cookiePart) => {
      const separatorIndex = cookiePart.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const key = cookiePart.slice(0, separatorIndex).trim();
      const value = cookiePart.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function createAdminSessionToken() {
  if (!adminToken || !adminSessionSecret) return null;
  const expiresAt = Date.now() + adminSessionTtlHours * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ role: "admin", exp: expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", adminSessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readAdminSession(request) {
  if (!adminToken || !adminSessionSecret) return null;
  const token = parseCookies(request.headers.cookie || "")[adminSessionCookieName];
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = crypto.createHmac("sha256", adminSessionSecret).update(payload).digest("base64url");
  if (signature.length !== expectedSignature.length) return null;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.role !== "admin" || Number(parsed.exp || 0) <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildAdminSessionCookie() {
  const token = createAdminSessionToken();
  if (!token) return null;
  return buildCookie(adminSessionCookieName, token, {
    path: "/",
    sameSite: "Lax",
    httpOnly: true,
    maxAge: adminSessionTtlHours * 60 * 60,
  });
}

function buildClearedSessionCookie() {
  return buildCookie(adminSessionCookieName, "", {
    path: "/",
    sameSite: "Lax",
    httpOnly: true,
    expires: new Date(0),
    maxAge: 0,
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) return {};
  return JSON.parse(rawBody);
}

function getDatasetSummary(dataset) {
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

function parseBooleanQueryValue(value, defaultValue = true) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

function parseDashboardFilters(url) {
  return {
    season: url.searchParams.get("season") || "all",
    gameId: url.searchParams.get("gameId") || "all",
    refereeId: url.searchParams.get("refereeId") || "all",
    teamId: url.searchParams.get("teamId") || "all",
    playerId: url.searchParams.get("playerId") || "all",
    period: url.searchParams.get("period") || "all",
    scoreState: url.searchParams.get("scoreState") || "all",
    seasonType: url.searchParams.get("seasonType") || "all",
    venueContext: url.searchParams.get("venueContext") || "all",
  };
}

function getFilteredEvents(dataset, lookups, filters) {
  return (dataset.foulEvents || []).filter((event) => matchesFilters(event, filters, lookups));
}

function buildChallengeRows(dataset, lookups, events) {
  const scopedFoulIds = new Set(events.filter((event) => event.challengeReviewed).map((event) => event.id));
  const foulEventsById = new Map(events.map((event) => [event.id, event]));

  return (dataset.challengeEvents || [])
    .filter((challengeEvent) => challengeEvent.linkedFoulEventId && scopedFoulIds.has(challengeEvent.linkedFoulEventId))
    .map((challengeEvent) => ({
      challengeEvent,
      foulEvent: foulEventsById.get(challengeEvent.linkedFoulEventId) || null,
      game: lookups.games[challengeEvent.gameId] || null,
      referee: challengeEvent.linkedRefereeId ? lookups.referees[challengeEvent.linkedRefereeId] || null : null,
      challengeTeam: challengeEvent.teamId ? lookups.teams[challengeEvent.teamId] || null : null,
    }))
    .filter((row) => row.foulEvent);
}

function escapeCsvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replaceAll('"', '""')}"`;
}

function buildCsv(columns, rows) {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildReportHtml({ view, filters, dataset, events, rows, title, generatedAt }) {
  const filterRows = Object.entries(filters)
    .filter(([, value]) => value && value !== "all")
    .map(([key, value]) => `<li><strong>${escapeHtml(key)}</strong>: ${escapeHtml(value)}</li>`)
    .join("");
  const overviewCards = [
    ["Dataset", dataset.metadata?.sampleType || "unknown"],
    ["Generated", generatedAt],
    ["Games in dataset", String(dataset.games?.length || 0)],
    ["Whistles in scope", String(events.length)],
  ]
    .map(
      ([label, value]) => `
        <article class="card">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </article>
      `,
    )
    .join("");
  const tableHeader = rows.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const tableRows = rows.rows.length
    ? rows.rows
        .slice(0, 50)
        .map(
          (row) => `
            <tr>
              ${rows.columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="${rows.columns.length}">No rows available for this report scope.</td></tr>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #132235; margin: 24px; }
      h1, h2 { margin: 0 0 12px; }
      .meta { color: #5a6d84; margin-bottom: 20px; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 16px 0 24px; }
      .card { border: 1px solid #d9e2ec; border-radius: 14px; padding: 14px; background: #f8fbfe; }
      .label { font-size: 12px; text-transform: uppercase; color: #5a6d84; margin-bottom: 8px; }
      .value { font-size: 22px; font-weight: 700; }
      ul { margin-top: 6px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border-bottom: 1px solid #d9e2ec; padding: 10px; text-align: left; vertical-align: top; }
      th { background: #eef4f9; font-size: 12px; text-transform: uppercase; color: #5a6d84; }
      @media print { body { margin: 12px; } .page-break { page-break-before: always; } }
    </style>
  </head>
  <body onload="${view ? "if (new URLSearchParams(location.search).get('print') === '1') window.print();" : ""}">
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Generated ${escapeHtml(generatedAt)} | View: ${escapeHtml(view)}</p>
    <section class="grid">${overviewCards}</section>
    <section>
      <h2>Scope</h2>
      ${filterRows ? `<ul>${filterRows}</ul>` : "<p>Broad scope with no additional filters.</p>"}
    </section>
    <section class="page-break">
      <h2>Key Rows</h2>
      <table>
        <thead><tr>${tableHeader}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </section>
  </body>
</html>`;
}

function buildExportRowsForView({ view, url, dataset, lookups, filters, events }) {
  let columns = [];
  let rows = [];

  if (view === "bias") {
    const mode = url.searchParams.get("biasMode") || "team_against";
    rows = buildBiasRows(events, dataset, mode, lookups, filters).map((row) => ({
      referee: row.refereeName,
      entity: row.entityLabel,
      confidence: row.confidence?.label || "Low confidence",
      possessions: Math.round(row.possessions),
      actual: row.actual,
      expected: row.expected.toFixed(2),
      ratePer100: row.ratePer100.toFixed(2),
      baselineRatePer100: row.baselineRatePer100.toFixed(2),
      deltaPer100: row.rateDiffPer100.toFixed(2),
      zSignal: row.standardizedSignal.toFixed(2),
    }));
    columns = [
      { key: "referee", label: "Referee" },
      { key: "entity", label: "Entity" },
      { key: "confidence", label: "Confidence" },
      { key: "possessions", label: "Shared Possessions" },
      { key: "actual", label: "Actual" },
      { key: "expected", label: "Expected" },
      { key: "ratePer100", label: "Rate per 100" },
      { key: "baselineRatePer100", label: "Baseline per 100" },
      { key: "deltaPer100", label: "Delta per 100" },
      { key: "zSignal", label: "Z-Signal" },
    ];
  } else if (view === "challenge") {
    rows = buildChallengeRows(dataset, lookups, events).map((row) => ({
      game: row.game ? getGameLabel(row.game, lookups) : row.challengeEvent.gameId,
      referee: row.referee?.displayName || "Unknown",
      challengingTeam: row.challengeTeam?.abbreviation || row.challengeEvent.teamId || "Unknown",
      quarter: `Q${row.foulEvent.period}`,
      clock: row.foulEvent.periodClock,
      call: row.foulEvent.foulType,
      outcome: row.challengeEvent.challengeOutcome || "unknown",
      source: row.challengeEvent.challengeOutcomeSource || "inferred",
      confidence:
        row.challengeEvent.inferenceConfidence == null
          ? ""
          : Math.round(Number(row.challengeEvent.inferenceConfidence) * 100),
      reason: row.challengeEvent.challengeInferenceReason || "",
    }));
    columns = [
      { key: "game", label: "Game" },
      { key: "referee", label: "Referee" },
      { key: "challengingTeam", label: "Challenging Team" },
      { key: "quarter", label: "Quarter" },
      { key: "clock", label: "Clock" },
      { key: "call", label: "Call" },
      { key: "outcome", label: "Outcome" },
      { key: "source", label: "Source" },
      { key: "confidence", label: "Confidence (%)" },
      { key: "reason", label: "Reason" },
    ];
  } else if (view === "crew") {
    rows = getCrewAnalytics(events, dataset, lookups).rows.map((row) => ({
      crew: row.crewLabel,
      games: row.games,
      totalCalls: row.totalCalls,
      callsPerGame: row.callsPerGame.toFixed(2),
      reviewedCalls: row.reviewedCalls,
      overturnRate: (row.overturnRate * 100).toFixed(1),
      againstHomeShare: (row.againstHomeShare * 100).toFixed(1),
      benefitHomeShare: (row.benefitHomeShare * 100).toFixed(1),
      closeGameCalls: row.closeGameCalls,
      lastTwoMinuteCalls: row.lastTwoMinutesCalls,
      consistencyScore: row.consistencyScore.toFixed(1),
    }));
    columns = [
      { key: "crew", label: "Crew" },
      { key: "games", label: "Games" },
      { key: "totalCalls", label: "Total Calls" },
      { key: "callsPerGame", label: "Calls per Game" },
      { key: "reviewedCalls", label: "Reviewed Calls" },
      { key: "overturnRate", label: "Overturn Rate (%)" },
      { key: "againstHomeShare", label: "Against Home Share (%)" },
      { key: "benefitHomeShare", label: "Benefit Home Share (%)" },
      { key: "closeGameCalls", label: "Close Game Calls" },
      { key: "lastTwoMinuteCalls", label: "Last Two Minute Calls" },
      { key: "consistencyScore", label: "Quarter Consistency" },
    ];
  } else if (view === "profile") {
    const refereeId = url.searchParams.get("profileRefereeId") || url.searchParams.get("refereeId") || "all";
    const profile = getRefereeProfileData(events, dataset, lookups, filters, refereeId);
    rows = (profile?.challengeRows || []).map((event) => ({
      game: lookups.games[event.gameId] ? getGameLabel(lookups.games[event.gameId], lookups) : event.gameId,
      quarter: `Q${event.period}`,
      clock: event.periodClock,
      call: event.foulType,
      against: lookups.players[event.penalizedPlayerId]?.displayName || lookups.teams[event.penalizedTeamId]?.abbreviation || "Unknown",
      benefited: lookups.players[event.benefitedPlayerId]?.displayName || lookups.teams[event.benefitedTeamId]?.abbreviation || "Unknown",
      outcome: event.challengeOutcome || "unknown",
      source: event.challengeOutcomeSource || "inferred",
    }));
    columns = [
      { key: "game", label: "Game" },
      { key: "quarter", label: "Quarter" },
      { key: "clock", label: "Clock" },
      { key: "call", label: "Call" },
      { key: "against", label: "Against" },
      { key: "benefited", label: "Benefited" },
      { key: "outcome", label: "Outcome" },
      { key: "source", label: "Source" },
    ];
  } else {
    rows = events.map((event) => ({
      game: lookups.games[event.gameId] ? getGameLabel(lookups.games[event.gameId], lookups) : event.gameId,
      referee: lookups.referees[event.refereeId]?.displayName || event.refereeId || "Unknown",
      quarter: `Q${event.period}`,
      clock: event.periodClock,
      call: event.foulType,
      against: lookups.players[event.penalizedPlayerId]?.displayName || lookups.teams[event.penalizedTeamId]?.abbreviation || "Unknown",
      benefited: lookups.players[event.benefitedPlayerId]?.displayName || lookups.teams[event.benefitedTeamId]?.abbreviation || "Unknown",
      score: `${event.awayScoreAtWhistle}-${event.homeScoreAtWhistle}`,
    }));
    columns = [
      { key: "game", label: "Game" },
      { key: "referee", label: "Referee" },
      { key: "quarter", label: "Quarter" },
      { key: "clock", label: "Clock" },
      { key: "call", label: "Call" },
      { key: "against", label: "Against" },
      { key: "benefited", label: "Benefited" },
      { key: "score", label: "Score" },
    ];
  }

  return { columns, rows };
}

function formatHoursAgo(hours) {
  if (!Number.isFinite(hours)) return "unknown";
  if (hours < 24) return `${hours.toFixed(1)} hours`;
  return `${Math.round(hours)} hours`;
}

function getSyncEvaluation(datasetSummary) {
  const staleThresholdHours = getStaleThresholdHours();
  const alerts = [];
  let hoursSinceDatasetUpdate = null;

  if (datasetSummary.generatedAt) {
    const generatedAtMs = new Date(datasetSummary.generatedAt).getTime();
    if (Number.isFinite(generatedAtMs)) {
      hoursSinceDatasetUpdate = (Date.now() - generatedAtMs) / (1000 * 60 * 60);
    }
  }

  if (syncState.lastError) {
    alerts.push({
      level: "critical",
      code: "sync_failed",
      message: "The most recent sync attempt failed.",
      detail: syncState.lastError,
    });
  }

  if (datasetSummary.sampleType !== "live_nba_sync") {
    alerts.push({
      level: "warning",
      code: "non_live_dataset",
      message: "The app is not serving a live synced NBA dataset.",
      detail: "Analytics are currently backed by cached or sample data.",
    });
  }

  if (hoursSinceDatasetUpdate == null) {
    alerts.push({
      level: "warning",
      code: "missing_dataset_timestamp",
      message: "The current dataset does not expose a sync timestamp.",
      detail: "Freshness checks are limited until a live sync writes generatedAt metadata.",
    });
  } else if (hoursSinceDatasetUpdate >= staleThresholdHours * 2) {
    alerts.push({
      level: "critical",
      code: "dataset_stale_critical",
      message: "The synced dataset is critically stale.",
      detail: `Last dataset refresh was ${formatHoursAgo(hoursSinceDatasetUpdate)} ago, beyond the ${staleThresholdHours}-hour threshold.`,
    });
  } else if (hoursSinceDatasetUpdate >= staleThresholdHours) {
    alerts.push({
      level: "warning",
      code: "dataset_stale",
      message: "The synced dataset is getting stale.",
      detail: `Last dataset refresh was ${formatHoursAgo(hoursSinceDatasetUpdate)} ago. The stale threshold is ${staleThresholdHours} hours.`,
    });
  }

  if (!autoSyncEnabled) {
    alerts.push({
      level: "info",
      code: "auto_sync_disabled",
      message: "Background sync is disabled.",
      detail: "Data will only refresh when a manual sync is triggered or the server is restarted with AUTO_SYNC enabled.",
    });
  }

  if (syncState.running) {
    alerts.push({
      level: "info",
      code: "sync_running",
      message: "A sync is currently in progress.",
      detail: `The active run started at ${syncState.lastStartedAt || "an unknown time"}.`,
    });
  }

  const severityOrder = { healthy: 0, info: 1, warning: 2, critical: 3 };
  const status = alerts.reduce((current, alert) => {
    const currentScore = severityOrder[current] ?? 0;
    const nextScore = severityOrder[alert.level] ?? 0;
    return nextScore > currentScore ? alert.level : current;
  }, "healthy");

  return {
    status,
    staleThresholdHours,
    hoursSinceDatasetUpdate,
    lastDatasetAt: datasetSummary.generatedAt,
    alerts,
  };
}

async function getOperationalContext(request) {
  const datasetSummary = await loadDatasetSummary();
  const adminSession = readAdminSession(request);
  return {
    datasetSummary,
    syncEvaluation: getSyncEvaluation(datasetSummary),
    adminAuthenticated: Boolean(adminSession),
    adminSessionExpiresAt: adminSession?.exp ? new Date(adminSession.exp).toISOString() : null,
  };
}

async function initializeSyncStateFromDataset() {
  try {
    const datasetSummary = await loadDatasetSummary();
    if (!datasetSummary.generatedAt) return;

    syncState.lastCompletedAt = syncState.lastCompletedAt || datasetSummary.generatedAt;
    syncState.lastSummary = syncState.lastSummary || {
      reason: "dataset_bootstrap",
      games: datasetSummary.games,
      foulEvents: datasetSummary.foulEvents,
      referees: datasetSummary.referees,
      challenges: datasetSummary.challenges,
      l2mReviews: datasetSummary.l2mReviews,
      syncedAt: datasetSummary.generatedAt,
    };
  } catch (error) {
    console.warn("Unable to initialize sync state from dataset:", error);
  }
}

function getBackgroundSyncOptions() {
  const defaults = getLiveSyncDefaults();
  const lookbackDays = Number(process.env.SYNC_LOOKBACK_DAYS || 7);
  const maxGames = Number(process.env.SYNC_MAX_GAMES || defaults.maxGames);
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (lookbackDays - 1));
  const from = fromDate.toISOString().slice(0, 10);

  return { from, to, maxGames };
}

function normalizeSyncOptions(overrides = {}) {
  const defaults = getBackgroundSyncOptions();
  const normalized = {
    from: typeof overrides.from === "string" && overrides.from ? overrides.from : defaults.from,
    to: typeof overrides.to === "string" && overrides.to ? overrides.to : defaults.to,
    maxGames:
      overrides.maxGames === null || overrides.maxGames === undefined || overrides.maxGames === ""
        ? defaults.maxGames
        : Number(overrides.maxGames),
  };

  if (!Number.isFinite(normalized.maxGames)) {
    normalized.maxGames = defaults.maxGames;
  }

  return normalized;
}

async function runSync(reason = "manual", overrides = {}) {
  if (syncState.running) {
    return { started: false, reason: "already_running", summary: syncState.lastSummary };
  }

  syncState.running = true;
  syncState.lastStartedAt = new Date().toISOString();
  const syncOptions = normalizeSyncOptions(overrides);

  try {
    const result = await syncLiveDataset({
      ...syncOptions,
      logger: console,
    });

    syncState.lastCompletedAt = new Date().toISOString();
    syncState.lastSummary = { reason, ...syncOptions, ...result.summary };
    syncState.lastError = null;
    syncState.consecutiveFailures = 0;
    return { started: true, reason, summary: syncState.lastSummary };
  } catch (error) {
    syncState.lastFailedAt = new Date().toISOString();
    syncState.lastError = error instanceof Error ? error.message : String(error);
    syncState.consecutiveFailures += 1;
    return { started: false, reason, error: syncState.lastError };
  } finally {
    syncState.running = false;
  }
}

function startBackgroundSync(reason = "manual", overrides = {}) {
  if (syncState.running) {
    return {
      started: false,
      reason: "already_running",
      summary: syncState.lastSummary,
    };
  }

  activeSyncPromise = runSync(reason, overrides).finally(() => {
    activeSyncPromise = null;
  });

  return {
    started: true,
    reason,
    queued: true,
    running: true,
  };
}

function isAuthorized(request) {
  if (!adminToken) return true;
  if (readAdminSession(request)) return true;
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  return request.headers["x-admin-token"] === adminToken || url.searchParams.get("token") === adminToken;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === "/api/health") {
      const operationalContext = await getOperationalContext(request);
      sendJson(response, 200, {
        ok: true,
        app: "nba-referee-analytics",
        appVersion,
        databaseEnabled: hasDatabase(),
        autoSyncEnabled,
        adminAuthEnabled: Boolean(adminToken),
        adminAuthenticated: operationalContext.adminAuthenticated,
        adminSessionExpiresAt: operationalContext.adminSessionExpiresAt,
        datasetStatus: operationalContext.datasetSummary,
        syncEvaluation: operationalContext.syncEvaluation,
        syncState,
      });
      return;
    }

    if (pathname === "/api/data") {
      const includeRawPlayByPlay = parseBooleanQueryValue(url.searchParams.get("includeRaw"), true);
      sendJson(response, 200, await loadDataset({ includeRawPlayByPlay }));
      return;
    }

    if (pathname === "/api/data/raw-play-by-play") {
      sendJson(response, 200, {
        ok: true,
        rawPlayByPlayEvents: await loadRawPlayByPlayEvents(),
      });
      return;
    }

    if (pathname === "/api/analytics/bias") {
      const dataset = await loadDataset({ includeRawPlayByPlay: true });
      const lookups = buildLookups(dataset);
      const filters = parseDashboardFilters(url);
      const mode = url.searchParams.get("mode") || "team_against";
      const events = getFilteredEvents(dataset, lookups, filters);
      const rows = buildBiasRows(events, dataset, mode, lookups, filters);

      sendJson(response, 200, {
        ok: true,
        mode,
        rows,
        explainability: getBiasExplainability(rows),
        coverage: getCoverageSummary(events, dataset, lookups),
      });
      return;
    }

    if (pathname === "/api/analytics/crew") {
      const dataset = await loadDataset({ includeRawPlayByPlay: false });
      const lookups = buildLookups(dataset);
      const filters = parseDashboardFilters(url);
      const events = getFilteredEvents(dataset, lookups, filters);
      const crewAnalytics = getCrewAnalytics(events, dataset, lookups);

      sendJson(response, 200, {
        ok: true,
        ...crewAnalytics,
        coverage: getCoverageSummary(events, dataset, lookups),
      });
      return;
    }

    if (pathname === "/api/analytics/referee-profile") {
      const dataset = await loadDataset({ includeRawPlayByPlay: true });
      const lookups = buildLookups(dataset);
      const filters = parseDashboardFilters(url);
      const refereeId = url.searchParams.get("profileRefereeId") || url.searchParams.get("refereeId") || "all";
      const events = getFilteredEvents(dataset, lookups, filters);
      const profile = getRefereeProfileData(events, dataset, lookups, filters, refereeId);

      sendJson(response, 200, {
        ok: true,
        profile,
        coverage: getCoverageSummary(events, dataset, lookups),
      });
      return;
    }

    if (pathname === "/api/export.csv") {
      const dataset = await loadDataset({ includeRawPlayByPlay: true });
      const lookups = buildLookups(dataset);
      const filters = parseDashboardFilters(url);
      const view = url.searchParams.get("view") || "overview";
      const events = getFilteredEvents(dataset, lookups, filters);
      const { columns, rows } = buildExportRowsForView({ view, url, dataset, lookups, filters, events });

      sendText(
        response,
        200,
        buildCsv(columns, rows),
        {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"whistleiq-${view}.csv\"`,
        },
      );
      return;
    }

    if (pathname === "/api/export/report") {
      const dataset = await loadDataset({ includeRawPlayByPlay: true });
      const lookups = buildLookups(dataset);
      const filters = parseDashboardFilters(url);
      const view = url.searchParams.get("view") || "overview";
      const events = getFilteredEvents(dataset, lookups, filters);
      const rows = buildExportRowsForView({ view, url, dataset, lookups, filters, events });
      const generatedAt = new Date().toLocaleString();
      const title = `WhistleIQ Report | ${view}`;
      const html = buildReportHtml({ view, filters, dataset, events, rows, title, generatedAt });

      sendText(
        response,
        200,
        html,
        {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition":
            url.searchParams.get("print") === "1"
              ? "inline"
              : `attachment; filename=\"whistleiq-${view}-report.html\"`,
        },
      );
      return;
    }

    if (pathname === "/api/sync/status") {
      const operationalContext = await getOperationalContext(request);
      sendJson(response, 200, {
        ok: true,
        syncState,
        defaults: getBackgroundSyncOptions(),
        datasetStatus: operationalContext.datasetSummary,
        syncEvaluation: operationalContext.syncEvaluation,
      });
      return;
    }

    if (pathname === "/api/admin/session") {
      const adminSession = readAdminSession(request);
      sendJson(response, 200, {
        ok: true,
        authEnabled: Boolean(adminToken),
        authenticated: Boolean(adminSession),
        expiresAt: adminSession?.exp ? new Date(adminSession.exp).toISOString() : null,
        sessionTtlHours: adminSessionTtlHours,
      });
      return;
    }

    if (pathname === "/api/admin/login") {
      if (request.method !== "POST") {
        sendText(response, 405, "Method Not Allowed");
        return;
      }

      if (!adminToken) {
        sendJson(response, 400, { ok: false, error: "Admin authentication is not configured on this server." });
        return;
      }

      const body = await readJsonBody(request);
      const providedToken = String(body.token || body.password || "").trim();

      if (!providedToken || providedToken !== adminToken) {
        sendJson(response, 401, { ok: false, error: "Invalid admin credentials." });
        return;
      }

      const sessionCookie = buildAdminSessionCookie();
      sendJson(
        response,
        200,
        {
          ok: true,
          authenticated: true,
          expiresAt: new Date(Date.now() + adminSessionTtlHours * 60 * 60 * 1000).toISOString(),
          sessionTtlHours: adminSessionTtlHours,
        },
        sessionCookie ? { "Set-Cookie": sessionCookie } : {},
      );
      return;
    }

    if (pathname === "/api/admin/logout") {
      if (request.method !== "POST") {
        sendText(response, 405, "Method Not Allowed");
        return;
      }

      sendJson(
        response,
        200,
        {
          ok: true,
          authenticated: false,
        },
        { "Set-Cookie": buildClearedSessionCookie() },
      );
      return;
    }

    if (pathname === "/api/admin/sync") {
      if (request.method !== "POST") {
        sendText(response, 405, "Method Not Allowed");
        return;
      }

      if (!isAuthorized(request)) {
        sendJson(response, 401, { ok: false, error: "Unauthorized. Sign in to run admin sync actions." });
        return;
      }

      const body = await readJsonBody(request);
      const result = startBackgroundSync("admin_endpoint", body);
      sendJson(response, result.started ? 202 : 200, { ok: true, ...result });
      return;
    }

    const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
    const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(publicDir, normalizedPath);

    try {
      await serveFile(response, filePath);
    } catch {
      await serveFile(response, path.join(publicDir, "index.html"));
    }
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: "Server error",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, () => {
  console.log(`WhistleIQ running at http://localhost:${port}`);
});

initializeSyncStateFromDataset().catch((error) => {
  console.warn("Initial sync state bootstrap failed:", error);
});

if (autoSyncEnabled) {
  runSync("startup").catch((error) => {
    console.error("Startup sync failed:", error);
  });

  const intervalMinutes = getIntervalMinutes();
  setInterval(() => {
    runSync("interval").catch((error) => {
      console.error("Scheduled sync failed:", error);
    });
  }, intervalMinutes * 60 * 1000);
}

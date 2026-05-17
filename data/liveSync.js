import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { saveDatasetToDatabase } from "../db/repository.js";
import { transformLiveGameBundles } from "./transformLiveData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const liveDatasetPath = path.join(__dirname, "liveData.json");

const NBA_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
};

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function normalizeScheduleDate(dateString) {
  const rawDate = String(dateString || "").split(" ")[0];
  if (!rawDate) return "";
  if (rawDate.includes("-")) return rawDate.slice(0, 10);
  const [month, day, year] = rawDate.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

async function fetchJson(url, { tolerate404 = false } = {}) {
  const response = await fetch(url, { headers: NBA_HEADERS });
  if (tolerate404 && response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

function isCompletedGame(game) {
  return game.gameStatusText === "Final" || Number(game.gameStatus) === 3;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchGameBundle(gameDate, scheduleGame) {
  const gameId = String(scheduleGame.gameId);
  const [boxscore, playByPlay, l2mReport] = await Promise.all([
    fetchJson(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`),
    fetchJson(`https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_${gameId}.json`),
    fetchJson(`https://official.nba.com/l2m/json/${gameId}.json`, { tolerate404: true }).catch(() => null),
  ]);

  return {
    gameDate,
    scheduleGame,
    boxscore,
    playByPlay,
    l2mReport,
  };
}

export function getLiveSyncDefaults() {
  const today = new Date();
  const to = toDateString(today);
  const from = addDays(to, -6);
  return { from, to, maxGames: 12 };
}

export async function syncLiveDataset(options = {}) {
  const defaults = getLiveSyncDefaults();
  const from = options.from || defaults.from;
  const to = options.to || defaults.to;
  const requestedMaxGames = Number(options.maxGames ?? defaults.maxGames);
  const maxGames = Number.isFinite(requestedMaxGames) ? requestedMaxGames : defaults.maxGames;
  const writeDatabase = options.writeDatabase !== false;
  const writeFileCache = options.writeFileCache ?? !writeDatabase;
  const logger = options.logger || console;

  logger.log?.(
    `Syncing live NBA data from ${from} through ${to} (${maxGames > 0 ? `max ${maxGames} games` : "all completed games"})...`,
  );

  const schedulePayload = await fetchJson("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json");
  const selectedGames = (schedulePayload.leagueSchedule?.gameDates || [])
    .map((gameDay) => ({
      gameDate: normalizeScheduleDate(gameDay.gameDate),
      games: gameDay.games || [],
    }))
    .filter((gameDay) => gameDay.gameDate >= from && gameDay.gameDate <= to)
    .flatMap((gameDay) =>
      gameDay.games
        .filter(isCompletedGame)
        .map((scheduleGame) => ({
          gameDate: gameDay.gameDate,
          scheduleGame,
        })),
    )
    .sort((a, b) => {
      if (a.gameDate !== b.gameDate) return b.gameDate.localeCompare(a.gameDate);
      return String(b.scheduleGame.gameId).localeCompare(String(a.scheduleGame.gameId));
    })
    .slice(0, maxGames > 0 ? maxGames : undefined);

  if (!selectedGames.length) {
    throw new Error(`No completed games found between ${from} and ${to}.`);
  }

  logger.log?.(`Found ${selectedGames.length} completed games to sync.`);

  const gameBundles = [];
  for (const batch of chunk(selectedGames, 4)) {
    const results = await Promise.allSettled(
      batch.map((item) => fetchGameBundle(item.gameDate, item.scheduleGame)),
    );

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        gameBundles.push(result.value);
      } else {
        logger.warn?.(`Skipping game after fetch failure: ${result.reason.message}`);
      }
    });
  }

  if (!gameBundles.length) {
    throw new Error("All live game fetches failed.");
  }

  const syncedAt = new Date().toISOString();
  const dataset = transformLiveGameBundles({
    gameBundles,
    syncedAt,
    request: {
      from,
      to,
      maxGames,
      gamesRequested: selectedGames.length,
    },
  });

  if (writeFileCache) {
    try {
      await mkdir(path.dirname(liveDatasetPath), { recursive: true });
      await writeFile(liveDatasetPath, JSON.stringify(dataset, null, 2), "utf8");
    } catch (error) {
      if (writeDatabase && error instanceof RangeError) {
        logger.warn?.("Skipping file cache write because the dataset is too large to serialize as a single JSON string.");
      } else {
        throw error;
      }
    }
  }

  if (writeDatabase) {
    await saveDatasetToDatabase(dataset);
  }

  const summary = {
    games: dataset.games.length,
    foulEvents: dataset.foulEvents.length,
    referees: dataset.referees.length,
    challenges: (dataset.challengeEvents || []).length,
    l2mReviews: (dataset.lastTwoMinuteReviews || []).length,
    syncedAt,
    outputFile: liveDatasetPath,
  };

  logger.log?.(
    `Synced ${summary.games} games, ${summary.foulEvents} foul events, ${summary.referees} referees, ${summary.challenges} challenges, and ${summary.l2mReviews} L2M reviews.`,
  );

  return { dataset, summary };
}

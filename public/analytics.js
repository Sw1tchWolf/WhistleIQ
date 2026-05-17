function parseClock(clock) {
  const [minutes, seconds] = String(clock || "00:00").split(":").map(Number);
  return (minutes || 0) * 60 + (seconds || 0);
}

function getRawScoreState(rawEvent) {
  const margin = Math.abs((rawEvent.homeScore ?? 0) - (rawEvent.awayScore ?? 0));
  const isClutch = rawEvent.period >= 4 && parseClock(rawEvent.clock) <= 300 && margin <= 5;
  if (isClutch) return "clutch";
  if (margin === 0) return "tie";
  if (margin <= 3) return "one-possession";
  if (margin <= 5) return "close";
  if (margin >= 10) return "blowout";
  return "middle";
}

function getUniqueValues(items) {
  return [...new Set(items.filter(Boolean))];
}

export function getCrewId(refereeIds = []) {
  return [...new Set(refereeIds.map((refereeId) => String(refereeId)).filter(Boolean))].sort().join("__");
}

export function buildCrewLookups(data, lookups) {
  const byGameId = new Map();
  const byCrewId = new Map();

  for (const game of data.games || []) {
    const officials = (lookups.gameOfficialsByGame[game.id] || [])
      .map((official) => official.refereeId)
      .filter(Boolean);
    if (!officials.length) continue;

    const refereeIds = [...new Set(officials)].sort();
    const crewId = getCrewId(refereeIds);
    const crew = {
      crewId,
      refereeIds,
      gameIds: [game.id],
    };

    byGameId.set(game.id, crew);

    if (!byCrewId.has(crewId)) {
      byCrewId.set(crewId, {
        crewId,
        refereeIds,
        gameIds: new Set(),
      });
    }

    byCrewId.get(crewId).gameIds.add(game.id);
  }

  return {
    byGameId,
    byCrewId: new Map(
      [...byCrewId.entries()].map(([crewId, crew]) => [
        crewId,
        {
          ...crew,
          gameIds: [...crew.gameIds],
        },
      ]),
    ),
  };
}

function getFallbackGameTeamPossessions(data, scopedGameIds) {
  const gameTeamPossessions = new Map();
  for (const game of data.games) {
    if (scopedGameIds && !scopedGameIds.has(game.id)) continue;
    gameTeamPossessions.set(
      game.id,
      new Map([
        [game.homeTeamId, 100],
        [game.awayTeamId, 100],
      ]),
    );
  }
  return gameTeamPossessions;
}

function buildGameTeamPossessionsFromRaw(data, filters, lookups, scopedGameIds) {
  const perGame = new Map();

  for (const rawEvent of data.rawPlayByPlayEvents || []) {
    if (scopedGameIds && !scopedGameIds.has(rawEvent.gameId)) continue;
    if (filters.gameId !== "all" && rawEvent.gameId !== filters.gameId) continue;
    if (filters.period !== "all" && rawEvent.period !== Number(filters.period)) continue;

    const game = lookups.games[rawEvent.gameId];
    if (!game) continue;
    if (filters.season !== "all" && game.season !== filters.season) continue;
    if (filters.seasonType !== "all" && game.seasonType !== filters.seasonType) continue;
    if (filters.refereeId !== "all") {
      const officials = lookups.gameOfficialsByGame[rawEvent.gameId] || [];
      if (!officials.some((official) => official.refereeId === filters.refereeId)) continue;
    }
    if (filters.scoreState !== "all" && getRawScoreState(rawEvent) !== filters.scoreState) continue;

    const possessionTeamId = rawEvent.possessionTeamId
      ? String(rawEvent.possessionTeamId)
      : rawEvent.payloadJson?.possession
        ? String(rawEvent.payloadJson.possession)
        : null;
    if (!possessionTeamId || possessionTeamId === "0") continue;

    if (!perGame.has(rawEvent.gameId)) {
      perGame.set(rawEvent.gameId, []);
    }

    perGame.get(rawEvent.gameId).push({
      possessionTeamId,
      sourceEventNumber: Number(rawEvent.sourceEventId || 0),
      period: rawEvent.period,
    });
  }

  const gameTeamPossessions = new Map();

  for (const [gameId, events] of perGame.entries()) {
    events.sort((a, b) => {
      if (a.period !== b.period) return a.period - b.period;
      return a.sourceEventNumber - b.sourceEventNumber;
    });

    const counts = new Map();
    let lastPossessionTeamId = null;

    for (const event of events) {
      if (event.possessionTeamId !== lastPossessionTeamId) {
        counts.set(event.possessionTeamId, (counts.get(event.possessionTeamId) || 0) + 1);
        lastPossessionTeamId = event.possessionTeamId;
      }
    }

    gameTeamPossessions.set(gameId, counts);
  }

  if (!gameTeamPossessions.size) {
    return getFallbackGameTeamPossessions(data, scopedGameIds);
  }

  return gameTeamPossessions;
}

function buildScopedPossessionStats(data, filters, lookups, scopedGameIds = null) {
  const scopedSet = scopedGameIds ? new Set(scopedGameIds) : null;
  const gameTeamPossessions =
    data.rawPlayByPlayEvents?.length
      ? buildGameTeamPossessionsFromRaw(data, filters, lookups, scopedSet)
      : getFallbackGameTeamPossessions(data, scopedSet);

  const teamPossessions = new Map();
  const refereePossessions = new Map();
  const sharedPossessionsByRefTeam = new Map();
  const sharedGamesByRefTeam = new Map();
  const gameTotals = new Map();

  for (const [gameId, teamCounts] of gameTeamPossessions.entries()) {
    const totalPossessions = [...teamCounts.values()].reduce((total, count) => total + count, 0);
    gameTotals.set(gameId, totalPossessions);

    for (const [teamId, count] of teamCounts.entries()) {
      teamPossessions.set(teamId, (teamPossessions.get(teamId) || 0) + count);
    }

    const officials = lookups.gameOfficialsByGame[gameId] || [];
    for (const official of officials) {
      refereePossessions.set(official.refereeId, (refereePossessions.get(official.refereeId) || 0) + totalPossessions);

      for (const [teamId, count] of teamCounts.entries()) {
        const key = `${official.refereeId}|${teamId}`;
        sharedPossessionsByRefTeam.set(key, (sharedPossessionsByRefTeam.get(key) || 0) + count);
        sharedGamesByRefTeam.set(key, (sharedGamesByRefTeam.get(key) || 0) + 1);
      }
    }
  }

  return {
    totalPossessions: [...gameTotals.values()].reduce((total, value) => total + value, 0),
    teamPossessions,
    refereePossessions,
    sharedPossessionsByRefTeam,
    sharedGamesByRefTeam,
    getSharedPossessions(refereeId, teamId) {
      return sharedPossessionsByRefTeam.get(`${refereeId}|${teamId}`) || 0;
    },
    getSharedGames(refereeId, teamId) {
      return sharedGamesByRefTeam.get(`${refereeId}|${teamId}`) || 0;
    },
  };
}

function getEntityTeamId(entityId, mode, lookups) {
  if (mode.startsWith("team_")) return entityId;
  return lookups.players[entityId]?.teamId || null;
}

function buildPairCounts(events, entityKeyFn) {
  const counts = new Map();
  for (const event of events) {
    if (!event.refereeId) continue;
    const entityId = entityKeyFn(event);
    if (!entityId) continue;
    const key = `${event.refereeId}|${entityId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function getConfidenceThresholds() {
  return {
    lowPossessions: 60,
    mediumPossessions: 120,
    highPossessions: 180,
    mediumGames: 2,
    highGames: 3,
    mediumZ: 1.25,
    highZ: 2,
  };
}

function classifyBiasConfidence(row) {
  const thresholds = getConfidenceThresholds();
  let score = 0;

  if (row.possessions >= thresholds.lowPossessions) score += 1;
  if (row.possessions >= thresholds.mediumPossessions) score += 1;
  if (row.sharedGames >= thresholds.mediumGames) score += 1;
  if (Math.abs(row.standardizedSignal) >= thresholds.mediumZ) score += 1;
  if (row.possessions >= thresholds.highPossessions) score += 1;
  if (row.sharedGames >= thresholds.highGames) score += 1;
  if (Math.abs(row.standardizedSignal) >= thresholds.highZ) score += 1;

  if (score >= 6) {
    return {
      level: "high",
      label: "High confidence",
      note: "Strong exposure, multi-game coverage, and a large standardized signal.",
    };
  }

  if (score >= 4) {
    return {
      level: "medium",
      label: "Medium confidence",
      note: "Useful directional signal, but still sensitive to scope and game mix.",
    };
  }

  return {
    level: "low",
    label: "Low confidence",
    note: "Thin exposure or a small signal. Treat as exploratory only.",
  };
}

export function buildLookups(data) {
  const gameOfficialsByGame = {};
  for (const official of data.gameOfficials || []) {
    if (!gameOfficialsByGame[official.gameId]) {
      gameOfficialsByGame[official.gameId] = [];
    }
    gameOfficialsByGame[official.gameId].push(official);
  }

  return {
    teams: Object.fromEntries(data.teams.map((team) => [team.id, team])),
    players: Object.fromEntries(data.players.map((player) => [player.id, player])),
    referees: Object.fromEntries(data.referees.map((referee) => [referee.id, referee])),
    games: Object.fromEntries(data.games.map((game) => [game.id, game])),
    gameOfficialsByGame,
  };
}

export function groupCount(items, keyFn) {
  const counts = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

export function sumBy(items, valueFn) {
  return items.reduce((total, item) => total + valueFn(item), 0);
}

export function sortEntries(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function getGameLabel(game, lookups) {
  const away = lookups.teams[game.awayTeamId];
  const home = lookups.teams[game.homeTeamId];
  return `${away.abbreviation} @ ${home.abbreviation} | ${game.gameDate}`;
}

export function getEventContext(event, lookups) {
  const game = lookups.games[event.gameId];
  const againstSide = event.whistleAgainstSide || (event.penalizedTeamId === game?.homeTeamId ? "home" : "away");
  const benefitedSide = event.whistleBenefitedSide || (event.benefitedTeamId === game?.homeTeamId ? "home" : "away");
  const seasonType = event.seasonType || game?.seasonType || "Unknown";
  const scoreMargin = Math.abs(event.scoreMarginForHome);
  const isCloseGame = event.isCloseGame ?? scoreMargin <= 5;
  const isLastTwoMinutes = event.isLastTwoMinutes ?? (event.period >= 4 && parseClock(event.periodClock) <= 120);
  const isClutch = event.isClutch ?? (event.period >= 4 && parseClock(event.periodClock) <= 300 && scoreMargin <= 5);

  return {
    game,
    seasonType,
    againstSide,
    benefitedSide,
    isCloseGame,
    isLastTwoMinutes,
    isClutch,
  };
}

export function getScoreState(event, lookups) {
  const { isClutch } = getEventContext(event, lookups);
  const margin = Math.abs(event.scoreMarginForHome);
  if (isClutch) return "clutch";
  if (margin === 0) return "tie";
  if (margin <= 3) return "one-possession";
  if (margin <= 5) return "close";
  if (margin >= 10) return "blowout";
  return "middle";
}

export function matchesFilters(event, filters, lookups) {
  const context = getEventContext(event, lookups);

  if (filters.season !== "all" && (event.season || context.game?.season) !== filters.season) return false;
  if (filters.gameId !== "all" && event.gameId !== filters.gameId) return false;
  if (filters.refereeId !== "all" && event.refereeId !== filters.refereeId) return false;
  if (filters.teamId !== "all" && event.penalizedTeamId !== filters.teamId && event.benefitedTeamId !== filters.teamId) return false;
  if (filters.playerId !== "all" && event.penalizedPlayerId !== filters.playerId && event.benefitedPlayerId !== filters.playerId) return false;
  if (filters.period !== "all" && event.period !== Number(filters.period)) return false;
  if (filters.scoreState !== "all" && getScoreState(event, lookups) !== filters.scoreState) return false;
  if (filters.seasonType !== "all" && context.seasonType !== filters.seasonType) return false;

  if (filters.venueContext !== "all") {
    if (filters.venueContext === "against_home" && context.againstSide !== "home") return false;
    if (filters.venueContext === "against_away" && context.againstSide !== "away") return false;
    if (filters.venueContext === "benefit_home" && context.benefitedSide !== "home") return false;
    if (filters.venueContext === "benefit_away" && context.benefitedSide !== "away") return false;
  }

  return true;
}

export function getQuarterBreakdown(events) {
  const counts = new Map();
  events.forEach((event) => {
    const label = event.period <= 4 ? `Q${event.period}` : `OT${event.period - 4}`;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function getCallTypeBreakdown(events) {
  return sortEntries(groupCount(events, (event) => event.foulType));
}

export function getTopRows(events, keyFn, labelFn, limit = 5) {
  return sortEntries(groupCount(events, keyFn))
    .slice(0, limit)
    .map(([key, count]) => ({ key, label: labelFn(key), count }));
}

export function getRefereeSignalRows(events, lookups, data = null, filters = null) {
  const counts = groupCount(events, (event) => event.refereeId);
  const rows = sortEntries(counts).map(([refereeId, count]) => ({
    key: refereeId,
    label: lookups.referees[refereeId]?.displayName || refereeId,
    count,
  }));

  if (!data || !filters) {
    return rows;
  }

  const possessionStats = buildScopedPossessionStats(data, filters, lookups, new Set(getUniqueValues(events.map((event) => event.gameId))));
  return rows.map((row) => {
    const possessions = possessionStats.refereePossessions.get(row.key) || 0;
    return {
      ...row,
      possessions,
      ratePer100: possessions > 0 ? (row.count / possessions) * 100 : 0,
    };
  });
}

export function buildBiasRows(events, data, mode, lookups, filters = {}) {
  if (!events.length) return [];

  const modeConfig = {
    team_against: {
      entityLabel: (id) => lookups.teams[id]?.abbreviation || id,
      entityKey: (event) => event.penalizedTeamId,
      title: "Team penalized",
    },
    team_benefited: {
      entityLabel: (id) => lookups.teams[id]?.abbreviation || id,
      entityKey: (event) => event.benefitedTeamId,
      title: "Team benefited",
    },
    player_against: {
      entityLabel: (id) => lookups.players[id]?.displayName || id,
      entityKey: (event) => event.penalizedPlayerId,
      title: "Player penalized",
    },
    player_benefited: {
      entityLabel: (id) => lookups.players[id]?.displayName || id,
      entityKey: (event) => event.benefitedPlayerId,
      title: "Player benefited",
    },
  };

  const config = modeConfig[mode];
  if (!config) return [];

  const scopedGameIds = new Set(getUniqueValues(events.map((event) => event.gameId)));
  const possessionStats = buildScopedPossessionStats(data, filters, lookups, scopedGameIds);
  const refCounts = groupCount(events, (event) => event.refereeId);
  const entityCounts = groupCount(events, config.entityKey);
  const pairCounts = buildPairCounts(events, config.entityKey);
  const relevantRefereeIds = getUniqueValues(events.map((event) => event.refereeId));
  const relevantEntityIds = getUniqueValues(events.map(config.entityKey));
  const globalRatePer100 = possessionStats.totalPossessions > 0 ? (events.length / possessionStats.totalPossessions) * 100 : 0;
  const rows = [];

  for (const refereeId of relevantRefereeIds) {
    const refereeName = lookups.referees[refereeId]?.displayName || refereeId;
    const refereeTotal = refCounts.get(refereeId) || 0;
    const refPossessions = possessionStats.refereePossessions.get(refereeId) || 0;
    const refRatePer100 = refPossessions > 0 ? (refereeTotal / refPossessions) * 100 : 0;
    if (!refereeTotal || !refPossessions) continue;

    for (const entityId of relevantEntityIds) {
      const pairKey = `${refereeId}|${entityId}`;
      const actual = pairCounts.get(pairKey) || 0;
      const entityTeamId = getEntityTeamId(entityId, mode, lookups);
      if (!entityTeamId) continue;

      const entityPossessions = possessionStats.teamPossessions.get(entityTeamId) || 0;
      const sharedPossessions = possessionStats.getSharedPossessions(refereeId, entityTeamId);
      const sharedGames = possessionStats.getSharedGames(refereeId, entityTeamId);
      if (!entityPossessions || !sharedPossessions) continue;

      const entityTotal = entityCounts.get(entityId) || 0;
      const entityRatePer100 = entityPossessions > 0 ? (entityTotal / entityPossessions) * 100 : 0;
      const expectedRatePer100 =
        globalRatePer100 > 0 ? (refRatePer100 * entityRatePer100) / globalRatePer100 : 0;
      const expected = (sharedPossessions * expectedRatePer100) / 100;
      const signal = actual - expected;
      const ratePer100 = sharedPossessions > 0 ? (actual / sharedPossessions) * 100 : 0;
      const rateDiffPer100 = ratePer100 - expectedRatePer100;
      const standardizedSignal = expected > 0 ? signal / Math.sqrt(expected) : 0;

      if (actual === 0 && expected < 1) continue;
      if (sharedPossessions < 25) continue;

      rows.push({
        refereeId,
        refereeName,
        entityId,
        entityLabel: config.entityLabel(entityId),
        entityTeamId,
        actual,
        expected,
        signal,
        intensity: expected > 0 ? actual / expected : 0,
        title: config.title,
        possessions: sharedPossessions,
        sharedGames,
        baselineRatePer100: expectedRatePer100,
        entityRatePer100,
        refereeRatePer100: refRatePer100,
        ratePer100,
        rateDiffPer100,
        standardizedSignal,
      });
    }
  }

  return rows
    .map((row) => ({
      ...row,
      confidence: classifyBiasConfidence(row),
    }))
    .sort((a, b) => {
      if (Math.abs(b.standardizedSignal) !== Math.abs(a.standardizedSignal)) {
        return Math.abs(b.standardizedSignal) - Math.abs(a.standardizedSignal);
      }
      return Math.abs(b.rateDiffPer100) - Math.abs(a.rateDiffPer100);
    })
    .slice(0, 18);
}

export function getBiasExplainability(rows) {
  const thresholds = getConfidenceThresholds();
  const confidenceCounts = { high: 0, medium: 0, low: 0 };

  rows.forEach((row) => {
    const level = row.confidence?.level || "low";
    confidenceCounts[level] = (confidenceCounts[level] || 0) + 1;
  });

  const sampleWarnings = [];
  if (!rows.length) {
    sampleWarnings.push("No pairs met the minimum shared-possession threshold for this scope.");
  } else {
    const lowExposureCount = rows.filter((row) => row.possessions < thresholds.mediumPossessions).length;
    const oneGameCount = rows.filter((row) => row.sharedGames < thresholds.mediumGames).length;
    const lowSignalCount = rows.filter((row) => Math.abs(row.standardizedSignal) < thresholds.mediumZ).length;

    if (lowExposureCount) {
      sampleWarnings.push(`${lowExposureCount} rows are based on fewer than ${thresholds.mediumPossessions} shared possessions.`);
    }
    if (oneGameCount) {
      sampleWarnings.push(`${oneGameCount} rows only appear in one game of shared exposure.`);
    }
    if (lowSignalCount) {
      sampleWarnings.push(`${lowSignalCount} rows have a standardized signal below ${thresholds.mediumZ.toFixed(2)}.`);
    }
  }

  return {
    thresholds,
    confidenceCounts,
    sampleWarnings,
  };
}

export function getAdjustedRefereeMetrics(events, data, lookups, filters, refereeId) {
  if (!refereeId || refereeId === "all") return null;
  const scopedGameIds = new Set(getUniqueValues(events.map((event) => event.gameId)));
  const possessionStats = buildScopedPossessionStats(data, filters, lookups, scopedGameIds);
  const refEvents = events.filter((event) => event.refereeId === refereeId);
  const possessions = possessionStats.refereePossessions.get(refereeId) || 0;
  const whistles = refEvents.length;
  const freeThrows = sumBy(refEvents, (event) => event.freeThrowsAwarded || 0);
  return {
    possessions,
    whistlesPer100: possessions > 0 ? (whistles / possessions) * 100 : 0,
    freeThrowsPer100: possessions > 0 ? (freeThrows / possessions) * 100 : 0,
  };
}

export function getAdjustedEntityMetrics(events, data, lookups, filters, entityMode, entityId) {
  if (!entityId || entityId === "all") return null;
  const scopedGameIds = new Set(getUniqueValues(events.map((event) => event.gameId)));
  const possessionStats = buildScopedPossessionStats(data, filters, lookups, scopedGameIds);
  const teamId = entityMode === "player" ? lookups.players[entityId]?.teamId : entityId;
  if (!teamId) return null;

  const possessions = possessionStats.teamPossessions.get(teamId) || 0;
  const againstCount = events.filter((event) =>
    entityMode === "player" ? event.penalizedPlayerId === entityId : event.penalizedTeamId === entityId,
  ).length;
  const benefitCount = events.filter((event) =>
    entityMode === "player" ? event.benefitedPlayerId === entityId : event.benefitedTeamId === entityId,
  ).length;

  return {
    possessions,
    againstPer100: possessions > 0 ? (againstCount / possessions) * 100 : 0,
    benefitPer100: possessions > 0 ? (benefitCount / possessions) * 100 : 0,
  };
}

export function getCoverageSummary(events, data, lookups) {
  const crewLookups = buildCrewLookups(data, lookups);
  const gameIds = new Set(events.map((event) => event.gameId).filter(Boolean));
  const refereeIds = new Set(events.map((event) => event.refereeId).filter(Boolean));
  const teamIds = new Set(events.flatMap((event) => [event.penalizedTeamId, event.benefitedTeamId]).filter(Boolean));
  const playerIds = new Set(events.flatMap((event) => [event.penalizedPlayerId, event.benefitedPlayerId]).filter(Boolean));
  const crewIds = new Set(
    [...gameIds]
      .map((gameId) => crewLookups.byGameId.get(gameId)?.crewId || null)
      .filter(Boolean),
  );
  const reviewed = events.filter((event) => event.challengeReviewed);
  const inferredChallenges = reviewed.filter(
    (event) => !event.challengeOutcomeSource || event.challengeOutcomeSource === "inferred",
  ).length;
  const l2mTagged = events.filter((event) => event.l2mDecision).length;

  return {
    games: gameIds.size,
    referees: refereeIds.size,
    crews: crewIds.size,
    teams: teamIds.size,
    players: playerIds.size,
    reviewedWhistles: reviewed.length,
    inferredChallengeShare: reviewed.length ? inferredChallenges / reviewed.length : 0,
    l2mShare: events.length ? l2mTagged / events.length : 0,
  };
}

export function getCrewAnalytics(events, data, lookups) {
  const crewLookups = buildCrewLookups(data, lookups);
  const rowsByCrew = new Map();

  for (const event of events) {
    const crew = crewLookups.byGameId.get(event.gameId);
    if (!crew) continue;

    if (!rowsByCrew.has(crew.crewId)) {
      rowsByCrew.set(crew.crewId, {
        crewId: crew.crewId,
        refereeIds: crew.refereeIds,
        gameIds: new Set(),
        totalCalls: 0,
        freeThrowsAwarded: 0,
        reviewedCalls: 0,
        overturnedCalls: 0,
        againstHomeCalls: 0,
        againstAwayCalls: 0,
        benefitHomeCalls: 0,
        benefitAwayCalls: 0,
        closeGameCalls: 0,
        lastTwoMinutesCalls: 0,
        periodCounts: new Map(),
      });
    }

    const row = rowsByCrew.get(crew.crewId);
    row.gameIds.add(event.gameId);
    row.totalCalls += 1;
    row.freeThrowsAwarded += event.freeThrowsAwarded || 0;
    row.reviewedCalls += event.challengeReviewed ? 1 : 0;
    row.overturnedCalls += event.challengeOverturned ? 1 : 0;
    row.againstHomeCalls += event.whistleAgainstSide === "home" ? 1 : 0;
    row.againstAwayCalls += event.whistleAgainstSide === "away" ? 1 : 0;
    row.benefitHomeCalls += event.whistleBenefitedSide === "home" ? 1 : 0;
    row.benefitAwayCalls += event.whistleBenefitedSide === "away" ? 1 : 0;
    row.closeGameCalls += event.isCloseGame ? 1 : 0;
    row.lastTwoMinutesCalls += event.isLastTwoMinutes ? 1 : 0;
    const periodLabel = event.period <= 4 ? `Q${event.period}` : `OT${event.period - 4}`;
    row.periodCounts.set(periodLabel, (row.periodCounts.get(periodLabel) || 0) + 1);
  }

  const rows = [...rowsByCrew.values()].map((row) => {
    const gameCount = row.gameIds.size || 1;
    const quarterLabels = ["Q1", "Q2", "Q3", "Q4"];
    const quarterCounts = quarterLabels.map((label) => row.periodCounts.get(label) || 0);
    const averageQuarterCalls = quarterCounts.reduce((total, value) => total + value, 0) / quarterLabels.length;
    const quarterVariance =
      quarterLabels.length > 0
        ? quarterCounts.reduce((total, value) => total + (value - averageQuarterCalls) ** 2, 0) / quarterLabels.length
        : 0;
    const quarterStdDev = Math.sqrt(quarterVariance);
    const consistencyScore =
      averageQuarterCalls > 0 ? Math.max(0, 100 - (quarterStdDev / averageQuarterCalls) * 100) : 0;
    const crewLabel = row.refereeIds
      .map((refereeId) => lookups.referees[refereeId]?.displayName || refereeId)
      .join(" | ");

    return {
      crewId: row.crewId,
      crewLabel,
      refereeIds: row.refereeIds,
      games: gameCount,
      totalCalls: row.totalCalls,
      callsPerGame: row.totalCalls / gameCount,
      freeThrowsAwarded: row.freeThrowsAwarded,
      reviewedCalls: row.reviewedCalls,
      overturnedCalls: row.overturnedCalls,
      overturnRate: row.reviewedCalls ? row.overturnedCalls / row.reviewedCalls : 0,
      againstHomeShare: row.totalCalls ? row.againstHomeCalls / row.totalCalls : 0,
      benefitHomeShare: row.totalCalls ? row.benefitHomeCalls / row.totalCalls : 0,
      closeGameCalls: row.closeGameCalls,
      lastTwoMinutesCalls: row.lastTwoMinutesCalls,
      consistencyScore,
      quarterCounts: Object.fromEntries(row.periodCounts),
    };
  });

  rows.sort((a, b) => b.totalCalls - a.totalCalls || b.callsPerGame - a.callsPerGame);

  return {
    rows,
    metrics: {
      crews: rows.length,
      games: new Set(events.map((event) => event.gameId)).size,
      averageCallsPerCrewGame: rows.length ? rows.reduce((total, row) => total + row.callsPerGame, 0) / rows.length : 0,
      reviewRate: rows.length
        ? rows.reduce((total, row) => total + row.reviewedCalls, 0) / Math.max(1, rows.reduce((total, row) => total + row.totalCalls, 0))
        : 0,
    },
  };
}

export function getRefereeProfileData(events, data, lookups, filters, refereeId) {
  if (!refereeId || refereeId === "all") return null;
  const referee = lookups.referees[refereeId] || null;
  if (!referee) return null;

  const refEvents = events.filter((event) => event.refereeId === refereeId);
  const adjustedMetrics = getAdjustedRefereeMetrics(events, data, lookups, filters, refereeId);
  const againstPlayers = getTopRows(
    refEvents.filter((event) => event.penalizedPlayerId),
    (event) => event.penalizedPlayerId,
    (playerId) => lookups.players[playerId]?.displayName || playerId,
    8,
  );
  const againstTeams = getTopRows(
    refEvents,
    (event) => event.penalizedTeamId,
    (teamId) => lookups.teams[teamId]?.abbreviation || teamId,
    8,
  );
  const benefitedPlayers = getTopRows(
    refEvents.filter((event) => event.benefitedPlayerId),
    (event) => event.benefitedPlayerId,
    (playerId) => lookups.players[playerId]?.displayName || playerId,
    8,
  );
  const benefitedTeams = getTopRows(
    refEvents,
    (event) => event.benefitedTeamId,
    (teamId) => lookups.teams[teamId]?.abbreviation || teamId,
    8,
  );
  const quarterRows = getQuarterBreakdown(refEvents).map(([label, count]) => ({ label, count }));
  const seasonRows = getSeasonSplitRows(refEvents, lookups);
  const againstVenueRows = getHomeAwaySplitRows(refEvents, lookups, "against");
  const benefitVenueRows = getHomeAwaySplitRows(refEvents, lookups, "benefit");
  const crewLookups = buildCrewLookups(data, lookups);
  const crewCounts = new Map();

  for (const event of refEvents) {
    const crewId = crewLookups.byGameId.get(event.gameId)?.crewId;
    if (!crewId) continue;
    crewCounts.set(crewId, (crewCounts.get(crewId) || 0) + 1);
  }

  const crewRows = [...crewCounts.entries()]
    .map(([crewId, count]) => {
      const crew = crewLookups.byCrewId.get(crewId);
      return {
        label: (crew?.refereeIds || [])
          .map((id) => lookups.referees[id]?.displayName || id)
          .join(" | "),
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const reviewedEvents = refEvents.filter((event) => event.challengeReviewed);
  const challengeRows = reviewedEvents
    .slice()
    .sort((a, b) => {
      const gameDateCompare = (lookups.games[b.gameId]?.gameDate || "").localeCompare(lookups.games[a.gameId]?.gameDate || "");
      if (gameDateCompare !== 0) return gameDateCompare;
      return b.gameClockSecondsElapsed - a.gameClockSecondsElapsed;
    })
    .slice(0, 12);

  const recentGamesMap = new Map();
  for (const event of refEvents) {
    if (!recentGamesMap.has(event.gameId)) {
      recentGamesMap.set(event.gameId, {
        gameId: event.gameId,
        whistles: 0,
        reviewed: 0,
        closeGameCalls: 0,
      });
    }
    const row = recentGamesMap.get(event.gameId);
    row.whistles += 1;
    row.reviewed += event.challengeReviewed ? 1 : 0;
    row.closeGameCalls += event.isCloseGame ? 1 : 0;
  }

  const recentGames = [...recentGamesMap.values()]
    .map((row) => ({
      ...row,
      game: lookups.games[row.gameId] || null,
    }))
    .sort((a, b) => (b.game?.gameDate || "").localeCompare(a.game?.gameDate || ""))
    .slice(0, 8);

  return {
    referee,
    metrics: {
      whistles: refEvents.length,
      whistlesPer100: adjustedMetrics?.whistlesPer100 || 0,
      freeThrowsPer100: adjustedMetrics?.freeThrowsPer100 || 0,
      freeThrowsAwarded: sumBy(refEvents, (event) => event.freeThrowsAwarded || 0),
      reviewedWhistles: reviewedEvents.length,
      overturnedWhistles: reviewedEvents.filter(
        (event) => event.challengeOverturned || String(event.challengeOutcome || "").startsWith("overturned"),
      ).length,
      closeGameCalls: refEvents.filter((event) => event.isCloseGame).length,
      lastTwoMinuteCalls: refEvents.filter((event) => event.isLastTwoMinutes).length,
      possessions: adjustedMetrics?.possessions || 0,
    },
    quarterRows,
    seasonRows,
    againstVenueRows,
    benefitVenueRows,
    againstPlayers,
    againstTeams,
    benefitedPlayers,
    benefitedTeams,
    crewRows,
    challengeRows,
    recentGames,
  };
}

export function getMonthlyTrendRows(events, lookups, metric = "calls") {
  const rows = new Map();

  for (const event of events) {
    const game = lookups.games[event.gameId];
    const monthKey = String(game?.gameDate || "").slice(0, 7);
    if (!monthKey) continue;

    if (!rows.has(monthKey)) {
      rows.set(monthKey, {
        label: monthKey,
        calls: 0,
        reviewed: 0,
        overturned: 0,
        freeThrows: 0,
        l2mTagged: 0,
        gameIds: new Set(),
      });
    }

    const row = rows.get(monthKey);
    row.calls += 1;
    row.reviewed += event.challengeReviewed ? 1 : 0;
    row.overturned += event.challengeOverturned ? 1 : 0;
    row.freeThrows += event.freeThrowsAwarded || 0;
    row.l2mTagged += event.l2mDecision ? 1 : 0;
    row.gameIds.add(event.gameId);
  }

  return [...rows.values()]
    .map((row) => ({
      label: row.label,
      games: row.gameIds.size,
      count:
        metric === "reviewed"
          ? row.reviewed
          : metric === "overturned"
            ? row.overturned
            : metric === "free_throws"
              ? row.freeThrows
              : metric === "l2m"
                ? row.l2mTagged
                : row.calls,
      calls: row.calls,
      reviewed: row.reviewed,
      overturned: row.overturned,
      freeThrows: row.freeThrows,
      l2mTagged: row.l2mTagged,
      reviewRate: row.calls ? row.reviewed / row.calls : 0,
      overturnRate: row.reviewed ? row.overturned / row.reviewed : 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getRefereeTrendRows(events, lookups, limit = 8) {
  const rows = new Map();

  for (const event of events) {
    const game = lookups.games[event.gameId];
    const monthKey = String(game?.gameDate || "").slice(0, 7);
    if (!monthKey || !event.refereeId) continue;

    const key = `${monthKey}|${event.refereeId}`;
    if (!rows.has(key)) {
      rows.set(key, {
        month: monthKey,
        refereeId: event.refereeId,
        refereeName: lookups.referees[event.refereeId]?.displayName || event.refereeId,
        count: 0,
      });
    }
    rows.get(key).count += 1;
  }

  return [...rows.values()]
    .sort((a, b) => {
      if (a.month !== b.month) return a.month.localeCompare(b.month);
      return b.count - a.count;
    })
    .slice(-limit * 4);
}

export function getOpponentContextRows(events, lookups, entityMode, entityId) {
  if (!entityId || entityId === "all") return { againstOpponents: [], benefitOpponents: [], venueOpponentRows: [] };

  const targetTeamId = entityMode === "player" ? lookups.players[entityId]?.teamId : entityId;
  if (!targetTeamId) {
    return { againstOpponents: [], benefitOpponents: [], venueOpponentRows: [] };
  }

  const againstCounts = new Map();
  const benefitCounts = new Map();
  const venueOpponentCounts = new Map();

  for (const event of events) {
    const game = lookups.games[event.gameId];
    if (!game) continue;
    const opponentTeamId = String(game.homeTeamId) === String(targetTeamId) ? game.awayTeamId : game.homeTeamId;
    const opponentLabel = lookups.teams[opponentTeamId]?.abbreviation || opponentTeamId;
    const context = getEventContext(event, lookups);

    const targetAgainst =
      entityMode === "player" ? event.penalizedPlayerId === entityId : event.penalizedTeamId === entityId;
    const targetBenefit =
      entityMode === "player" ? event.benefitedPlayerId === entityId : event.benefitedTeamId === entityId;

    if (targetAgainst) {
      againstCounts.set(opponentLabel, (againstCounts.get(opponentLabel) || 0) + 1);
      const venueKey = `${opponentLabel}|${context.againstSide || "unknown"}`;
      venueOpponentCounts.set(venueKey, (venueOpponentCounts.get(venueKey) || 0) + 1);
    }

    if (targetBenefit) {
      benefitCounts.set(opponentLabel, (benefitCounts.get(opponentLabel) || 0) + 1);
    }
  }

  const againstOpponents = sortEntries(againstCounts).map(([label, count]) => ({ label, count })).slice(0, 8);
  const benefitOpponents = sortEntries(benefitCounts).map(([label, count]) => ({ label, count })).slice(0, 8);
  const venueOpponentRows = [...venueOpponentCounts.entries()]
    .map(([key, count]) => {
      const [opponent, side] = key.split("|");
      return {
        label: `${opponent} | ${side === "home" ? "home whistle" : side === "away" ? "away whistle" : side}`,
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    againstOpponents,
    benefitOpponents,
    venueOpponentRows,
  };
}

export function getHomeAwaySplitRows(events, lookups, direction = "against") {
  const counts = { home: 0, away: 0 };
  events.forEach((event) => {
    const context = getEventContext(event, lookups);
    const side = direction === "against" ? context.againstSide : context.benefitedSide;
    if (side === "home" || side === "away") {
      counts[side] += 1;
    }
  });

  return [
    { label: direction === "against" ? "Against home team" : "Benefiting home team", count: counts.home },
    { label: direction === "against" ? "Against away team" : "Benefiting away team", count: counts.away },
  ];
}

export function getSeasonSplitRows(events, lookups) {
  const counts = new Map();
  events.forEach((event) => {
    const { seasonType } = getEventContext(event, lookups);
    counts.set(seasonType, (counts.get(seasonType) || 0) + 1);
  });
  return sortEntries(counts).map(([label, count]) => ({ label, count }));
}

export function getSeasonRows(events, lookups) {
  const counts = new Map();
  events.forEach((event) => {
    const season = event.season || lookups.games[event.gameId]?.season || "Unknown";
    counts.set(season, (counts.get(season) || 0) + 1);
  });
  return sortEntries(counts).map(([label, count]) => ({ label, count }));
}

export function getSummaryRows(data, tableName, filters = {}) {
  const rows = data.summaryTables?.[tableName] || [];
  return rows.filter((row) =>
    Object.entries(filters).every(([key, value]) => value === undefined || value === "all" || row[key] === value),
  );
}

export function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function formatDecimal(value) {
  return Number(value || 0).toFixed(1);
}

export function formatSignal(value) {
  const rounded = Number(value || 0).toFixed(1);
  return value > 0 ? `+${rounded}` : rounded;
}

export function humanizeCallType(callType) {
  return callType.replaceAll("_", " ");
}

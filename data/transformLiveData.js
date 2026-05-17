function inferSeasonFromGameId(gameId) {
  const seasonStartTwoDigit = Number(String(gameId).slice(3, 5));
  const seasonStart = 2000 + seasonStartTwoDigit;
  const seasonEnd = String(seasonStart + 1).slice(-2);
  return `${seasonStart}-${seasonEnd}`;
}

function inferSeasonTypeFromGameId(gameId) {
  const prefix = String(gameId).slice(0, 3);
  if (prefix === "001") return "Pre Season";
  if (prefix === "002") return "Regular Season";
  if (prefix === "003") return "All-Star";
  if (prefix === "004") return "Playoffs";
  return "Unknown";
}

function normalizeDate(scheduleGameDate) {
  const rawDate = String(scheduleGameDate || "").split(" ")[0];
  if (!rawDate) return "";
  if (rawDate.includes("-")) return rawDate.slice(0, 10);
  const [month, day, year] = rawDate.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseClock(clock) {
  const match = /^PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(clock || "");
  if (!match) return 0;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2] || 0);
  return Math.max(0, Math.round(minutes * 60 + seconds));
}

function formatClock(clock) {
  const totalSeconds = parseClock(clock);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getPeriodLength(period) {
  return period <= 4 ? 12 * 60 : 5 * 60;
}

function getGameClockElapsed(period, clock) {
  let elapsed = 0;
  for (let currentPeriod = 1; currentPeriod < period; currentPeriod += 1) {
    elapsed += getPeriodLength(currentPeriod);
  }
  return elapsed + (getPeriodLength(period) - parseClock(clock));
}

function getEventFlags(period, scoreMarginForHome, periodClockSeconds) {
  return {
    isClutch: period >= 4 && periodClockSeconds <= 5 * 60 && Math.abs(scoreMarginForHome) <= 5,
    isCloseGame: Math.abs(scoreMarginForHome) <= 5,
    isLastTwoMinutes: period >= 4 && periodClockSeconds <= 2 * 60,
  };
}

function normalizeAssignment(assignment) {
  return String(assignment || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeFoulType(action) {
  const subType = String(action.subType || "").toLowerCase();
  const description = String(action.description || "").toLowerCase();
  const descriptor = String(action.descriptor || "").toLowerCase();

  if (subType.includes("technical") || description.includes("technical")) return "technical";
  if (subType.includes("offensive") || subType.includes("charge") || description.includes("offensive foul")) return "offensive";
  if (subType.includes("loose") || descriptor.includes("loose ball") || description.includes("loose ball")) return "loose_ball";
  if (subType.includes("away") || description.includes("away from play")) return "away_from_play";
  if (description.includes("take foul") || description.includes("transition take foul")) return "take_foul";
  if (subType.includes("shoot") || description.includes("shooting foul")) return "shooting";
  return "personal";
}

function inferBenefitedTeamId(action, playerTeamMap, homeTeamId, awayTeamId) {
  if (action.foulDrawnPersonId && playerTeamMap.get(String(action.foulDrawnPersonId))) {
    return playerTeamMap.get(String(action.foulDrawnPersonId));
  }
  if (action.possession) return String(action.possession);
  if (action.teamId) return String(action.teamId) === String(homeTeamId) ? String(awayTeamId) : String(homeTeamId);
  return null;
}

function inferFreeThrows(actions, foulIndex, action) {
  const benefitedPlayerId = action.foulDrawnPersonId ? String(action.foulDrawnPersonId) : null;
  const currentPeriod = action.period;
  let awarded = 0;

  for (let index = foulIndex + 1; index < actions.length; index += 1) {
    const nextAction = actions[index];
    if (!nextAction || nextAction.period !== currentPeriod) break;

    if (nextAction.actionType === "freethrow") {
      if (!benefitedPlayerId || String(nextAction.personId) === benefitedPlayerId) {
        awarded += 1;
        continue;
      }
    }

    if (nextAction.actionType === "substitution" || nextAction.actionType === "timeout") continue;
    break;
  }

  return awarded;
}

function getSourceConfidence({ refereeMapped, benefitedPlayerId, benefitedTeamId, penalizedPlayerId }) {
  if (refereeMapped && benefitedPlayerId && penalizedPlayerId) return 0.99;
  if (refereeMapped && benefitedTeamId) return 0.93;
  if (benefitedTeamId) return 0.85;
  return 0.72;
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseL2MPeriod(periodName) {
  if (String(periodName).startsWith("Q")) return Number(String(periodName).slice(1));
  if (String(periodName).startsWith("OT")) return 4 + Number(String(periodName).slice(2) || 1);
  return null;
}

export function buildOverview(foulEvents, games, referees, challengeEvents, lastTwoMinuteReviews) {
  return {
    totalGames: games.length,
    totalReferees: referees.length,
    totalCalls: foulEvents.length,
    clutchCalls: foulEvents.filter((event) => event.isClutch).length,
    reviewedCalls: foulEvents.filter((event) => event.challengeReviewed).length,
    overturnedCalls: foulEvents.filter((event) => event.challengeOverturned).length,
    totalChallenges: challengeEvents.length,
    totalL2MReviews: lastTwoMinuteReviews.length,
    l2mIncorrectCalls: lastTwoMinuteReviews.filter((review) => review.decision === "IC").length,
    l2mIncorrectNonCalls: lastTwoMinuteReviews.filter((review) => review.decision === "INC").length,
  };
}

function buildRawPlayByPlayEvents(gameId, actions) {
  return actions.map((action) => ({
    id: `${gameId}-raw-${String(action.actionNumber).padStart(4, "0")}`,
    gameId,
    sourceEventId: `${action.actionNumber}`,
    period: Number(action.period || 0),
    clock: formatClock(action.clock),
    actionType: action.actionType || "",
    subType: action.subType || "",
    description: action.description || "",
    homeScore: action.scoreHome != null ? Number(action.scoreHome) : null,
    awayScore: action.scoreAway != null ? Number(action.scoreAway) : null,
    scoreMargin:
      action.scoreHome != null && action.scoreAway != null
        ? Number(action.scoreHome) - Number(action.scoreAway)
        : null,
    possessionTeamId: action.possession != null ? String(action.possession) : null,
    officialIdRaw: action.officialId != null ? String(action.officialId) : null,
    teamIdRaw: action.teamId != null ? String(action.teamId) : null,
    personIdRaw: action.personId != null ? String(action.personId) : null,
    payloadJson: action,
    occurredAt: action.timeActual || null,
  }));
}

function scoreChallengeCandidate(candidate, challengeAction, challengeTeamId) {
  const candidateTeamId = candidate.teamId != null ? String(candidate.teamId) : null;
  const candidateClock = parseClock(candidate.clock);
  const challengeClock = parseClock(challengeAction.clock);
  const timeGap = Math.max(0, candidateClock - challengeClock);
  const sameClock = candidate.clock === challengeAction.clock;

  let score = 0;

  if (sameClock) score += 5;
  if (timeGap <= 15) score += 3;

  if (["foul", "violation", "turnover"].includes(candidate.actionType)) score += 5;
  if (["rebound", "jumpball", "outofbounds"].includes(candidate.actionType)) score += 3;

  if (candidateTeamId && challengeTeamId && candidateTeamId === challengeTeamId) {
    if (["foul", "violation", "turnover"].includes(candidate.actionType)) score += 5;
    if (["rebound", "jumpball"].includes(candidate.actionType)) score -= 2;
  }

  if (candidateTeamId && challengeTeamId && candidateTeamId !== challengeTeamId) {
    if (candidate.actionType === "rebound") score += 2;
  }

  return score;
}

function findLinkedChallengeAction(actions, challengeIndex, challengeTeamId) {
  const challengeAction = actions[challengeIndex];
  const candidates = [];

  for (let index = challengeIndex - 1; index >= Math.max(0, challengeIndex - 10); index -= 1) {
    const candidate = actions[index];
    if (!candidate || candidate.period !== challengeAction.period) continue;
    const challengeClock = parseClock(challengeAction.clock);
    const candidateClock = parseClock(candidate.clock);
    if (candidateClock - challengeClock > 15) continue;
    candidates.push(candidate);
  }

  return candidates
    .map((candidate) => ({ candidate, score: scoreChallengeCandidate(candidate, challengeAction, challengeTeamId) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

function findNextCompetitiveAction(actions, challengeIndex) {
  for (let index = challengeIndex + 1; index < actions.length; index += 1) {
    const action = actions[index];
    if (!action) continue;
    if (["substitution", "timeout"].includes(action.actionType)) continue;
    return action;
  }
  return null;
}

function findNextCompetitiveActions(actions, challengeIndex, limit = 4) {
  const nextActions = [];
  for (let index = challengeIndex + 1; index < actions.length && nextActions.length < limit; index += 1) {
    const action = actions[index];
    if (!action) continue;
    if (["substitution", "timeout"].includes(action.actionType)) continue;
    nextActions.push(action);
  }
  return nextActions;
}

function buildChallengeInference(outcome, overturned, targetType, confidence, reason) {
  return {
    outcome,
    overturned,
    targetType,
    confidence,
    source: "inferred",
    reason,
  };
}

function inferChallengeOutcome({ challengeTeamId, linkedAction, linkedFoulEvent, nextCompetitiveAction, nextCompetitiveActions = [] }) {
  const nextTeamId = nextCompetitiveAction?.teamId != null ? String(nextCompetitiveAction.teamId) : null;
  const nextPossessionTeamId = nextCompetitiveAction?.possession != null ? String(nextCompetitiveAction.possession) : null;
  const freeThrowFollows = nextCompetitiveActions.some((action) => action.actionType === "freethrow");
  const jumpBallFollows = nextCompetitiveActions.some((action) => action.actionType === "jumpball");
  const turnoverFollows = nextCompetitiveActions.some((action) => action.actionType === "turnover");
  const reboundFollows = nextCompetitiveActions.some((action) => action.actionType === "rebound");

  if (linkedFoulEvent && challengeTeamId) {
    if (linkedFoulEvent.penalizedTeamId === challengeTeamId) {
      if (freeThrowFollows && linkedFoulEvent.benefitedTeamId) {
        return buildChallengeInference(
          "upheld_likely",
          false,
          "foul",
          0.88,
          "penalized_team_challenged_and_free_throws_followed",
        );
      }

      if (nextTeamId && nextTeamId === challengeTeamId && !freeThrowFollows) {
        return buildChallengeInference(
          "overturned_likely",
          true,
          "foul",
          0.73,
          "penalized_team_challenged_and_kept_possession",
        );
      }

      if (nextPossessionTeamId && nextPossessionTeamId === challengeTeamId && !freeThrowFollows) {
        return buildChallengeInference(
          "overturned_likely",
          true,
          "foul",
          0.69,
          "penalized_team_challenged_and_next_possession_flipped",
        );
      }

      return buildChallengeInference(
        "upheld_likely",
        false,
        "foul",
        0.74,
        "penalized_team_challenged_original_foul",
      );
    }

    if (linkedFoulEvent.benefitedTeamId === challengeTeamId) {
      if (nextTeamId && nextTeamId !== challengeTeamId && !freeThrowFollows) {
        return buildChallengeInference(
          "upheld_likely",
          false,
          "foul",
          0.56,
          "benefited_team_challenged_but_possession_flipped_away",
        );
      }

      return buildChallengeInference(
        "unknown",
        false,
        "foul",
        0.32,
        "benefited_team_challenged_foul_context_ambiguous",
      );
    }
  }

  if (linkedAction?.actionType === "rebound") {
    if (nextCompetitiveAction?.actionType === "jumpball") {
      return buildChallengeInference(
        "overturned_likely",
        true,
        "possession",
        0.67,
        "rebound_review_led_to_jump_ball",
      );
    }

    if (challengeTeamId && nextTeamId && nextTeamId === challengeTeamId) {
      return buildChallengeInference(
        "overturned_likely",
        true,
        "possession",
        0.61,
        "rebound_review_returned_ball_to_challenging_team",
      );
    }
  }

  if (linkedAction?.actionType === "turnover" && challengeTeamId && String(linkedAction.teamId) === challengeTeamId) {
    if (nextTeamId && nextTeamId === challengeTeamId && !turnoverFollows && !reboundFollows) {
      return buildChallengeInference(
        "overturned_likely",
        true,
        "turnover",
        0.72,
        "turnover_review_returned_ball_to_challenging_team",
      );
    }

    return buildChallengeInference(
      "upheld_likely",
      false,
      "turnover",
      0.67,
      "challenging_team_was_charged_with_turnover_and_sequence_held",
    );
  }

  if (jumpBallFollows) {
    return buildChallengeInference(
      "overturned_likely",
      true,
      linkedAction?.actionType || "possession",
      0.48,
      "challenge_sequence_led_to_jump_ball",
    );
  }

  return buildChallengeInference(
    "unknown",
    false,
    linkedAction?.actionType || "unknown",
    0.25,
    "insufficient_post_challenge_signal",
  );
}

function applyL2MOverlay({ gameId, l2mReport, foulEventsForGame, playerIdsByName }) {
  if (!l2mReport?.l2m?.length) {
    return [];
  }

  const reviews = [];

  for (const [index, row] of l2mReport.l2m.entries()) {
    const period = parseL2MPeriod(row.PeriodName);
    const clock = row.PCTime || "";
    const committingPlayerId = playerIdsByName.get(normalizeName(row.CP)) || null;
    const disadvantagedPlayerId = playerIdsByName.get(normalizeName(row.DP)) || null;

    const candidates = foulEventsForGame.filter((event) => event.period === period && event.periodClock === clock);
    const scoredCandidates = candidates
      .map((event) => {
        let score = 0;
        if (committingPlayerId && event.penalizedPlayerId === committingPlayerId) score += 3;
        if (disadvantagedPlayerId && event.benefitedPlayerId === disadvantagedPlayerId) score += 3;
        if ((row.CallType || "").toLowerCase().includes(event.foulType.replaceAll("_", " "))) score += 1;
        return { event, score };
      })
      .sort((a, b) => b.score - a.score);

    const matchedFoul = scoredCandidates[0]?.score > 0 ? scoredCandidates[0].event : null;

    if (matchedFoul) {
      matchedFoul.l2mDecision = row.CallRatingName || null;
      matchedFoul.l2mCallType = row.CallType || null;
      matchedFoul.l2mComment = row.Comment || null;
      matchedFoul.l2mVideoUrl = row.VideolLink
        ? `https://official.nba.com/last-two-minute-report/?gameNo=${gameId}&eventNum=${row.VideolLink}`
        : null;
      matchedFoul.correctnessBucket = row.CallRatingName || null;
    }

    reviews.push({
      id: `${gameId}-l2m-${index + 1}`,
      gameId,
      foulEventId: matchedFoul?.id || null,
      period,
      clock,
      decision: row.CallRatingName || "unknown",
      callType: row.CallType || null,
      reviewType: row.Difficulty || null,
      committingPlayerId,
      disadvantagedPlayerId,
      comment: row.Comment || null,
      videoUrl: row.VideolLink
        ? `https://official.nba.com/last-two-minute-report/?gameNo=${gameId}&eventNum=${row.VideolLink}`
        : null,
      payloadJson: row,
    });
  }

  return reviews;
}

function getChallengeOutcomeBucket(outcome) {
  const normalized = String(outcome || "").toLowerCase();
  if (normalized.startsWith("upheld")) return "upheld";
  if (normalized.startsWith("overturned")) return "overturned";
  return "unknown";
}

function buildCrewId(refereeIds = []) {
  return [...new Set(refereeIds.map((refereeId) => String(refereeId)).filter(Boolean))].sort().join("__");
}

export function buildSummaryTables(foulEvents, challengeEvents = [], gameOfficials = []) {
  const refereeOverviewMap = new Map();
  const refereeEntityMap = new Map();
  const challengeRefereeOverviewMap = new Map();
  const challengeTeamOverviewMap = new Map();
  const challengeOutcomeOverviewMap = new Map();
  const crewOverviewMap = new Map();
  const crewChallengeOverviewMap = new Map();
  const foulEventsById = new Map(foulEvents.map((event) => [event.id, event]));
  const crewByGameId = new Map();

  for (const official of gameOfficials) {
    if (!crewByGameId.has(official.gameId)) {
      crewByGameId.set(official.gameId, []);
    }
    crewByGameId.get(official.gameId).push(official.refereeId);
  }

  function getScopeRows(event) {
    const scopes = [
      { seasonType: "all", window: "all" },
      { seasonType: event.seasonType, window: "all" },
    ];

    if (event.isCloseGame) {
      scopes.push({ seasonType: "all", window: "close_game" });
      scopes.push({ seasonType: event.seasonType, window: "close_game" });
    }

    if (event.isLastTwoMinutes) {
      scopes.push({ seasonType: "all", window: "last_two_minutes" });
      scopes.push({ seasonType: event.seasonType, window: "last_two_minutes" });
    }

    return scopes;
  }

  for (const event of foulEvents) {
    if (!event.refereeId) continue;
    const scopes = getScopeRows(event);

    for (const scope of scopes) {
      const overviewKey = [event.refereeId, scope.seasonType, scope.window].join("|");
      if (!refereeOverviewMap.has(overviewKey)) {
        refereeOverviewMap.set(overviewKey, {
          refereeId: event.refereeId,
          seasonType: scope.seasonType,
          window: scope.window,
          totalCalls: 0,
          freeThrowsAwarded: 0,
          reviewedCalls: 0,
          overturnedCalls: 0,
          l2mTagged: 0,
          incorrectCalls: 0,
          againstHomeCalls: 0,
          againstAwayCalls: 0,
          benefitHomeCalls: 0,
          benefitAwayCalls: 0,
        });
      }

      const overviewRow = refereeOverviewMap.get(overviewKey);
      overviewRow.totalCalls += 1;
      overviewRow.freeThrowsAwarded += event.freeThrowsAwarded || 0;
      overviewRow.reviewedCalls += event.challengeReviewed ? 1 : 0;
      overviewRow.overturnedCalls += event.challengeOverturned ? 1 : 0;
      overviewRow.l2mTagged += event.l2mDecision ? 1 : 0;
      overviewRow.incorrectCalls += event.l2mDecision === "IC" ? 1 : 0;
      overviewRow.againstHomeCalls += event.whistleAgainstSide === "home" ? 1 : 0;
      overviewRow.againstAwayCalls += event.whistleAgainstSide === "away" ? 1 : 0;
      overviewRow.benefitHomeCalls += event.whistleBenefitedSide === "home" ? 1 : 0;
      overviewRow.benefitAwayCalls += event.whistleBenefitedSide === "away" ? 1 : 0;

      const entitySpecs = [
        { entityId: event.penalizedTeamId, entityType: "team", entityRole: "penalized_team" },
        { entityId: event.benefitedTeamId, entityType: "team", entityRole: "benefited_team" },
        { entityId: event.penalizedPlayerId, entityType: "player", entityRole: "penalized_player" },
        { entityId: event.benefitedPlayerId, entityType: "player", entityRole: "benefited_player" },
      ];

      entitySpecs.forEach((spec) => {
        if (!spec.entityId) return;
        const entityKey = [event.refereeId, spec.entityType, spec.entityRole, spec.entityId, scope.seasonType, scope.window].join("|");
        if (!refereeEntityMap.has(entityKey)) {
          refereeEntityMap.set(entityKey, {
            refereeId: event.refereeId,
            entityId: spec.entityId,
            entityType: spec.entityType,
            entityRole: spec.entityRole,
            seasonType: scope.seasonType,
            window: scope.window,
            count: 0,
            freeThrowsAwarded: 0,
            reviewedCalls: 0,
            incorrectCalls: 0,
          });
        }

        const entityRow = refereeEntityMap.get(entityKey);
        entityRow.count += 1;
        entityRow.freeThrowsAwarded += event.freeThrowsAwarded || 0;
        entityRow.reviewedCalls += event.challengeReviewed ? 1 : 0;
        entityRow.incorrectCalls += event.l2mDecision === "IC" ? 1 : 0;
      });

      const crewRefereeIds = crewByGameId.get(event.gameId) || [];
      const crewId = crewRefereeIds.length ? buildCrewId(crewRefereeIds) : null;
      if (crewId) {
        const crewKey = [crewId, scope.seasonType, scope.window].join("|");
        if (!crewOverviewMap.has(crewKey)) {
          crewOverviewMap.set(crewKey, {
            crewId,
            refereeIds: [...new Set(crewRefereeIds)].sort(),
            seasonType: scope.seasonType,
            window: scope.window,
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
          });
        }

        const crewRow = crewOverviewMap.get(crewKey);
        crewRow.gameIds.add(event.gameId);
        crewRow.totalCalls += 1;
        crewRow.freeThrowsAwarded += event.freeThrowsAwarded || 0;
        crewRow.reviewedCalls += event.challengeReviewed ? 1 : 0;
        crewRow.overturnedCalls += event.challengeOverturned ? 1 : 0;
        crewRow.againstHomeCalls += event.whistleAgainstSide === "home" ? 1 : 0;
        crewRow.againstAwayCalls += event.whistleAgainstSide === "away" ? 1 : 0;
        crewRow.benefitHomeCalls += event.whistleBenefitedSide === "home" ? 1 : 0;
        crewRow.benefitAwayCalls += event.whistleBenefitedSide === "away" ? 1 : 0;
        crewRow.closeGameCalls += event.isCloseGame ? 1 : 0;
        crewRow.lastTwoMinutesCalls += event.isLastTwoMinutes ? 1 : 0;
      }
    }
  }

  for (const event of challengeEvents) {
    const relatedFoulEvent = event.linkedFoulEventId ? foulEventsById.get(event.linkedFoulEventId) || null : null;
    const linkedRefereeId = event.linkedRefereeId || relatedFoulEvent?.refereeId || null;
    const seasonType = relatedFoulEvent?.seasonType || "Unknown";
    const isCloseGame = relatedFoulEvent?.isCloseGame || false;
    const isLastTwoMinutes = relatedFoulEvent?.isLastTwoMinutes || false;
    const scopes = [
      { seasonType: "all", window: "all" },
      { seasonType, window: "all" },
    ];

    if (isCloseGame) {
      scopes.push({ seasonType: "all", window: "close_game" });
      scopes.push({ seasonType, window: "close_game" });
    }

    if (isLastTwoMinutes) {
      scopes.push({ seasonType: "all", window: "last_two_minutes" });
      scopes.push({ seasonType, window: "last_two_minutes" });
    }

    const outcomeBucket = getChallengeOutcomeBucket(event.challengeOutcome);
    const confidenceValue = event.inferenceConfidence == null ? null : Number(event.inferenceConfidence);

    for (const scope of scopes) {
      const crewRefereeIds = crewByGameId.get(event.gameId) || [];
      const crewId = crewRefereeIds.length ? buildCrewId(crewRefereeIds) : null;

      if (linkedRefereeId) {
        const key = [linkedRefereeId, scope.seasonType, scope.window].join("|");
        if (!challengeRefereeOverviewMap.has(key)) {
          challengeRefereeOverviewMap.set(key, {
            refereeId: linkedRefereeId,
            seasonType: scope.seasonType,
            window: scope.window,
            reviewedCalls: 0,
            upheldCalls: 0,
            overturnedCalls: 0,
            unknownCalls: 0,
            totalConfidence: 0,
            confidenceCount: 0,
          });
        }

        const row = challengeRefereeOverviewMap.get(key);
        row.reviewedCalls += 1;
        row.upheldCalls += outcomeBucket === "upheld" ? 1 : 0;
        row.overturnedCalls += outcomeBucket === "overturned" ? 1 : 0;
        row.unknownCalls += outcomeBucket === "unknown" ? 1 : 0;
        if (confidenceValue != null) {
          row.totalConfidence += confidenceValue;
          row.confidenceCount += 1;
        }
      }

      if (crewId) {
        const key = [crewId, scope.seasonType, scope.window].join("|");
        if (!crewChallengeOverviewMap.has(key)) {
          crewChallengeOverviewMap.set(key, {
            crewId,
            refereeIds: [...new Set(crewRefereeIds)].sort(),
            seasonType: scope.seasonType,
            window: scope.window,
            reviewedCalls: 0,
            upheldCalls: 0,
            overturnedCalls: 0,
            unknownCalls: 0,
            totalConfidence: 0,
            confidenceCount: 0,
          });
        }

        const row = crewChallengeOverviewMap.get(key);
        row.reviewedCalls += 1;
        row.upheldCalls += outcomeBucket === "upheld" ? 1 : 0;
        row.overturnedCalls += outcomeBucket === "overturned" ? 1 : 0;
        row.unknownCalls += outcomeBucket === "unknown" ? 1 : 0;
        if (confidenceValue != null) {
          row.totalConfidence += confidenceValue;
          row.confidenceCount += 1;
        }
      }

      if (event.teamId) {
        const key = [event.teamId, scope.seasonType, scope.window].join("|");
        if (!challengeTeamOverviewMap.has(key)) {
          challengeTeamOverviewMap.set(key, {
            teamId: event.teamId,
            seasonType: scope.seasonType,
            window: scope.window,
            challenges: 0,
            upheldCalls: 0,
            overturnedCalls: 0,
            unknownCalls: 0,
            totalConfidence: 0,
            confidenceCount: 0,
          });
        }

        const row = challengeTeamOverviewMap.get(key);
        row.challenges += 1;
        row.upheldCalls += outcomeBucket === "upheld" ? 1 : 0;
        row.overturnedCalls += outcomeBucket === "overturned" ? 1 : 0;
        row.unknownCalls += outcomeBucket === "unknown" ? 1 : 0;
        if (confidenceValue != null) {
          row.totalConfidence += confidenceValue;
          row.confidenceCount += 1;
        }
      }

      const outcomeKey = [outcomeBucket, scope.seasonType, scope.window].join("|");
      if (!challengeOutcomeOverviewMap.has(outcomeKey)) {
        challengeOutcomeOverviewMap.set(outcomeKey, {
          outcomeBucket,
          seasonType: scope.seasonType,
          window: scope.window,
          count: 0,
        });
      }

      challengeOutcomeOverviewMap.get(outcomeKey).count += 1;
    }
  }

  return {
    refereeOverview: [...refereeOverviewMap.values()].sort((a, b) => b.totalCalls - a.totalCalls),
    refereeEntity: [...refereeEntityMap.values()].sort((a, b) => b.count - a.count),
    crewOverview: [...crewOverviewMap.values()]
      .map((row) => {
        const { gameIds, ...rest } = row;
        return {
          ...rest,
          gameCount: gameIds.size,
          callsPerGame: gameIds.size ? row.totalCalls / gameIds.size : row.totalCalls,
          againstHomeShare: row.totalCalls ? row.againstHomeCalls / row.totalCalls : 0,
          benefitHomeShare: row.totalCalls ? row.benefitHomeCalls / row.totalCalls : 0,
        };
      })
      .sort((a, b) => b.totalCalls - a.totalCalls),
    challengeRefereeOverview: [...challengeRefereeOverviewMap.values()]
      .map((row) => ({
        ...row,
        averageConfidence: row.confidenceCount ? row.totalConfidence / row.confidenceCount : null,
        overturnRate: row.reviewedCalls ? row.overturnedCalls / row.reviewedCalls : 0,
      }))
      .sort((a, b) => b.reviewedCalls - a.reviewedCalls),
    crewChallengeOverview: [...crewChallengeOverviewMap.values()]
      .map((row) => ({
        ...row,
        averageConfidence: row.confidenceCount ? row.totalConfidence / row.confidenceCount : null,
        overturnRate: row.reviewedCalls ? row.overturnedCalls / row.reviewedCalls : 0,
      }))
      .sort((a, b) => b.reviewedCalls - a.reviewedCalls),
    challengeTeamOverview: [...challengeTeamOverviewMap.values()]
      .map((row) => ({
        ...row,
        averageConfidence: row.confidenceCount ? row.totalConfidence / row.confidenceCount : null,
        overturnRate: row.challenges ? row.overturnedCalls / row.challenges : 0,
      }))
      .sort((a, b) => b.challenges - a.challenges),
    challengeOutcomeOverview: [...challengeOutcomeOverviewMap.values()].sort((a, b) => b.count - a.count),
  };
}

export function buildDatasetFromRecords({
  metadata,
  teams,
  players,
  referees,
  games,
  gameOfficials,
  rawPlayByPlayEvents,
  foulEvents,
  challengeEvents,
  lastTwoMinuteReviews,
}) {
  const teamRows = [...teams].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  const playerRows = [...players].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const refereeRows = [...referees].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const sortedGames = [...games].sort((a, b) => b.gameDate.localeCompare(a.gameDate) || b.id.localeCompare(a.id));
  const sortedRawPlayByPlayEvents = [...rawPlayByPlayEvents].sort((a, b) => {
    if (a.gameId !== b.gameId) return a.gameId.localeCompare(b.gameId);
    if (a.period !== b.period) return a.period - b.period;
    return Number(a.sourceEventId || 0) - Number(b.sourceEventId || 0);
  });
  const sortedFoulEvents = [...foulEvents].sort((a, b) => {
    if (a.gameId !== b.gameId) return a.gameId.localeCompare(b.gameId);
    return a.gameClockSecondsElapsed - b.gameClockSecondsElapsed;
  });
  const sortedChallengeEvents = [...challengeEvents].sort((a, b) => {
    if (a.gameId !== b.gameId) return a.gameId.localeCompare(b.gameId);
    if (a.period !== b.period) return a.period - b.period;
    return a.periodClock.localeCompare(b.periodClock);
  });
  const sortedReviews = [...lastTwoMinuteReviews].sort((a, b) => {
    if (a.gameId !== b.gameId) return a.gameId.localeCompare(b.gameId);
    if (a.period !== b.period) return a.period - b.period;
    return a.clock.localeCompare(b.clock);
  });
  const sortedOfficials = [...gameOfficials].sort((a, b) => {
    if (a.gameId !== b.gameId) return a.gameId.localeCompare(b.gameId);
    return a.assignmentRole.localeCompare(b.assignmentRole);
  });
  const summaryTables = buildSummaryTables(sortedFoulEvents, sortedChallengeEvents, sortedOfficials);

  return {
    metadata,
    overview: buildOverview(sortedFoulEvents, sortedGames, refereeRows, sortedChallengeEvents, sortedReviews),
    teams: teamRows,
    players: playerRows,
    referees: refereeRows,
    games: sortedGames,
    gameOfficials: sortedOfficials,
    rawPlayByPlayEvents: sortedRawPlayByPlayEvents,
    foulEvents: sortedFoulEvents,
    challengeEvents: sortedChallengeEvents,
    lastTwoMinuteReviews: sortedReviews,
    summaryTables,
  };
}

export function transformLiveGameBundles({ gameBundles, syncedAt, request }) {
  const teams = new Map();
  const players = new Map();
  const referees = new Map();
  const games = [];
  const gameOfficials = [];
  const rawPlayByPlayEvents = [];
  const foulEvents = [];
  const challengeEvents = [];
  const lastTwoMinuteReviews = [];

  for (const bundle of gameBundles) {
    const scheduleGame = bundle.scheduleGame;
    const boxscore = bundle.boxscore.game;
    const playByPlay = bundle.playByPlay.game;

    const gameId = String(scheduleGame.gameId);
    const season = inferSeasonFromGameId(gameId);
    const seasonType = inferSeasonTypeFromGameId(gameId);
    const gameDate = normalizeDate(scheduleGame.gameDateEst || bundle.gameDate);
    const homeTeam = boxscore.homeTeam;
    const awayTeam = boxscore.awayTeam;
    const homeTeamId = String(homeTeam.teamId);
    const awayTeamId = String(awayTeam.teamId);

    teams.set(homeTeamId, {
      id: homeTeamId,
      nbaTeamId: homeTeam.teamId,
      abbreviation: homeTeam.teamTricode,
      city: homeTeam.teamCity,
      name: homeTeam.teamName,
    });

    teams.set(awayTeamId, {
      id: awayTeamId,
      nbaTeamId: awayTeam.teamId,
      abbreviation: awayTeam.teamTricode,
      city: awayTeam.teamCity,
      name: awayTeam.teamName,
    });

    const playerTeamMap = new Map();
    const playerIdsByName = new Map();
    for (const team of [homeTeam, awayTeam]) {
      for (const player of team.players || []) {
        const playerId = String(player.personId);
        playerTeamMap.set(playerId, String(team.teamId));
        playerIdsByName.set(normalizeName(player.name), playerId);
        players.set(playerId, {
          id: playerId,
          nbaPlayerId: player.personId,
          displayName: player.name,
          teamId: String(team.teamId),
          position: player.position || "",
        });
      }
    }

    const officialsById = new Map();
    for (const official of boxscore.officials || []) {
      const refereeId = String(official.personId);
      officialsById.set(refereeId, official);
      referees.set(refereeId, {
        id: refereeId,
        nbaOfficialId: official.personId,
        jerseyNumber: official.jerseyNum,
        displayName: official.name,
      });

      gameOfficials.push({
        id: `${gameId}-${refereeId}`,
        gameId,
        refereeId,
        assignmentRole: normalizeAssignment(official.assignment),
      });
    }

    games.push({
      id: gameId,
      nbaGameId: gameId,
      season,
      seasonType,
      gameDate,
      homeTeamId,
      awayTeamId,
      homeScoreFinal: Number(homeTeam.score ?? 0),
      awayScoreFinal: Number(awayTeam.score ?? 0),
      status: scheduleGame.gameStatusText || boxscore.gameStatusText || "Unknown",
      officials: (boxscore.officials || []).map((official) => ({
        refereeId: String(official.personId),
        assignmentRole: normalizeAssignment(official.assignment),
      })),
    });

    const actions = playByPlay.actions || [];
    rawPlayByPlayEvents.push(...buildRawPlayByPlayEvents(gameId, actions));

    const foulEventsForGame = [];
    const foulByActionNumber = new Map();
    actions.forEach((action, index) => {
      if (action.actionType !== "foul") return;

      const penalizedPlayerId = action.personId ? String(action.personId) : null;
      const penalizedTeamId =
        action.teamId != null
          ? String(action.teamId)
          : penalizedPlayerId
            ? playerTeamMap.get(penalizedPlayerId) || null
            : null;
      const benefitedPlayerId = action.foulDrawnPersonId ? String(action.foulDrawnPersonId) : null;
      const benefitedTeamId = inferBenefitedTeamId(action, playerTeamMap, homeTeamId, awayTeamId);
      const refereeId = action.officialId != null ? String(action.officialId) : null;
      const refereeMapped = refereeId ? officialsById.has(refereeId) : false;
      const homeScoreAtWhistle = Number(action.scoreHome ?? 0);
      const awayScoreAtWhistle = Number(action.scoreAway ?? 0);
      const scoreMarginForHome = homeScoreAtWhistle - awayScoreAtWhistle;
      const leadingTeamId = scoreMarginForHome > 0 ? homeTeamId : scoreMarginForHome < 0 ? awayTeamId : null;
      const foulType = normalizeFoulType(action);
      const foulSubtype = [action.subType, action.descriptor, ...(action.qualifiers || [])].filter(Boolean).join(" | ") || "unspecified";
      const periodClockSeconds = parseClock(action.clock);
      const freeThrowsAwarded = inferFreeThrows(actions, index, action);
      const { isClutch, isCloseGame, isLastTwoMinutes } = getEventFlags(action.period, scoreMarginForHome, periodClockSeconds);
      const whistleAgainstSide = penalizedTeamId === homeTeamId ? "home" : "away";
      const whistleBenefitedSide = benefitedTeamId === homeTeamId ? "home" : "away";

      const event = {
        id: `${gameId}-foul-${String(action.actionNumber).padStart(4, "0")}`,
        gameId,
        rawEventId: `${gameId}-action-${action.actionNumber}`,
        period: Number(action.period),
        periodClock: formatClock(action.clock),
        gameClockSecondsElapsed: getGameClockElapsed(Number(action.period), action.clock),
        refereeId,
        foulType,
        foulSubtype,
        penalizedTeamId,
        penalizedPlayerId,
        benefitedTeamId,
        benefitedPlayerId,
        homeScoreAtWhistle,
        awayScoreAtWhistle,
        scoreMarginForHome,
        leadingTeamId,
        isHomeWhistleAgainstHome: penalizedTeamId === homeTeamId,
        freeThrowsAwarded,
        possessionTeamId: action.possession ? String(action.possession) : benefitedTeamId,
        isTakeFoul: foulType === "take_foul",
        isAwayFromPlay: foulType === "away_from_play",
        isInBonus: false,
        isClutch,
        isCloseGame,
        isLastTwoMinutes,
        season,
        seasonType,
        homeTeamId,
        awayTeamId,
        whistleAgainstSide,
        whistleBenefitedSide,
        challengeTeamId: null,
        challengeReviewed: false,
        challengeOverturned: false,
        challengeOutcome: null,
        challengeTargetType: null,
        challengeOutcomeSource: null,
        challengeInferenceReason: null,
        challengeInferenceConfidence: null,
        sourceConfidence: getSourceConfidence({
          refereeMapped,
          benefitedPlayerId,
          benefitedTeamId,
          penalizedPlayerId,
        }),
        description: action.description || `${foulType} foul`,
        l2mDecision: null,
        l2mCallType: null,
        l2mComment: null,
        l2mVideoUrl: null,
        correctnessBucket: null,
      };

      foulEventsForGame.push(event);
      foulByActionNumber.set(action.actionNumber, event);
    });

    actions.forEach((action, index) => {
      if (!(action.actionType === "timeout" && String(action.subType).toLowerCase() === "challenge")) {
        return;
      }

      const challengeTeamId = action.teamId != null ? String(action.teamId) : null;
      const linkedAction = findLinkedChallengeAction(actions, index, challengeTeamId);
      const linkedFoulEvent = linkedAction?.actionType === "foul" ? foulByActionNumber.get(linkedAction.actionNumber) : null;
      const nextCompetitiveAction = findNextCompetitiveAction(actions, index);
      const nextCompetitiveActions = findNextCompetitiveActions(actions, index);
      const inference = inferChallengeOutcome({
        challengeTeamId,
        linkedAction,
        linkedFoulEvent,
        nextCompetitiveAction,
        nextCompetitiveActions,
      });

      if (linkedFoulEvent) {
        linkedFoulEvent.challengeTeamId = challengeTeamId;
        linkedFoulEvent.challengeReviewed = true;
        linkedFoulEvent.challengeOutcome = inference.outcome;
        linkedFoulEvent.challengeOverturned = inference.overturned;
        linkedFoulEvent.challengeTargetType = inference.targetType;
        linkedFoulEvent.challengeOutcomeSource = inference.source;
        linkedFoulEvent.challengeInferenceReason = inference.reason;
        linkedFoulEvent.challengeInferenceConfidence = inference.confidence;
      }

      challengeEvents.push({
        id: `${gameId}-challenge-${String(action.actionNumber).padStart(4, "0")}`,
        gameId,
        linkedRawEventId: linkedAction ? `${gameId}-action-${linkedAction.actionNumber}` : null,
        linkedFoulEventId: linkedFoulEvent?.id || null,
        linkedRefereeId: linkedFoulEvent?.refereeId || null,
        teamId: challengeTeamId,
        period: Number(action.period),
        periodClock: formatClock(action.clock),
        challengeType: "coach_challenge",
        challengeOutcome: inference.outcome,
        challengeTargetType: inference.targetType,
        challengeOutcomeSource: inference.source,
        challengeInferenceReason: inference.reason,
        inferenceConfidence: inference.confidence,
        challengeOverturned: inference.overturned,
        description: action.description || "Coach's challenge",
        payloadJson: action,
      });
    });

    const reviews = applyL2MOverlay({
      gameId,
      l2mReport: bundle.l2mReport,
      foulEventsForGame,
      playerIdsByName,
    });

    lastTwoMinuteReviews.push(...reviews);
    foulEvents.push(...foulEventsForGame);
  }

  return buildDatasetFromRecords({
    metadata: {
      title: "NBA Referee Analytics",
      generatedAt: syncedAt,
      sampleType: "live_nba_sync",
      note: `Live NBA data synced locally from NBA CDN for ${request.from} through ${request.to}.`,
      syncWindow: {
        from: request.from,
        to: request.to,
        maxGames: request.maxGames,
        gamesRequested: request.gamesRequested,
        gamesSynced: games.length,
      },
      sources: [
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
      },
    },
    teams: [...teams.values()],
    players: [...players.values()],
    referees: [...referees.values()],
    games,
    gameOfficials,
    rawPlayByPlayEvents,
    foulEvents,
    challengeEvents,
    lastTwoMinuteReviews,
  });
}

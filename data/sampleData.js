const teams = [
  { id: "LAL", nbaTeamId: 1610612747, abbreviation: "LAL", city: "Los Angeles", name: "Lakers" },
  { id: "GSW", nbaTeamId: 1610612744, abbreviation: "GSW", city: "Golden State", name: "Warriors" },
  { id: "BOS", nbaTeamId: 1610612738, abbreviation: "BOS", city: "Boston", name: "Celtics" },
  { id: "NYK", nbaTeamId: 1610612752, abbreviation: "NYK", city: "New York", name: "Knicks" },
  { id: "DEN", nbaTeamId: 1610612743, abbreviation: "DEN", city: "Denver", name: "Nuggets" },
  { id: "PHX", nbaTeamId: 1610612756, abbreviation: "PHX", city: "Phoenix", name: "Suns" },
];

const players = [
  { id: "lebron-james", nbaPlayerId: 2544, displayName: "LeBron James", teamId: "LAL", position: "F" },
  { id: "anthony-davis", nbaPlayerId: 203076, displayName: "Anthony Davis", teamId: "LAL", position: "C" },
  { id: "austin-reaves", nbaPlayerId: 1630559, displayName: "Austin Reaves", teamId: "LAL", position: "G" },
  { id: "rui-hachimura", nbaPlayerId: 1629060, displayName: "Rui Hachimura", teamId: "LAL", position: "F" },

  { id: "stephen-curry", nbaPlayerId: 201939, displayName: "Stephen Curry", teamId: "GSW", position: "G" },
  { id: "draymond-green", nbaPlayerId: 203110, displayName: "Draymond Green", teamId: "GSW", position: "F" },
  { id: "jonathan-kuminga", nbaPlayerId: 1630228, displayName: "Jonathan Kuminga", teamId: "GSW", position: "F" },
  { id: "brandin-podziemski", nbaPlayerId: 1641764, displayName: "Brandin Podziemski", teamId: "GSW", position: "G" },

  { id: "jayson-tatum", nbaPlayerId: 1628369, displayName: "Jayson Tatum", teamId: "BOS", position: "F" },
  { id: "jaylen-brown", nbaPlayerId: 1627759, displayName: "Jaylen Brown", teamId: "BOS", position: "G" },
  { id: "derrick-white", nbaPlayerId: 1628401, displayName: "Derrick White", teamId: "BOS", position: "G" },
  { id: "jrue-holiday", nbaPlayerId: 201950, displayName: "Jrue Holiday", teamId: "BOS", position: "G" },

  { id: "jalen-brunson", nbaPlayerId: 1628973, displayName: "Jalen Brunson", teamId: "NYK", position: "G" },
  { id: "og-anunoby", nbaPlayerId: 1628384, displayName: "OG Anunoby", teamId: "NYK", position: "F" },
  { id: "josh-hart", nbaPlayerId: 1628404, displayName: "Josh Hart", teamId: "NYK", position: "F" },
  { id: "karl-anthony-towns", nbaPlayerId: 1626157, displayName: "Karl-Anthony Towns", teamId: "NYK", position: "C" },

  { id: "nikola-jokic", nbaPlayerId: 203999, displayName: "Nikola Jokic", teamId: "DEN", position: "C" },
  { id: "jamal-murray", nbaPlayerId: 1627750, displayName: "Jamal Murray", teamId: "DEN", position: "G" },
  { id: "aaron-gordon", nbaPlayerId: 203932, displayName: "Aaron Gordon", teamId: "DEN", position: "F" },
  { id: "michael-porter-jr", nbaPlayerId: 1629008, displayName: "Michael Porter Jr.", teamId: "DEN", position: "F" },

  { id: "devin-booker", nbaPlayerId: 1626164, displayName: "Devin Booker", teamId: "PHX", position: "G" },
  { id: "kevin-durant", nbaPlayerId: 201142, displayName: "Kevin Durant", teamId: "PHX", position: "F" },
  { id: "bradley-beal", nbaPlayerId: 203078, displayName: "Bradley Beal", teamId: "PHX", position: "G" },
  { id: "jusuf-nurkic", nbaPlayerId: 203994, displayName: "Jusuf Nurkic", teamId: "PHX", position: "C" },
];

const referees = [
  { id: "ref-capers", nbaOfficialId: 19, jerseyNumber: "19", displayName: "James Capers" },
  { id: "ref-ben-taylor", nbaOfficialId: 46, jerseyNumber: "46", displayName: "Ben Taylor" },
  { id: "ref-buchert", nbaOfficialId: 3, jerseyNumber: "3", displayName: "Nick Buchert" },
  { id: "ref-zarba", nbaOfficialId: 15, jerseyNumber: "15", displayName: "Zach Zarba" },
  { id: "ref-tyler-ford", nbaOfficialId: 39, jerseyNumber: "39", displayName: "Tyler Ford" },
  { id: "ref-tony-brothers", nbaOfficialId: 25, jerseyNumber: "25", displayName: "Tony Brothers" },
  { id: "ref-james-williams", nbaOfficialId: 60, jerseyNumber: "60", displayName: "James Williams" },
];

const games = [
  {
    id: "game-001",
    nbaGameId: "0022501101",
    season: "2025-26",
    seasonType: "Regular Season",
    gameDate: "2026-04-07",
    homeTeamId: "GSW",
    awayTeamId: "LAL",
    homeScoreFinal: 118,
    awayScoreFinal: 112,
    officials: [
      { refereeId: "ref-capers", assignmentRole: "crew_chief" },
      { refereeId: "ref-ben-taylor", assignmentRole: "referee" },
      { refereeId: "ref-buchert", assignmentRole: "umpire" },
    ],
  },
  {
    id: "game-002",
    nbaGameId: "0022501102",
    season: "2025-26",
    seasonType: "Regular Season",
    gameDate: "2026-04-10",
    homeTeamId: "NYK",
    awayTeamId: "BOS",
    homeScoreFinal: 107,
    awayScoreFinal: 103,
    officials: [
      { refereeId: "ref-zarba", assignmentRole: "crew_chief" },
      { refereeId: "ref-tyler-ford", assignmentRole: "referee" },
      { refereeId: "ref-ben-taylor", assignmentRole: "umpire" },
    ],
  },
  {
    id: "game-003",
    nbaGameId: "0022501103",
    season: "2025-26",
    seasonType: "Regular Season",
    gameDate: "2026-04-12",
    homeTeamId: "PHX",
    awayTeamId: "DEN",
    homeScoreFinal: 115,
    awayScoreFinal: 111,
    officials: [
      { refereeId: "ref-tony-brothers", assignmentRole: "crew_chief" },
      { refereeId: "ref-james-williams", assignmentRole: "referee" },
      { refereeId: "ref-tyler-ford", assignmentRole: "umpire" },
    ],
  },
  {
    id: "game-004",
    nbaGameId: "0022501104",
    season: "2025-26",
    seasonType: "Regular Season",
    gameDate: "2026-04-15",
    homeTeamId: "DEN",
    awayTeamId: "GSW",
    homeScoreFinal: 120,
    awayScoreFinal: 116,
    officials: [
      { refereeId: "ref-capers", assignmentRole: "crew_chief" },
      { refereeId: "ref-zarba", assignmentRole: "referee" },
      { refereeId: "ref-james-williams", assignmentRole: "umpire" },
    ],
  },
];

const playerById = Object.fromEntries(players.map((player) => [player.id, player]));
const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
const refereeById = Object.fromEntries(referees.map((referee) => [referee.id, referee]));
const gameById = Object.fromEntries(games.map((game) => [game.id, game]));

const foulBlueprints = [
  ["game-001", 1, "10:48", 4, 2, "ref-capers", "shooting", "2pt shooting", "anthony-davis", "stephen-curry", 2, false, false, false, false, 0.99],
  ["game-001", 1, "08:31", 12, 10, "ref-ben-taylor", "personal", "reach-in", "brandin-podziemski", "austin-reaves", 0, false, false, false, false, 0.98],
  ["game-001", 2, "09:42", 32, 27, "ref-capers", "offensive", "push-off", "lebron-james", null, 0, false, false, false, false, 0.97],
  ["game-001", 2, "04:58", 43, 38, "ref-buchert", "shooting", "3pt shooting", "rui-hachimura", "stephen-curry", 3, true, false, false, false, 0.99],
  ["game-001", 3, "11:05", 58, 55, "ref-ben-taylor", "loose_ball", "rebound hold", "draymond-green", "anthony-davis", 2, false, true, false, false, 0.82],
  ["game-001", 3, "06:12", 71, 69, "ref-capers", "personal", "blocking", "anthony-davis", "jonathan-kuminga", 2, true, false, true, false, 0.99],
  ["game-001", 4, "08:44", 86, 82, "ref-ben-taylor", "technical", "delay of game", "draymond-green", null, 1, false, false, false, false, 0.88],
  ["game-001", 4, "04:33", 100, 96, "ref-capers", "shooting", "2pt shooting", "austin-reaves", "stephen-curry", 2, true, false, true, true, 0.99],
  ["game-001", 4, "01:51", 109, 108, "ref-buchert", "take_foul", "transition take foul", "lebron-james", "brandin-podziemski", 2, true, false, false, false, 0.95],
  ["game-001", 4, "00:42", 115, 110, "ref-capers", "offensive", "illegal screen", "anthony-davis", null, 0, true, false, false, false, 0.96],

  ["game-002", 1, "11:16", 2, 3, "ref-zarba", "shooting", "2pt shooting", "jrue-holiday", "jalen-brunson", 2, false, false, false, false, 0.99],
  ["game-002", 1, "07:44", 15, 13, "ref-ben-taylor", "personal", "hand check", "og-anunoby", "jayson-tatum", 0, false, false, false, false, 0.97],
  ["game-002", 2, "09:11", 28, 24, "ref-tyler-ford", "offensive", "charge", "jaylen-brown", null, 0, false, false, false, false, 0.96],
  ["game-002", 2, "02:54", 39, 36, "ref-zarba", "shooting", "3pt shooting", "derrick-white", "jalen-brunson", 3, true, false, false, false, 0.99],
  ["game-002", 3, "08:02", 57, 54, "ref-zarba", "loose_ball", "hold", "jaylen-brown", "josh-hart", 2, false, true, false, false, 0.8],
  ["game-002", 3, "04:47", 63, 65, "ref-ben-taylor", "personal", "blocking", "karl-anthony-towns", "jayson-tatum", 2, false, false, true, false, 0.98],
  ["game-002", 4, "09:26", 79, 78, "ref-tyler-ford", "technical", "defensive three seconds", "karl-anthony-towns", null, 1, false, false, false, false, 0.92],
  ["game-002", 4, "05:18", 88, 87, "ref-zarba", "shooting", "2pt shooting", "jrue-holiday", "jalen-brunson", 2, true, false, true, true, 0.99],
  ["game-002", 4, "02:14", 96, 96, "ref-zarba", "personal", "hand check", "derrick-white", "og-anunoby", 2, true, false, true, false, 0.97],
  ["game-002", 4, "00:37", 103, 101, "ref-ben-taylor", "offensive", "push-off", "josh-hart", null, 0, true, false, false, false, 0.93],

  ["game-003", 1, "10:59", 5, 2, "ref-tony-brothers", "shooting", "2pt shooting", "michael-porter-jr", "devin-booker", 2, false, false, false, false, 0.99],
  ["game-003", 1, "06:18", 16, 15, "ref-james-williams", "personal", "reach-in", "bradley-beal", "jamal-murray", 0, false, false, false, false, 0.96],
  ["game-003", 2, "08:44", 31, 29, "ref-tony-brothers", "shooting", "2pt shooting", "aaron-gordon", "kevin-durant", 2, true, false, false, false, 0.99],
  ["game-003", 2, "03:57", 42, 37, "ref-tyler-ford", "offensive", "charge", "kevin-durant", null, 0, false, false, false, false, 0.95],
  ["game-003", 3, "09:26", 60, 55, "ref-james-williams", "loose_ball", "over-the-back", "jusuf-nurkic", "nikola-jokic", 2, false, true, false, false, 0.81],
  ["game-003", 3, "05:33", 70, 68, "ref-tony-brothers", "personal", "blocking", "jamal-murray", "devin-booker", 2, true, false, true, false, 0.98],
  ["game-003", 4, "07:14", 89, 84, "ref-tyler-ford", "technical", "taunting", "nikola-jokic", null, 1, false, false, false, false, 0.9],
  ["game-003", 4, "03:41", 99, 97, "ref-tony-brothers", "take_foul", "transition take foul", "aaron-gordon", "bradley-beal", 2, true, false, true, false, 0.96],
  ["game-003", 4, "01:26", 107, 104, "ref-james-williams", "shooting", "3pt shooting", "bradley-beal", "jamal-murray", 3, true, false, true, true, 0.99],
  ["game-003", 4, "00:19", 113, 109, "ref-tony-brothers", "offensive", "illegal screen", "nikola-jokic", null, 0, true, false, false, false, 0.94],

  ["game-004", 1, "09:51", 8, 4, "ref-capers", "shooting", "2pt shooting", "draymond-green", "nikola-jokic", 2, false, false, false, false, 0.99],
  ["game-004", 1, "05:24", 17, 15, "ref-zarba", "personal", "reach-in", "aaron-gordon", "stephen-curry", 0, false, false, false, false, 0.97],
  ["game-004", 2, "10:07", 27, 23, "ref-james-williams", "offensive", "charge", "jonathan-kuminga", null, 0, false, false, false, false, 0.95],
  ["game-004", 2, "04:19", 41, 36, "ref-capers", "loose_ball", "rebound push", "draymond-green", "aaron-gordon", 2, false, true, false, false, 0.83],
  ["game-004", 3, "08:40", 64, 60, "ref-zarba", "shooting", "2pt shooting", "brandin-podziemski", "jamal-murray", 2, true, false, false, false, 0.98],
  ["game-004", 3, "03:11", 72, 71, "ref-james-williams", "personal", "blocking", "nikola-jokic", "stephen-curry", 2, false, false, true, false, 0.98],
  ["game-004", 4, "09:12", 86, 82, "ref-capers", "technical", "complaining", "stephen-curry", null, 1, false, false, false, false, 0.91],
  ["game-004", 4, "05:02", 95, 94, "ref-zarba", "shooting", "2pt shooting", "brandin-podziemski", "jamal-murray", 2, true, false, true, false, 0.98],
  ["game-004", 4, "02:08", 106, 104, "ref-capers", "offensive", "illegal screen", "draymond-green", null, 0, true, false, true, false, 0.96],
  ["game-004", 4, "00:31", 118, 116, "ref-james-williams", "take_foul", "transition take foul", "stephen-curry", "jamal-murray", 2, true, false, true, true, 0.95],
];

function parseClock(clock) {
  const [minutes, seconds] = clock.split(":").map(Number);
  return minutes * 60 + seconds;
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

function formatDescription(referee, foulType, foulSubtype, penalizedPlayer, benefitedPlayer) {
  const penalizedText = penalizedPlayer?.displayName || "team";
  const benefitedText = benefitedPlayer?.displayName || "the opposing team";
  return `${referee.displayName} called a ${foulType.replaceAll("_", " ")} foul (${foulSubtype}) on ${penalizedText}, benefiting ${benefitedText}.`;
}

function buildFoulEvent(blueprint, index) {
  const [
    gameId,
    period,
    clock,
    homeScore,
    awayScore,
    refereeId,
    foulType,
    foulSubtype,
    penalizedPlayerId,
    benefitedPlayerId,
    freeThrowsAwarded,
    isInBonus,
    isAwayFromPlay,
    challengeReviewed,
    challengeOverturned,
    sourceConfidence,
  ] = blueprint;

  const game = gameById[gameId];
  const referee = refereeById[refereeId];
  const penalizedPlayer = playerById[penalizedPlayerId];
  const benefitedPlayer = benefitedPlayerId ? playerById[benefitedPlayerId] : null;
  const penalizedTeamId = penalizedPlayer.teamId;
  const benefitedTeamId = benefitedPlayer ? benefitedPlayer.teamId : (penalizedTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId);
  const scoreMarginForHome = homeScore - awayScore;
  const leadingTeamId = scoreMarginForHome > 0 ? game.homeTeamId : scoreMarginForHome < 0 ? game.awayTeamId : null;
  const isClutch =
    period >= 4 &&
    parseClock(clock) <= 5 * 60 &&
    Math.abs(scoreMarginForHome) <= 5;

  return {
    id: `foul-${String(index + 1).padStart(3, "0")}`,
    gameId,
    rawEventId: `${game.nbaGameId}-E${index + 1}`,
    period,
    periodClock: clock,
    gameClockSecondsElapsed: getGameClockElapsed(period, clock),
    refereeId,
    foulType,
    foulSubtype,
    penalizedTeamId,
    penalizedPlayerId,
    benefitedTeamId,
    benefitedPlayerId,
    homeScoreAtWhistle: homeScore,
    awayScoreAtWhistle: awayScore,
    scoreMarginForHome,
    leadingTeamId,
    isHomeWhistleAgainstHome: penalizedTeamId === game.homeTeamId,
    freeThrowsAwarded,
    possessionTeamId: benefitedTeamId,
    isTakeFoul: foulType === "take_foul",
    isAwayFromPlay,
    isInBonus,
    isClutch,
    challengeReviewed,
    challengeOverturned,
    sourceConfidence,
    description: formatDescription(referee, foulType, foulSubtype, penalizedPlayer, benefitedPlayer),
  };
}

function buildGameOfficialRows() {
  return games.flatMap((game) =>
    game.officials.map((official, index) => ({
      id: `${game.id}-official-${index + 1}`,
      gameId: game.id,
      refereeId: official.refereeId,
      assignmentRole: official.assignmentRole,
    })),
  );
}

function buildOverview(foulEvents) {
  const totalCalls = foulEvents.length;
  const clutchCalls = foulEvents.filter((event) => event.isClutch).length;
  const reviewedCalls = foulEvents.filter((event) => event.challengeReviewed).length;
  const overturnedCalls = foulEvents.filter((event) => event.challengeOverturned).length;

  return {
    totalGames: games.length,
    totalReferees: referees.length,
    totalCalls,
    clutchCalls,
    reviewedCalls,
    overturnedCalls,
  };
}

export function buildDataset() {
  const foulEvents = foulBlueprints.map(buildFoulEvent);

  return {
    metadata: {
      title: "NBA Referee Analytics",
      generatedAt: "2026-05-05",
      sampleType: "synthetic_seed_data",
      note: "This MVP ships with seeded sample data so the product can be explored before live NBA ingestion is connected.",
    },
    overview: buildOverview(foulEvents),
    teams,
    players,
    referees,
    games,
    gameOfficials: buildGameOfficialRows(),
    foulEvents,
  };
}

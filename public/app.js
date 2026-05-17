import morphdom from "/vendor/morphdom.esm.js";

import {
  buildBiasRows,
  getAdjustedEntityMetrics,
  getAdjustedRefereeMetrics,
  getBiasExplainability,
  buildLookups,
  formatDecimal,
  formatPercent,
  formatSignal,
  getCallTypeBreakdown,
  getEventContext,
  getGameLabel,
  getHomeAwaySplitRows,
  getMonthlyTrendRows,
  getOpponentContextRows,
  getQuarterBreakdown,
  getCoverageSummary,
  getCrewAnalytics,
  getRefereeProfileData,
  getRefereeSignalRows,
  getRefereeTrendRows,
  getSeasonRows,
  getScoreState,
  getSeasonSplitRows,
  getSummaryRows,
  getTopRows,
  humanizeCallType,
  matchesFilters,
  sumBy,
} from "./analytics.js";

const app = document.querySelector("#app");

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const legacyAdminTokenStorageKey = "nba-ref-admin-token";
const savedPresetsStorageKey = "nba-ref-saved-presets";
const evidenceBookmarksStorageKey = "nba-ref-evidence-bookmarks";
const themeStorageKey = "nba-ref-theme";
const sidebarStorageKey = "nba-ref-sidebar-collapsed";
const validViews = new Set(["overview", "games", "referees", "profile", "entities", "bias", "crew", "challenge", "compare", "trends", "series", "close", "last2", "about", "admin"]);
const navigationGroups = [
  {
    key: "explore",
    label: "Explore",
    views: [
      ["overview", "Overview"],
      ["games", "Game Explorer"],
      ["referees", "Referee Lens"],
      ["profile", "Ref Profile"],
      ["entities", "Player / Team"],
    ],
  },
  {
    key: "analyze",
    label: "Analyze",
    views: [
      ["bias", "Bias Lab"],
      ["crew", "Crews"],
      ["challenge", "Challenges"],
      ["compare", "Compare"],
      ["trends", "Trends"],
      ["series", "Series"],
    ],
  },
  {
    key: "situational",
    label: "Situational",
    views: [
      ["close", "Close Games"],
      ["last2", "Last Two"],
    ],
  },
];
const viewToNavigationGroup = Object.fromEntries(
  navigationGroups.flatMap((group) => group.views.map(([view]) => [view, group.key])),
);
const supportsHoverNavigation = window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches ?? false;

const state = {
  data: null,
  lookups: null,
  rawPlayByPlayLoaded: false,
  rawPlayByPlayLoading: false,
  rawPlayByPlayError: "",
  view: "overview",
  filters: {
    season: "all",
    gameId: "all",
    refereeId: "all",
    teamId: "all",
    playerId: "all",
    period: "all",
    scoreState: "all",
    seasonType: "all",
    venueContext: "all",
  },
  focus: {
    refereeId: "all",
    profileRefereeId: "all",
    entityMode: "player",
    entityId: "all",
    biasMode: "team_against",
  },
  analytics: {
    bias: { key: "", data: null, loading: false, error: "" },
    crew: { key: "", data: null, loading: false, error: "" },
    profile: { key: "", data: null, loading: false, error: "" },
  },
  ui: {
    message: "",
    error: "",
    panels: {
      filtersOpen: true,
      filterDrawerOpen: false,
      advancedFiltersOpen: false,
      presetsOpen: false,
      exportsOpen: false,
      navExpanded: false,
      gearMenuOpen: false,
    },
    navGroup: "explore",
    sidebarCollapsed: false,
    theme: "light",
  },
  video: {
    drawerOpen: false,
    active: null,
    queue: [],
    bookmarks: [],
  },
  compare: {
    subject: "referee",
    left: { id: "all", season: "all", seasonType: "all" },
    right: { id: "all", season: "all", seasonType: "all" },
  },
  series: {
    selectedKey: "",
  },
  palette: {
    open: false,
    query: "",
    selectedIndex: 0,
  },
  presets: {
    items: [],
    selectedId: "",
    draftName: "",
  },
  admin: {
    health: null,
    syncStatus: null,
    session: null,
    loginToken: "",
    syncForm: {
      from: "",
      to: "",
      maxGames: "",
    },
    message: "",
    error: "",
    isSubmitting: false,
    isRefreshing: false,
    isAuthenticating: false,
    isSigningOut: false,
  },
};

const renderDebounced = debounce(() => render(), 150);

let _cachedBaseEvents = null;
let _cachedBaseEventsKey = null;

// Virtual scroll infrastructure
const VS_ROW_HEIGHT = 48;
const VS_VISIBLE_ROWS = 14;
const VS_BUFFER = 3;
const vsScrollState = new Map();
const vsListenerRegistry = new WeakMap();

function getVsWindow(id, totalRows) {
  const scrollTop = vsScrollState.get(id) || 0;
  const startIndex = Math.max(0, Math.floor(scrollTop / VS_ROW_HEIGHT) - VS_BUFFER);
  const endIndex = Math.min(totalRows, startIndex + VS_VISIBLE_ROWS + VS_BUFFER * 2);
  return { startIndex, endIndex };
}

function renderVsRows(id, rows, renderRow) {
  const threshold = VS_VISIBLE_ROWS + VS_BUFFER * 2;
  if (rows.length <= threshold) return rows.map(renderRow).join("");
  const { startIndex, endIndex } = getVsWindow(id, rows.length);
  const paddingTop = startIndex * VS_ROW_HEIGHT;
  const paddingBottom = (rows.length - endIndex) * VS_ROW_HEIGHT;
  const visibleRows = rows.slice(startIndex, endIndex);
  return `
    ${paddingTop > 0 ? `<tr class="vs-spacer" style="height:${paddingTop}px"></tr>` : ""}
    ${visibleRows.map(renderRow).join("")}
    ${paddingBottom > 0 ? `<tr class="vs-spacer" style="height:${paddingBottom}px"></tr>` : ""}
  `;
}

function initVirtualScrollers() {
  document.querySelectorAll("[data-vs-id]").forEach((el) => {
    if (!vsListenerRegistry.has(el)) {
      const id = el.dataset.vsId;
      const handler = () => {
        vsScrollState.set(id, el.scrollTop);
        renderDebounced();
      };
      el.addEventListener("scroll", handler);
      vsListenerRegistry.set(el, handler);
    }
    const id = el.dataset.vsId;
    const saved = vsScrollState.get(id);
    if (saved && el.scrollTop !== saved) el.scrollTop = saved;
  });
}

function viewNeedsRawPlayByPlay(view = state.view) {
  return ["referees", "entities", "compare"].includes(view);
}

function optionMarkup(items, valueKey, labelFn, selectedValue) {
  return items
    .map((item) => {
      const value = item[valueKey];
      const selected = value === selectedValue ? "selected" : "";
      return `<option value="${value}" ${selected}>${labelFn(item)}</option>`;
    })
    .join("");
}

function formatDateTime(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getSeasonTypeOptions() {
  const seasonTypes = [...new Set(state.data.games.map((game) => game.seasonType).filter(Boolean))];
  return seasonTypes.sort((a, b) => a.localeCompare(b));
}

function getSeasonOptions() {
  const seasons = [...new Set(state.data.games.map((game) => game.season).filter(Boolean))];
  return seasons.sort((a, b) => b.localeCompare(a));
}

function getCurrentViewMeta() {
  const viewMeta = {
    overview: {
      eyebrow: "Command Center",
      title: "Overview",
      description: "Start with the broad whistle profile, then branch into the deeper analytical views only when you need them.",
    },
    games: {
      eyebrow: "Play Level",
      title: "Game Explorer",
      description: "Trace foul attribution one whistle at a time with score, review, and evidence context in one place.",
    },
    referees: {
      eyebrow: "Referee Focus",
      title: "Referee Lens",
      description: "See who each referee penalizes, who benefits, and where challenge pressure builds around their whistles.",
    },
    profile: {
      eyebrow: "Drill Down",
      title: "Ref Profile",
      description: "A deeper dossier for one referee with crew context, challenge history, and recent-game behavior.",
    },
    entities: {
      eyebrow: "Entity Focus",
      title: "Player / Team",
      description: "Switch between players and teams to understand who draws whistles, absorbs whistles, and against whom.",
    },
    bias: {
      eyebrow: "Adjusted Signal",
      title: "Bias Lab",
      description: "Pressure-test referee and entity relationships with possession-adjusted rates, baselines, and signal strength.",
    },
    crew: {
      eyebrow: "Crew Context",
      title: "Crew Analytics",
      description: "Inspect three-official groups for workload, review outcomes, venue lean, and quarter consistency.",
    },
    challenge: {
      eyebrow: "Review Layer",
      title: "Challenges",
      description: "Track which whistles were challenged, how often they were overturned, and where the most review pressure lives.",
    },
    compare: {
      eyebrow: "Side By Side",
      title: "Compare",
      description: "Put two refs, teams, or players next to each other across seasons and season types without losing context.",
    },
    trends: {
      eyebrow: "Time Series",
      title: "Trends",
      description: "Watch whistle volume, review rate, overturn rate, and free throw signals move over time.",
    },
    close: {
      eyebrow: "Pressure Window",
      title: "Close Games",
      description: "Concentrate on whistles in tight score states where officiating context is often most scrutinized.",
    },
    last2: {
      eyebrow: "Late Game",
      title: "Last Two Minutes",
      description: "Focus on fourth-quarter and overtime whistles inside the final two minutes of game action.",
    },
    series: {
      eyebrow: "Playoff Context",
      title: "Series View",
      description: "Track whistle patterns game-by-game across an entire playoff series with foul splits and per-game trend charts.",
    },
    about: {
      eyebrow: "System",
      title: "About",
      description: "Review data coverage, app version, sync freshness, and the shape of the currently loaded dataset.",
    },
    admin: {
      eyebrow: "Operations",
      title: "Admin",
      description: "Monitor sync health, authenticate admin actions, and run historical backfills or manual refresh jobs.",
    },
  };

  return viewMeta[state.view] || viewMeta.overview;
}

function getActiveScopeTags() {
  const tags = [];

  if (state.filters.season !== "all") {
    tags.push(`Season ${state.filters.season}`);
  }
  if (state.filters.seasonType !== "all") {
    tags.push(state.filters.seasonType);
  }
  if (state.filters.refereeId !== "all") {
    tags.push(state.lookups.referees[state.filters.refereeId]?.displayName || "One referee");
  }
  if (state.filters.teamId !== "all") {
    const team = state.lookups.teams[state.filters.teamId];
    tags.push(team ? `${team.abbreviation} scope` : "One team");
  }
  if (state.filters.playerId !== "all") {
    tags.push(state.lookups.players[state.filters.playerId]?.displayName || "One player");
  }
  if (state.filters.gameId !== "all") {
    const game = state.lookups.games[state.filters.gameId];
    tags.push(game ? getGameLabel(game, state.lookups) : "One game");
  }
  if (state.filters.period !== "all") {
    tags.push(`Q${state.filters.period}`);
  }
  if (state.filters.scoreState !== "all") {
    tags.push(`Score: ${state.filters.scoreState}`);
  }
  if (state.filters.venueContext !== "all") {
    tags.push(`Venue: ${state.filters.venueContext.replaceAll("_", " ")}`);
  }

  return tags;
}

function resetFilters() {
  state.filters = {
    season: "all",
    gameId: "all",
    refereeId: "all",
    teamId: "all",
    playerId: "all",
    period: "all",
    scoreState: "all",
    seasonType: "all",
    venueContext: "all",
  };
  syncLocationState();
  render();
}

function toggleUiPanel(panelKey, forceValue = null) {
  if (!(panelKey in state.ui.panels)) return;
  state.ui.panels[panelKey] = typeof forceValue === "boolean" ? forceValue : !state.ui.panels[panelKey];
  render();
}

function getNavigationGroupKey(view = state.view) {
  return viewToNavigationGroup[view] || "explore";
}

function getActiveNavigationGroup() {
  const groupKey = state.ui.navGroup || getNavigationGroupKey(state.view);
  return navigationGroups.find((group) => group.key === groupKey) || navigationGroups[0];
}

function applyTheme(theme) {
  state.ui.theme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = state.ui.theme;
}

function loadThemePreference() {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    if (stored === "light" || stored === "dark") {
      applyTheme(stored);
      return;
    }
  } catch {
    // Ignore storage failures.
  }

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  applyTheme(prefersDark ? "dark" : "light");
}

function persistThemePreference() {
  try {
    window.localStorage.setItem(themeStorageKey, state.ui.theme);
  } catch {
    // Ignore storage failures.
  }
}

function loadSidebarPreference() {
  try {
    const stored = window.localStorage.getItem(sidebarStorageKey);
    if (stored !== null) state.ui.sidebarCollapsed = stored === "true";
  } catch {
    // Ignore storage failures.
  }
}

function persistSidebarPreference() {
  try {
    window.localStorage.setItem(sidebarStorageKey, String(state.ui.sidebarCollapsed));
  } catch {
    // Ignore storage failures.
  }
}

function toggleTheme() {
  applyTheme(state.ui.theme === "dark" ? "light" : "dark");
  persistThemePreference();
  render();
}

function handleNavigationHover(target) {
  if (!supportsHoverNavigation) return;

  const groupButton = target.closest("[data-view-group]");
  if (!groupButton) return;

  const nextGroup = navigationGroups.find((group) => group.key === groupButton.dataset.viewGroup);
  if (!nextGroup) return;

  if (state.ui.navGroup === nextGroup.key && state.ui.panels.navExpanded) {
    return;
  }

  state.ui.navGroup = nextGroup.key;
  state.ui.panels.navExpanded = true;
  render();
}

function handleNavigationMouseOut(event) {
  if (!supportsHoverNavigation || !state.ui.panels.navExpanded) return;

  const currentNav = event.target.closest(".tab-row");
  if (!currentNav) return;

  const nextTarget = event.relatedTarget;
  if (nextTarget && currentNav.contains(nextTarget)) {
    return;
  }

  state.ui.panels.navExpanded = false;
  render();
}

function getSyncSummaryRows() {
  const summary = state.admin.syncStatus?.syncState?.lastSummary || state.admin.health?.syncState?.lastSummary;
  if (!summary) return [];

  return [
    { label: "Games synced", value: summary.games ?? 0 },
    { label: "Foul events", value: summary.foulEvents ?? 0 },
    { label: "Challenges", value: summary.challenges ?? 0 },
    { label: "L2M reviews", value: summary.l2mReviews ?? 0 },
  ];
}

function getOperationalAlerts() {
  const alerts = state.admin.syncStatus?.syncEvaluation?.alerts || state.admin.health?.syncEvaluation?.alerts || [];
  return Array.isArray(alerts) ? alerts : [];
}

function renderRawPlayByPlayNotice() {
  if (state.rawPlayByPlayLoaded && !state.rawPlayByPlayError) return "";

  if (state.rawPlayByPlayLoading) {
    return `
      <article class="status-banner status-banner-info">
        <strong>Possession context is loading.</strong>
        <div>Adjusted rates are warming up in the background for this view.</div>
      </article>
    `;
  }

  if (state.rawPlayByPlayError) {
    return `
      <article class="status-banner status-banner-warning">
        <strong>Possession context could not be loaded.</strong>
        <div>${state.rawPlayByPlayError}</div>
      </article>
    `;
  }

  return `
    <article class="status-banner status-banner-info">
      <strong>Possession context has not loaded yet.</strong>
      <div>Adjusted possession-based rates will sharpen once the raw play-by-play stream finishes loading.</div>
    </article>
  `;
}

function getAdminSessionState() {
  return state.admin.session || { authEnabled: false, authenticated: false, expiresAt: null };
}

function hydrateAdminSyncForm(defaults = {}) {
  if (!state.admin.syncForm.from) {
    state.admin.syncForm.from = defaults.from || "";
  }
  if (!state.admin.syncForm.to) {
    state.admin.syncForm.to = defaults.to || "";
  }
  if (!state.admin.syncForm.maxGames && defaults.maxGames !== undefined && defaults.maxGames !== null) {
    state.admin.syncForm.maxGames = String(defaults.maxGames);
  }
}

function getUrlValue(url, key, fallback = "all") {
  return url.searchParams.get(key) || fallback;
}

function applyLocationState() {
  const url = new URL(window.location.href);
  const view = url.searchParams.get("view");
  state.view = validViews.has(view) ? view : "overview";
  state.ui.navGroup = getNavigationGroupKey(state.view);
  state.ui.panels.navExpanded = false;
  state.filters.season = getUrlValue(url, "season");
  state.filters.gameId = getUrlValue(url, "gameId");
  state.filters.refereeId = getUrlValue(url, "refereeId");
  state.filters.teamId = getUrlValue(url, "teamId");
  state.filters.playerId = getUrlValue(url, "playerId");
  state.filters.period = getUrlValue(url, "period");
  state.filters.scoreState = getUrlValue(url, "scoreState");
  state.filters.seasonType = getUrlValue(url, "seasonType");
  state.filters.venueContext = getUrlValue(url, "venueContext");
  state.focus.refereeId = getUrlValue(url, "refFocus");
  state.focus.profileRefereeId = getUrlValue(url, "profileRefereeId");
  state.focus.entityMode = ["player", "team"].includes(url.searchParams.get("entityMode")) ? url.searchParams.get("entityMode") : "player";
  state.focus.entityId = getUrlValue(url, "entityId");
  state.focus.biasMode = url.searchParams.get("biasMode") || "team_against";
  state.compare.subject = ["referee", "team", "player"].includes(url.searchParams.get("compareSubject")) ? url.searchParams.get("compareSubject") : "referee";
  state.compare.left.id = getUrlValue(url, "compareLeftId");
  state.compare.right.id = getUrlValue(url, "compareRightId");
  state.compare.left.season = getUrlValue(url, "compareLeftSeason");
  state.compare.right.season = getUrlValue(url, "compareRightSeason");
  state.compare.left.seasonType = getUrlValue(url, "compareLeftSeasonType");
  state.compare.right.seasonType = getUrlValue(url, "compareRightSeasonType");
}

function buildDashboardQuery(params = {}) {
  const url = new URL(window.location.href);
  url.search = "";
  const nextView = params.view || state.view;
  const queryEntries = {
    view: nextView === "overview" ? "" : nextView,
    season: state.filters.season,
    gameId: state.filters.gameId,
    refereeId: state.filters.refereeId,
    teamId: state.filters.teamId,
    playerId: state.filters.playerId,
    period: state.filters.period,
    scoreState: state.filters.scoreState,
    seasonType: state.filters.seasonType,
    venueContext: state.filters.venueContext,
    refFocus: state.focus.refereeId,
    profileRefereeId: state.focus.profileRefereeId,
    entityMode: state.focus.entityMode === "player" ? "" : state.focus.entityMode,
    entityId: state.focus.entityId,
    biasMode: state.focus.biasMode === "team_against" ? "" : state.focus.biasMode,
    compareSubject: state.compare.subject === "referee" ? "" : state.compare.subject,
    compareLeftId: state.compare.left.id,
    compareRightId: state.compare.right.id,
    compareLeftSeason: state.compare.left.season,
    compareRightSeason: state.compare.right.season,
    compareLeftSeasonType: state.compare.left.seasonType,
    compareRightSeasonType: state.compare.right.seasonType,
    ...params,
  };

  Object.entries(queryEntries).forEach(([key, value]) => {
    if (value == null || value === "" || value === "all") {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, value);
  });

  return url.searchParams;
}

function buildViewUrl(view) {
  const url = new URL(window.location.href);
  url.search = buildDashboardQuery({ view }).toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

function syncLocationState({ pushHistory = false } = {}) {
  const method = pushHistory ? "pushState" : "replaceState";
  window.history[method]({ view: state.view }, "", buildViewUrl(state.view));
}

function getSerializableDashboardState() {
  return {
    view: state.view,
    filters: { ...state.filters },
    focus: {
      refereeId: state.focus.refereeId,
      profileRefereeId: state.focus.profileRefereeId,
      entityMode: state.focus.entityMode,
      entityId: state.focus.entityId,
      biasMode: state.focus.biasMode,
    },
  };
}

function applySerializableDashboardState(snapshot = {}, { navigate = true } = {}) {
  state.view = validViews.has(snapshot.view) ? snapshot.view : "overview";
  state.ui.navGroup = getNavigationGroupKey(state.view);
  state.ui.panels.navExpanded = false;
  state.filters = {
    ...state.filters,
    ...(snapshot.filters || {}),
  };
  state.focus = {
    ...state.focus,
    ...(snapshot.focus || {}),
  };
  syncLocationState({ pushHistory: navigate });
  render();
  maybeLoadViewAnalytics();
  if (viewNeedsRawPlayByPlay(state.view)) {
    ensureRawPlayByPlayLoaded();
  }
}

function loadSavedPresets() {
  try {
    const raw = window.localStorage.getItem(savedPresetsStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    state.presets.items = Array.isArray(parsed) ? parsed : [];
  } catch {
    state.presets.items = [];
  }
}

function persistSavedPresets() {
  try {
    window.localStorage.setItem(savedPresetsStorageKey, JSON.stringify(state.presets.items));
  } catch {
    // Ignore storage failures.
  }
}

function describePreset(preset) {
  const parts = [];
  if (preset.filters?.seasonType && preset.filters.seasonType !== "all") parts.push(preset.filters.seasonType);
  if (preset.filters?.gameId && preset.filters.gameId !== "all") {
    const game = state.lookups.games[preset.filters.gameId];
    if (game) parts.push(getGameLabel(game, state.lookups));
  }
  if (preset.filters?.teamId && preset.filters.teamId !== "all") parts.push(state.lookups.teams[preset.filters.teamId]?.abbreviation || preset.filters.teamId);
  if (preset.filters?.playerId && preset.filters.playerId !== "all") parts.push(state.lookups.players[preset.filters.playerId]?.displayName || preset.filters.playerId);
  if (preset.filters?.refereeId && preset.filters.refereeId !== "all") parts.push(state.lookups.referees[preset.filters.refereeId]?.displayName || preset.filters.refereeId);
  if (preset.view && preset.view !== "overview") parts.push(preset.view);
  return parts.length ? parts.join(" | ") : "Broad scope";
}

function getPresetEventCount(preset) {
  if (!state.data || !state.lookups) return 0;
  return state.data.foulEvents.filter((event) => matchesFilters(event, preset.filters || state.filters, state.lookups)).length;
}

function saveCurrentPreset() {
  const name = state.presets.draftName.trim();
  state.ui.message = "";
  state.ui.error = "";

  if (!name) {
    state.ui.error = "Give the preset a short name before saving it.";
    render();
    return;
  }

  const preset = {
    id: `preset-${Date.now()}`,
    name,
    ...getSerializableDashboardState(),
    createdAt: new Date().toISOString(),
  };

  state.presets.items = [preset, ...state.presets.items].slice(0, 24);
  state.presets.selectedId = preset.id;
  state.presets.draftName = "";
  persistSavedPresets();
  state.ui.message = `Saved preset "${preset.name}".`;
  render();
}

function applySelectedPreset() {
  const preset = state.presets.items.find((item) => item.id === state.presets.selectedId);
  if (!preset) {
    state.ui.error = "Select a saved preset first.";
    render();
    return;
  }
  applySerializableDashboardState(preset);
  state.ui.message = `Applied preset "${preset.name}".`;
  state.ui.error = "";
  render();
}

function deleteSelectedPreset() {
  const preset = state.presets.items.find((item) => item.id === state.presets.selectedId);
  if (!preset) {
    state.ui.error = "Select a saved preset first.";
    render();
    return;
  }

  state.presets.items = state.presets.items.filter((item) => item.id !== preset.id);
  state.presets.selectedId = state.presets.items[0]?.id || "";
  persistSavedPresets();
  state.ui.message = `Deleted preset "${preset.name}".`;
  state.ui.error = "";
  render();
}

async function navigateToView(view, { pushHistory = false } = {}) {
  const nextView = validViews.has(view) ? view : "overview";
  const currentView = state.view;

  if (nextView === "profile" && state.focus.profileRefereeId === "all") {
    state.focus.profileRefereeId =
      state.focus.refereeId !== "all"
        ? state.focus.refereeId
        : (getAvailableReferees(getBaseFilteredEvents())[0]?.id || "all");
  }

  state.view = nextView;
  state.ui.navGroup = getNavigationGroupKey(nextView);
  state.ui.panels.navExpanded = false;

  if (pushHistory && nextView !== currentView) {
    syncLocationState({ pushHistory: true });
  } else if (nextView !== currentView) {
    syncLocationState();
  }

  if (nextView === "admin") {
    await refreshAdminPanel();
    return;
  }

  render();

  if (viewNeedsRawPlayByPlay(nextView)) {
    ensureRawPlayByPlayLoaded();
  }
}

function getBaseFilteredEvents() {
  const key = JSON.stringify(state.filters);
  if (_cachedBaseEventsKey === key && _cachedBaseEvents !== null) {
    return _cachedBaseEvents;
  }
  _cachedBaseEventsKey = key;
  _cachedBaseEvents = state.data.foulEvents.filter((event) => matchesFilters(event, state.filters, state.lookups));
  return _cachedBaseEvents;
}

function getEventsForView(view = state.view) {
  let events = getBaseFilteredEvents();

  if (view === "close") {
    events = events.filter((event) => getEventContext(event, state.lookups).isCloseGame);
  }

  if (view === "last2") {
    events = events.filter((event) => getEventContext(event, state.lookups).isLastTwoMinutes);
  }

  return events;
}

function getAvailableReferees(events) {
  const ids = new Set(events.map((event) => event.refereeId).filter(Boolean));
  return state.data.referees.filter((referee) => ids.has(referee.id));
}

function getAvailablePlayers(events) {
  const ids = new Set(events.flatMap((event) => [event.penalizedPlayerId, event.benefitedPlayerId]).filter(Boolean));
  return state.data.players.filter((player) => ids.has(player.id));
}

function getAvailableTeams(events) {
  const ids = new Set(events.flatMap((event) => [event.penalizedTeamId, event.benefitedTeamId]).filter(Boolean));
  return state.data.teams.filter((team) => ids.has(team.id));
}

function getHeadlineMetrics(events) {
  const reviewed = events.filter((event) => event.challengeReviewed).length;
  const overturned = events.filter((event) => event.challengeOverturned).length;
  const freeThrowsAwarded = sumBy(events, (event) => event.freeThrowsAwarded);
  const highConfidenceShare = events.length
    ? events.filter((event) => event.sourceConfidence >= 0.95).length / events.length
    : 0;
  const l2mTagged = events.filter((event) => event.l2mDecision).length;
  const incorrectCalls = events.filter((event) => event.l2mDecision === "IC").length;

  return [
    { label: "Whistles in scope", value: String(events.length), note: "Filtered foul events" },
    { label: "Free throws awarded", value: String(freeThrowsAwarded), note: "Across the current scope" },
    { label: "Reviewed calls", value: String(reviewed), note: `${overturned} inferred overturned reviews` },
    { label: "L2M overlays", value: String(l2mTagged), note: `${incorrectCalls} incorrect calls tagged` },
    { label: "High-confidence attribution", value: formatPercent(highConfidenceShare), note: "Events at 0.95 confidence or higher" },
  ];
}

function renderMetricCards(metrics) {
  return metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metric.label}</p>
          <p class="metric-value">${metric.value}</p>
          <p class="metric-note">${metric.note}</p>
        </article>
      `,
    )
    .join("");
}

function renderBarList(rows, valueKey = "count", emptyText = "No rows to show.") {
  if (!rows.length) {
    return `<p class="empty-state">${emptyText}</p>`;
  }

  const maxValue = Math.max(...rows.map((row) => row[valueKey]), 1);
  return rows
    .map((row) => {
      const width = `${(row[valueKey] / maxValue) * 100}%`;
      return `
        <div class="bar-row">
          <div class="bar-meta">
            <span>${row.label}</span>
            <strong>${row[valueKey]}</strong>
          </div>
          <div class="bar-track">
            <span class="bar-fill" style="width: ${width}"></span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTableHeaderCell(label, helpText = "") {
  if (!helpText) {
    return `<th>${label}</th>`;
  }

  return `
    <th>
      <span class="table-header-help" tabindex="0">
        <span class="table-header-label">${label}</span>
        <span class="table-header-info" aria-hidden="true">i</span>
        <span class="table-header-tooltip" role="tooltip">${helpText}</span>
      </span>
    </th>
  `;
}

function renderTableCell(label, content, className = "", extraAttributes = "") {
  const classMarkup = className ? ` class="${className}"` : "";
  const extraMarkup = extraAttributes ? ` ${extraAttributes}` : "";
  return `<td data-label="${escapeHtml(label)}"${classMarkup}${extraMarkup}>${content}</td>`;
}

function formatShortDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatChallengeOutcome(outcome) {
  const value = String(outcome || "unknown").trim();
  if (!value) return "Unknown";
  if (value === "upheld_likely") return "Upheld likely";
  if (value === "overturned_likely") return "Overturned likely";
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function getChallengeOutcomeTagClass(outcome) {
  if (String(outcome || "").startsWith("upheld")) return "tag is-good";
  if (String(outcome || "").startsWith("overturned")) return "tag is-warning";
  return "tag is-neutral";
}

function formatChallengeSource(source) {
  const value = String(source || "inferred").trim();
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatChallengeReason(reason) {
  const value = String(reason || "").trim();
  if (!value) return "No clear sequence signal";
  return value.replaceAll("_", " ");
}

function isEmbeddableVideoUrl(url) {
  return /\.(mp4|webm|m3u8)(\?|$)/i.test(String(url || ""));
}

function getEvidenceRecord(event, challengeEvent = null) {
  if (!event && !challengeEvent) return null;
  const game = state.lookups.games[event?.gameId || challengeEvent?.gameId] || null;
  const refereeId = event?.refereeId || challengeEvent?.linkedRefereeId || null;
  const referee = refereeId ? state.lookups.referees[refereeId] || null : null;
  const penalizedLabel =
    event
      ? state.lookups.players[event.penalizedPlayerId]?.displayName || state.lookups.teams[event.penalizedTeamId]?.abbreviation || "Unknown"
      : "Unknown";
  const benefitedLabel =
    event
      ? state.lookups.players[event.benefitedPlayerId]?.displayName || state.lookups.teams[event.benefitedTeamId]?.abbreviation || "Unknown"
      : "Unknown";
  const reportUrl = getL2mReportUrl(event?.gameId || challengeEvent?.gameId);
  const primaryUrl = event?.l2mVideoUrl || reportUrl;

  return {
    id: `${event?.id || "no-event"}|${challengeEvent?.id || "no-challenge"}`,
    eventId: event?.id || null,
    challengeId: challengeEvent?.id || null,
    gameId: event?.gameId || challengeEvent?.gameId || null,
    title: game ? getGameLabel(game, state.lookups) : event?.gameId || challengeEvent?.gameId || "Evidence",
    subtitle: referee?.displayName || "Unknown referee",
    callLabel: event ? `${humanizeCallType(event.foulType)} | ${event.foulSubtype}` : "Challenge evidence",
    period: event?.period || challengeEvent?.period || null,
    clock: event?.periodClock || challengeEvent?.periodClock || "",
    against: penalizedLabel,
    benefited: benefitedLabel,
    outcome: event?.challengeOutcome || challengeEvent?.challengeOutcome || event?.l2mDecision || "",
    description: event?.description || challengeEvent?.description || "",
    primaryUrl,
    primaryUrlEmbeddable: isEmbeddableVideoUrl(primaryUrl),
    videoUrl: event?.l2mVideoUrl || "",
    reportUrl,
    reviewSource: challengeEvent ? "Challenge review" : event?.l2mDecision ? "L2M evidence" : "Play evidence",
  };
}

function getEvidenceRecordByIds(eventId, challengeId) {
  const event = eventId ? state.data.foulEvents.find((item) => item.id === eventId) || null : null;
  const challengeEvent = challengeId ? state.data.challengeEvents.find((item) => item.id === challengeId) || null : null;
  return getEvidenceRecord(event, challengeEvent);
}

function persistEvidenceBookmarks() {
  try {
    window.localStorage.setItem(evidenceBookmarksStorageKey, JSON.stringify(state.video.bookmarks));
  } catch {
    // Ignore storage failures.
  }
}

function loadEvidenceBookmarks() {
  try {
    const raw = window.localStorage.getItem(evidenceBookmarksStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    state.video.bookmarks = Array.isArray(parsed) ? parsed : [];
  } catch {
    state.video.bookmarks = [];
  }
}

function openEvidenceDrawerByIds(eventId, challengeId = "") {
  const record = getEvidenceRecordByIds(eventId, challengeId || null);
  if (!record) {
    state.ui.error = "Unable to load evidence for that play.";
    render();
    return;
  }
  state.video.active = record;
  state.video.drawerOpen = true;
  render();
}

function addEvidenceToQueue(record) {
  if (!record) return;
  if (!state.video.queue.some((item) => item.id === record.id)) {
    state.video.queue.push(record);
  }
  state.video.active = record;
  state.video.drawerOpen = true;
}

function toggleEvidenceBookmark(record) {
  if (!record) return;
  const existing = state.video.bookmarks.some((item) => item.id === record.id);
  if (existing) {
    state.video.bookmarks = state.video.bookmarks.filter((item) => item.id !== record.id);
    state.ui.message = "Removed play from evidence bookmarks.";
  } else {
    state.video.bookmarks = [record, ...state.video.bookmarks].slice(0, 50);
    state.ui.message = "Bookmarked play for later film review.";
  }
  persistEvidenceBookmarks();
  render();
}

function removeEvidenceQueueItem(recordId) {
  state.video.queue = state.video.queue.filter((item) => item.id !== recordId);
  if (state.video.active?.id === recordId) {
    state.video.active = state.video.queue[0] || state.video.bookmarks[0] || null;
  }
}

function getL2mReportUrl(gameId) {
  if (!gameId) return "";
  return `https://official.nba.com/l2m/L2MReport.html?gameId=${gameId}`;
}

function renderEvidenceLinks(event, challengeEvent = null) {
  const record = getEvidenceRecord(event, challengeEvent);
  const links = [];
  if (event?.l2mVideoUrl) {
    links.push(`<a href="${event.l2mVideoUrl}" target="_blank" rel="noreferrer">L2M video</a>`);
  }
  if (event?.l2mDecision) {
    links.push(`<a href="${getL2mReportUrl(event.gameId)}" target="_blank" rel="noreferrer">L2M report</a>`);
  }
  if (challengeEvent?.payloadJson?.actionNumber || challengeEvent?.linkedRawEventId) {
    links.push(`<a href="${getL2mReportUrl(challengeEvent.gameId)}" target="_blank" rel="noreferrer">Official game report</a>`);
  }
  if (!links.length) {
    return `<span class="cell-subtle">No linked evidence</span>`;
  }
  return `
    <div class="evidence-links">
      <button class="mini-link-button" data-open-evidence="${record?.eventId || ""}" data-open-evidence-challenge="${record?.challengeId || ""}">Review</button>
      <span class="evidence-sep">|</span>
      ${links.join("<span class=\"evidence-sep\">|</span>")}
    </div>
  `;
}

function getSubjectOptions(subject, events) {
  if (subject === "team") {
    return getAvailableTeams(events).map((team) => ({
      id: team.id,
      label: `${team.abbreviation} | ${team.name}`,
    }));
  }
  if (subject === "player") {
    return getAvailablePlayers(events).map((player) => ({
      id: player.id,
      label: player.displayName,
    }));
  }
  return getAvailableReferees(events).map((referee) => ({
    id: referee.id,
    label: referee.displayName,
  }));
}

function getComparisonScope(subject, targetId, season, seasonType) {
  if (!targetId || targetId === "all") return [];
  return state.data.foulEvents.filter((event) => {
    if (season !== "all" && event.season !== season) return false;
    if (seasonType !== "all" && event.seasonType !== seasonType) return false;
    if (subject === "team") {
      return event.penalizedTeamId === targetId || event.benefitedTeamId === targetId;
    }
    if (subject === "player") {
      return event.penalizedPlayerId === targetId || event.benefitedPlayerId === targetId;
    }
    return event.refereeId === targetId;
  });
}

function getComparisonLabel(subject, targetId) {
  if (subject === "team") {
    const team = state.lookups.teams[targetId];
    return team ? `${team.city} ${team.name}` : "Unknown team";
  }
  if (subject === "player") {
    return state.lookups.players[targetId]?.displayName || "Unknown player";
  }
  return state.lookups.referees[targetId]?.displayName || "Unknown referee";
}

function getComparisonMetrics(subject, targetId, events, season, seasonType) {
  const filters = { ...state.filters, season, seasonType };
  const scopeEvents = getComparisonScope(subject, targetId, season, seasonType);
  const reviewed = scopeEvents.filter((event) => event.challengeReviewed);
  const overturned = reviewed.filter((event) => event.challengeOverturned).length;
  const adjusted =
    subject === "team"
      ? getAdjustedEntityMetrics(scopeEvents, state.data, state.lookups, filters, "team", targetId)
      : subject === "player"
        ? getAdjustedEntityMetrics(scopeEvents, state.data, state.lookups, filters, "player", targetId)
        : getAdjustedRefereeMetrics(scopeEvents, state.data, state.lookups, filters, targetId);

  return {
    label: getComparisonLabel(subject, targetId),
    events: scopeEvents.length,
    reviewed: reviewed.length,
    overturnRate: reviewed.length ? overturned / reviewed.length : 0,
    freeThrows: sumBy(scopeEvents, (event) => event.freeThrowsAwarded || 0),
    closeCalls: scopeEvents.filter((event) => event.isCloseGame).length,
    lastTwoCalls: scopeEvents.filter((event) => event.isLastTwoMinutes).length,
    adjusted,
    season,
    seasonType,
    topCalls: getCallTypeBreakdown(scopeEvents).slice(0, 5).map(([key, count]) => ({ label: humanizeCallType(key), count })),
  };
}

function getPaletteActions() {
  const actions = [
    ...[
      ["overview", "Open Overview"],
      ["games", "Open Game Explorer"],
      ["referees", "Open Referee Lens"],
      ["profile", "Open Referee Profile"],
      ["entities", "Open Player / Team"],
      ["bias", "Open Bias Lab"],
      ["crew", "Open Crew Analytics"],
      ["challenge", "Open Challenge Analytics"],
      ["compare", "Open Compare Mode"],
      ["trends", "Open Trends"],
      ["about", "Open About"],
      ["admin", "Open Admin"],
    ].map(([view, label]) => ({
      id: `view-${view}`,
      label,
      detail: "Navigation",
      run() {
        navigateToView(view, { pushHistory: true });
        state.palette.open = false;
      },
    })),
    ...state.presets.items.map((preset) => ({
      id: `preset-${preset.id}`,
      label: preset.name,
      detail: `Preset | ${describePreset(preset)}`,
      run() {
        state.presets.selectedId = preset.id;
        applySelectedPreset();
        state.palette.open = false;
      },
    })),
    ...state.data.referees.map((referee) => ({
      id: `ref-${referee.id}`,
      label: referee.displayName,
      detail: "Referee profile",
      run() {
        openRefereeProfile(referee.id);
        state.palette.open = false;
      },
    })),
    ...state.data.teams.map((team) => ({
      id: `team-${team.id}`,
      label: `${team.city} ${team.name}`,
      detail: "Team entity lens",
      run() {
        state.focus.entityMode = "team";
        state.focus.entityId = team.id;
        navigateToView("entities", { pushHistory: true });
        state.palette.open = false;
      },
    })),
    ...state.data.players.slice(0, 300).map((player) => ({
      id: `player-${player.id}`,
      label: player.displayName,
      detail: "Player entity lens",
      run() {
        state.focus.entityMode = "player";
        state.focus.entityId = player.id;
        navigateToView("entities", { pushHistory: true });
        state.palette.open = false;
      },
    })),
  ];

  const query = state.palette.query.trim().toLowerCase();
  if (!query) return actions.slice(0, 20);
  return actions
    .filter((action) => `${action.label} ${action.detail}`.toLowerCase().includes(query))
    .slice(0, 20);
}

function getRefereeMediaSeason(refereeId) {
  const officialGame = state.data.gameOfficials.find((official) => official.refereeId === refereeId);
  const game = officialGame ? state.lookups.games[officialGame.gameId] : state.data.games[0];
  return game?.season || state.data.games[0]?.season || "";
}

function slugifyRefereeMediaName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function getRefereeMedia(referee) {
  if (!referee) {
    return {
      photoPreviewUrl: "",
      officialBioPdfUrl: "",
      officialHeadshotsPdfUrl: "https://official.nba.com/wp-content/uploads/sites/4/2025/10/2025-26-NBA-Referee-Headshots.pdf",
    };
  }

  const season = getRefereeMediaSeason(referee.id);
  const uploadYear = /^\d{4}/.test(season) ? season.slice(0, 4) : "2025";
  const fileSlug = slugifyRefereeMediaName(referee.displayName);
  const basePath = `https://official.nba.com/wp-content/uploads/sites/4/${uploadYear}/10/${fileSlug}`;

  return {
    photoPreviewUrl: `${basePath}-pdf.jpg`,
    officialBioPdfUrl: `https://ak-static.cms.nba.com/wp-content/uploads/sites/4/${uploadYear}/10/${fileSlug}.pdf`,
    officialHeadshotsPdfUrl: `https://official.nba.com/wp-content/uploads/sites/4/${uploadYear}/10/${uploadYear}-${String(Number(uploadYear) + 1).slice(-2)}-NBA-Referee-Headshots.pdf`,
  };
}

function getInitials(name) {
  const parts = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

function getTeamLogoUrl(team) {
  const teamId = team?.nbaTeamId || team?.id;
  if (!teamId) return "";
  return `https://cdn.nba.com/logos/nba/${teamId}/global/L/logo.svg`;
}

function getPlayerHeadshotUrl(player) {
  const playerId = player?.nbaPlayerId || player?.id;
  if (!playerId) return "";
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`;
}

function renderTeamIdentity(team) {
  if (!team) return "";

  return `
    <div class="team-identity">
      <div class="team-logo-shell" aria-hidden="true">
        <img
          class="team-logo-image"
          src="${getTeamLogoUrl(team)}"
          alt=""
          loading="lazy"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        />
        <div class="team-logo-fallback" style="display:none;">${team.abbreviation || getInitials(team.name)}</div>
      </div>
      <div class="team-identity-copy">
        <h3>${team.city} ${team.name}</h3>
        <p class="panel-caption">${team.abbreviation}</p>
      </div>
    </div>
  `;
}

function renderPlayerIdentity(player) {
  if (!player) return "";
  const team = state.lookups.teams[player.teamId];

  return `
    <div class="player-identity">
      <div class="player-headshot-shell">
        <img
          class="player-headshot-image"
          src="${getPlayerHeadshotUrl(player)}"
          alt="${player.displayName} headshot"
          loading="lazy"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        />
        <div class="player-headshot-fallback" style="display:none;">${getInitials(player.displayName)}</div>
      </div>
      <div class="player-identity-copy">
        <div class="player-identity-heading">
          <h3>${player.displayName}</h3>
          ${team ? `<span class="tag">${team.abbreviation}</span>` : ""}
        </div>
        <p class="panel-caption">${[player.position || "", team ? `${team.city} ${team.name}` : ""].filter(Boolean).join(" | ")}</p>
      </div>
      ${team ? `<div class="player-team-logo-inline"><img src="${getTeamLogoUrl(team)}" alt="" loading="lazy" onerror="this.style.display='none';" /></div>` : ""}
    </div>
  `;
}

function renderRefereePhotoCard(referee) {
  const media = getRefereeMedia(referee);
  const initials = getInitials(referee?.displayName);

  return `
    <article class="panel-card referee-portrait-card">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Official Photo</p>
          <h3>${referee?.displayName || "Referee"}</h3>
        </div>
        ${referee?.jerseyNumber ? `<span class="tag">#${referee.jerseyNumber}</span>` : ""}
      </div>
      <div class="referee-portrait-shell">
        <img
          class="referee-portrait-image"
          src="${media.photoPreviewUrl}"
          alt="${referee?.displayName || "Referee"} official photo"
          loading="lazy"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        />
        <div class="referee-portrait-fallback" style="display:none;" aria-hidden="true">
          <span>${initials}</span>
        </div>
      </div>
      <p class="panel-caption">The app tries to use the official NBA bio preview image for this referee. If that preview is unavailable, the fallback card stays in place and you can still open the official bio PDF.</p>
      <div class="control-cluster portrait-actions">
        <a class="action-button" href="${media.officialBioPdfUrl}" target="_blank" rel="noreferrer">Open official bio</a>
        <a class="action-button" href="${media.officialHeadshotsPdfUrl}" target="_blank" rel="noreferrer">Open headshots guide</a>
      </div>
    </article>
  `;
}

function buildChallengeRows(events) {
  const scopedFoulIds = new Set(events.filter((event) => event.challengeReviewed).map((event) => event.id));
  const foulEventsById = new Map(events.map((event) => [event.id, event]));

  return (state.data.challengeEvents || [])
    .filter((challengeEvent) => challengeEvent.linkedFoulEventId && scopedFoulIds.has(challengeEvent.linkedFoulEventId))
    .map((challengeEvent) => ({
      challengeEvent,
      foulEvent: foulEventsById.get(challengeEvent.linkedFoulEventId) || null,
      game: state.lookups.games[challengeEvent.gameId] || null,
      referee: challengeEvent.linkedRefereeId ? state.lookups.referees[challengeEvent.linkedRefereeId] || null : null,
      challengeTeam: challengeEvent.teamId ? state.lookups.teams[challengeEvent.teamId] || null : null,
    }))
    .filter((row) => row.foulEvent);
}

function canUseChallengeSummaryTables() {
  return Boolean(
    state.data.summaryTables &&
      state.filters.gameId === "all" &&
      state.filters.refereeId === "all" &&
      state.filters.teamId === "all" &&
      state.filters.playerId === "all" &&
      state.filters.period === "all" &&
      state.filters.scoreState === "all" &&
      state.filters.venueContext === "all",
  );
}

function getChallengeSummaryRefRows() {
  return getSummaryRows(state.data, "challengeRefereeOverview", {
    seasonType: state.filters.seasonType,
    window: "all",
  });
}

function getChallengeSummaryTeamRows() {
  return getSummaryRows(state.data, "challengeTeamOverview", {
    seasonType: state.filters.seasonType,
    window: "all",
  });
}

function getChallengeSummaryOutcomeRows(window = "all") {
  return getSummaryRows(state.data, "challengeOutcomeOverview", {
    seasonType: state.filters.seasonType,
    window,
  });
}

function getAlertClassName(level) {
  if (level === "critical") return "status-banner-bad";
  if (level === "warning") return "status-banner-warning";
  return "status-banner-info";
}

function renderOperationalAlerts() {
  const alerts = getOperationalAlerts();
  if (!alerts.length) return "";

  return `
    <section class="stack-section operational-alerts">
      ${alerts
        .map(
          (alert) => `
            <article class="status-banner ${getAlertClassName(alert.level)} status-banner-row">
              <div class="alert-body">
                <strong>${alert.message}</strong>
                ${alert.detail ? `<div>${alert.detail}</div>` : ""}
              </div>
              ${alert.level === "critical" ? `
                <button class="action-button action-button-quiet" id="quick-sync-btn" ${state.admin.isSubmitting ? "disabled" : ""}>
                  ${state.admin.isSubmitting ? "Syncing…" : "Sync now"}
                </button>
              ` : ""}
            </article>
          `,
        )
        .join("")}
    </section>
  `;
}

function getAnalyticsQueryString(kind) {
  const params = buildDashboardQuery({ view: state.view });
  params.delete("view");

  if (kind === "bias") {
    params.set("mode", state.focus.biasMode);
  }

  if (kind === "profile") {
    params.set("profileRefereeId", state.focus.profileRefereeId);
  }

  return params.toString();
}

function getAnalyticsKey(kind) {
  return `${kind}?${getAnalyticsQueryString(kind)}`;
}

async function ensureServerAnalytics(kind) {
  if (!state.data) return;
  const analyticsState = state.analytics[kind];
  const key = getAnalyticsKey(kind);
  if (analyticsState.loading || analyticsState.key === key) {
    return;
  }

  analyticsState.loading = true;
  analyticsState.error = "";
  analyticsState.key = key;
  // Keep stale data visible during the fetch — don't null it out.
  // The view renders with a subtle "Updating…" indicator instead of going blank.
  render();

  try {
    const endpointMap = {
      bias: "/api/analytics/bias",
      crew: "/api/analytics/crew",
      profile: "/api/analytics/referee-profile",
    };
    const response = await fetch(`${endpointMap[kind]}?${getAnalyticsQueryString(kind)}`);
    if (!response.ok) {
      throw new Error(`Analytics request failed: ${response.status}`);
    }

    const payload = await response.json();
    if (analyticsState.key !== key) {
      // A newer request superseded this one — discard silently.
      return;
    }

    analyticsState.data = payload;
    analyticsState.error = "";
  } catch (error) {
    // On error, keep the stale data but surface the message.
    analyticsState.error = error instanceof Error ? error.message : String(error);
  } finally {
    analyticsState.loading = false;
    render();
  }
}

function maybeLoadViewAnalytics() {
  if (state.view === "bias") {
    ensureServerAnalytics("bias");
  } else if (state.view === "crew") {
    ensureServerAnalytics("crew");
  } else if (state.view === "profile") {
    if (state.focus.profileRefereeId === "all") {
      state.focus.profileRefereeId =
        state.focus.refereeId !== "all"
          ? state.focus.refereeId
          : (getAvailableReferees(getEventsForView())[0]?.id || "all");
    }
    ensureServerAnalytics("profile");
  }
}

function renderUiBanner() {
  if (!state.ui.message && !state.ui.error) return "";

  return `
    <section class="stack-section operational-alerts">
      ${state.ui.message ? `<article class="status-banner status-banner-good"><strong>${state.ui.message}</strong></article>` : ""}
      ${state.ui.error ? `<article class="status-banner status-banner-bad"><strong>${state.ui.error}</strong></article>` : ""}
    </section>
  `;
}

function renderAppStatusStrip() {
  const health = state.admin.health;
  const datasetStatus = health?.datasetStatus || {};
  const syncState = health?.syncState || {};
  const version = health?.appVersion || "dev";

  return `
    <section class="panel-card compact-panel shell-status-strip">
      <div class="tag-row">
        <span class="tag">v${version}</span>
        <span class="tag">${datasetStatus.sampleType || "unknown dataset"}</span>
        <span class="tag">Last sync: ${formatDateTime(syncState.lastCompletedAt || datasetStatus.generatedAt)}</span>
        <span class="tag">${health?.databaseEnabled ? "Postgres on" : "File cache"}</span>
        <span class="tag">${health?.autoSyncEnabled ? "Auto sync enabled" : "Manual sync only"}</span>
        <button class="action-button action-button-quiet" id="toggle-theme">${state.ui.theme === "dark" ? "Light mode" : "Dark mode"}</button>
      </div>
    </section>
  `;
}

function renderCoveragePanel(events) {
  if (!state.data || !state.lookups) return "";
  const coverage = getCoverageSummary(events, state.data, state.lookups);
  const notes = [];

  if (coverage.games <= 1) {
    notes.push("Current scope is only one game wide. Treat any signal as exploratory.");
  }
  if (coverage.reviewedWhistles && coverage.inferredChallengeShare >= 0.75) {
    notes.push("Most challenge outcomes in this scope are inferred rather than explicit official rulings.");
  }
  if (coverage.players <= 3) {
    notes.push("Player coverage is thin in this scope, so entity-level splits may swing quickly.");
  }

  return `
    <section class="panel-card compact-panel coverage-panel">
      <div class="split-header">
        <div>
          <p class="eyebrow">Coverage</p>
          <h3>What this scope actually includes</h3>
        </div>
        <div class="tag-row">
          <span class="tag">${coverage.games} games</span>
          <span class="tag">${coverage.crews} crews</span>
          <span class="tag">${coverage.referees} referees</span>
          <span class="tag">${coverage.teams} teams</span>
          <span class="tag">${coverage.players} players</span>
        </div>
      </div>
      <div class="admin-stat-list compact-stat-list">
        <div class="stat-pair"><span>Reviewed whistles</span><strong>${coverage.reviewedWhistles}</strong></div>
        <div class="stat-pair"><span>Challenge outcomes inferred</span><strong>${formatPercent(coverage.inferredChallengeShare)}</strong></div>
        <div class="stat-pair"><span>L2M-tagged whistle share</span><strong>${formatPercent(coverage.l2mShare)}</strong></div>
      </div>
      ${notes.length ? `<div class="tag-row">${notes.map((note) => `<span class="tag is-neutral">${note}</span>`).join("")}</div>` : ""}
    </section>
  `;
}

function renderWorkspaceShell(events) {
  if (!state.data || !state.lookups) return "";

  const meta = getCurrentViewMeta();
  const health = state.admin.health;
  const datasetStatus = health?.datasetStatus || {};
  const syncState = health?.syncState || {};
  const coverage = getCoverageSummary(events, state.data, state.lookups);
  const scopeTags = getActiveScopeTags();
  const filtersOpenLabel = state.ui.panels.filtersOpen ? "Hide controls" : "Show controls";
  const presetsOpenLabel = state.ui.panels.presetsOpen ? "Hide presets" : "Presets";
  const exportsOpenLabel = state.ui.panels.exportsOpen ? "Hide export tools" : "Export";

  return `
    <section class="panel-card compact-panel workspace-shell-card">
      <div class="workspace-shell-top">
        <div class="workspace-shell-copy">
          <p class="eyebrow">${meta.eyebrow}</p>
          <div class="workspace-title-row">
            <h2>${meta.title}</h2>
            <span class="tag">${events.length} events</span>
          </div>
          <p class="panel-caption workspace-caption">${meta.description}</p>
        </div>
        <div class="workspace-shell-actions">
          <button class="action-button" id="open-command-palette">Search</button>
          <button class="action-button ${state.ui.panels.filtersOpen ? "action-button-accent" : ""}" id="toggle-filters-panel">${filtersOpenLabel}</button>
          <button class="action-button" id="toggle-presets-panel">${presetsOpenLabel}</button>
          <button class="action-button" id="toggle-exports-panel">${exportsOpenLabel}</button>
          <button class="action-button action-button-quiet" id="toggle-theme">${state.ui.theme === "dark" ? "Light mode" : "Dark mode"}</button>
          <button class="action-button" id="reset-filters">Reset scope</button>
        </div>
      </div>
      <div class="workspace-summary-grid">
        <div class="tag-row">
          <span class="tag">v${health?.appVersion || "dev"}</span>
          <span class="tag">${datasetStatus.sampleType || "unknown dataset"}</span>
          <span class="tag">${health?.databaseEnabled ? "Postgres on" : "File cache"}</span>
          <span class="tag">${health?.autoSyncEnabled ? "Auto sync enabled" : "Manual sync only"}</span>
          <span class="tag">Last sync ${formatDateTime(syncState.lastCompletedAt || datasetStatus.generatedAt)}</span>
        </div>
        <div class="tag-row">
          <span class="tag is-neutral">${coverage.games} games</span>
          <span class="tag is-neutral">${coverage.referees} referees</span>
          <span class="tag is-neutral">${coverage.teams} teams</span>
          <span class="tag is-neutral">${coverage.players} players</span>
          <span class="tag is-neutral">${coverage.reviewedWhistles} reviewed whistles</span>
        </div>
        ${
          scopeTags.length
            ? `<div class="tag-row workspace-scope-row">${scopeTags.map((tag) => `<span class="tag is-neutral">${escapeHtml(tag)}</span>`).join("")}</div>`
            : `<p class="panel-caption workspace-caption">Current scope is broad. Use the controls below to narrow to a season, referee, team, player, game, or late-game state.</p>`
        }
      </div>
      ${renderControls(events)}
    </section>
  `;
}

function getConfidenceTagClass(level) {
  if (level === "high") return "tag tag-confidence-high";
  if (level === "medium") return "tag tag-confidence-medium";
  return "tag tag-confidence-low";
}

function syncAdminLoginButtonState() {
  const loginButton = document.querySelector("#admin-login");
  if (!loginButton) return;

  const manualSyncAvailable = Boolean(state.admin.health?.adminAuthEnabled);
  loginButton.disabled = state.admin.isAuthenticating || !manualSyncAvailable || !state.admin.loginToken.trim();
}

function openRefereeProfile(refereeId) {
  if (!refereeId || refereeId === "all") return;
  state.focus.profileRefereeId = refereeId;
  navigateToView("profile", { pushHistory: true });
}

async function copyShareLink() {
  state.ui.message = "";
  state.ui.error = "";
  render();

  try {
    await navigator.clipboard.writeText(window.location.href);
    state.ui.message = "Share link copied to your clipboard.";
  } catch (error) {
    state.ui.error = error instanceof Error ? error.message : "Unable to copy the share link.";
  }

  render();
}

async function exportCurrentViewCsv() {
  state.ui.message = "";
  state.ui.error = "";
  render();

  try {
    const params = buildDashboardQuery({
      view: state.view,
      biasMode: state.focus.biasMode,
      profileRefereeId: state.focus.profileRefereeId,
    });
    const response = await fetch(`/api/export.csv?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `whistleiq-${state.view}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    state.ui.message = `Exported ${state.view} CSV.`;
  } catch (error) {
    state.ui.error = error instanceof Error ? error.message : "Unable to export CSV.";
  }

  render();
}

async function exportCurrentViewReport() {
  state.ui.message = "";
  state.ui.error = "";
  render();

  try {
    const params = buildDashboardQuery({
      view: state.view,
      biasMode: state.focus.biasMode,
      profileRefereeId: state.focus.profileRefereeId,
    });
    const response = await fetch(`/api/export/report?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Report export failed: ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `whistleiq-${state.view}-report.html`;
    document.body.append(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    state.ui.message = `Exported ${state.view} report.`;
  } catch (error) {
    state.ui.error = error instanceof Error ? error.message : "Unable to export report.";
  }

  render();
}

function printCurrentViewReport() {
  const params = buildDashboardQuery({
    view: state.view,
    biasMode: state.focus.biasMode,
    profileRefereeId: state.focus.profileRefereeId,
  });
  window.open(`/api/export/report?${params.toString()}&print=1`, "_blank", "noopener,noreferrer");
}

function renderControls(events) {
  const scopedEvents = getBaseFilteredEvents();
  const referees = getAvailableReferees(scopedEvents);
  const teams = getAvailableTeams(scopedEvents);
  const players = getAvailablePlayers(scopedEvents);
  const seasons = getSeasonOptions();
  const seasonTypes = getSeasonTypeOptions();
  const filtersOpen = state.ui.panels.filtersOpen;
  const advancedFiltersOpen = state.ui.panels.advancedFiltersOpen;
  const presetsOpen = state.ui.panels.presetsOpen;
  const exportsOpen = state.ui.panels.exportsOpen;

  return `
    <section class="workspace-controls">
      ${
        filtersOpen
          ? `
            <div class="filter-panel filter-panel-compact">
              <div class="filter-heading">
                <div>
                  <p class="eyebrow">Scope</p>
                  <h3>Quick filters</h3>
                </div>
                <div class="control-cluster">
                  <p class="filter-note">${events.length} events match the current dashboard scope.</p>
                  <button class="mini-link-button" id="toggle-advanced-filters">${advancedFiltersOpen ? "Hide advanced filters" : "Show advanced filters"}</button>
                </div>
              </div>
              <div class="filters-grid quick-filters-grid">
                <label>
                  <span>Season</span>
                  <select id="filter-season">
                    <option value="all">All seasons</option>
                    ${seasons.map((season) => `<option value="${season}" ${state.filters.season === season ? "selected" : ""}>${season}</option>`).join("")}
                  </select>
                </label>
                <label>
                  <span>Season type</span>
                  <select id="filter-season-type">
                    <option value="all">All season types</option>
                    ${seasonTypes.map((seasonType) => `<option value="${seasonType}" ${state.filters.seasonType === seasonType ? "selected" : ""}>${seasonType}</option>`).join("")}
                  </select>
                </label>
                <label>
                  <span>Referee</span>
                  <select id="filter-referee">
                    <option value="all">All referees</option>
                    ${optionMarkup(referees, "id", (referee) => referee.displayName, state.filters.refereeId)}
                  </select>
                </label>
                <label>
                  <span>Team</span>
                  <select id="filter-team">
                    <option value="all">All teams</option>
                    ${optionMarkup(teams, "id", (team) => `${team.abbreviation} | ${team.name}`, state.filters.teamId)}
                  </select>
                </label>
                <label>
                  <span>Game</span>
                  <select id="filter-game">
                    <option value="all">All games</option>
                    ${optionMarkup(state.data.games, "id", (game) => getGameLabel(game, state.lookups), state.filters.gameId)}
                  </select>
                </label>
              </div>
              ${
                advancedFiltersOpen
                  ? `
                    <div class="workspace-subpanel">
                      <div class="filters-grid advanced-filters-grid">
                        <label>
                          <span>Player</span>
                          <select id="filter-player">
                            <option value="all">All players</option>
                            ${optionMarkup(players, "id", (player) => player.displayName, state.filters.playerId)}
                          </select>
                        </label>
                        <label>
                          <span>Quarter</span>
                          <select id="filter-period">
                            <option value="all">All quarters</option>
                            <option value="1" ${state.filters.period === "1" ? "selected" : ""}>Q1</option>
                            <option value="2" ${state.filters.period === "2" ? "selected" : ""}>Q2</option>
                            <option value="3" ${state.filters.period === "3" ? "selected" : ""}>Q3</option>
                            <option value="4" ${state.filters.period === "4" ? "selected" : ""}>Q4</option>
                          </select>
                        </label>
                        <label>
                          <span>Score state</span>
                          <select id="filter-score-state">
                            <option value="all" ${state.filters.scoreState === "all" ? "selected" : ""}>All score states</option>
                            <option value="clutch" ${state.filters.scoreState === "clutch" ? "selected" : ""}>Clutch</option>
                            <option value="tie" ${state.filters.scoreState === "tie" ? "selected" : ""}>Tied</option>
                            <option value="one-possession" ${state.filters.scoreState === "one-possession" ? "selected" : ""}>One possession</option>
                            <option value="close" ${state.filters.scoreState === "close" ? "selected" : ""}>Close game</option>
                            <option value="blowout" ${state.filters.scoreState === "blowout" ? "selected" : ""}>Blowout</option>
                          </select>
                        </label>
                        <label>
                          <span>Venue split</span>
                          <select id="filter-venue-context">
                            <option value="all" ${state.filters.venueContext === "all" ? "selected" : ""}>All whistle sides</option>
                            <option value="against_home" ${state.filters.venueContext === "against_home" ? "selected" : ""}>Against home team</option>
                            <option value="against_away" ${state.filters.venueContext === "against_away" ? "selected" : ""}>Against away team</option>
                            <option value="benefit_home" ${state.filters.venueContext === "benefit_home" ? "selected" : ""}>Benefiting home team</option>
                            <option value="benefit_away" ${state.filters.venueContext === "benefit_away" ? "selected" : ""}>Benefiting away team</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  `
                  : ""
              }
            </div>
          `
          : ""
      }
      ${
        presetsOpen
          ? `
            <div class="filter-panel filter-panel-compact workspace-secondary-panel">
              <div class="filter-heading">
                <div>
                  <p class="eyebrow">Reuse</p>
                  <h3>Saved presets</h3>
                </div>
              </div>
              <div class="preset-row">
                <label class="inline-control grow-control">
                  <span>Saved preset</span>
                  <select id="saved-preset-select">
                    <option value="">Select a saved preset</option>
                    ${state.presets.items.map((preset) => `<option value="${preset.id}" ${state.presets.selectedId === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>`).join("")}
                  </select>
                </label>
                <label class="inline-control grow-control">
                  <span>Preset name</span>
                  <input id="preset-name" type="text" placeholder="Save current filters as..." value="${escapeHtml(state.presets.draftName)}" />
                </label>
                <button class="action-button" id="apply-preset" ${state.presets.selectedId ? "" : "disabled"}>Apply preset</button>
                <button class="action-button" id="save-preset">Save preset</button>
                <button class="action-button" id="delete-preset" ${state.presets.selectedId ? "" : "disabled"}>Delete preset</button>
              </div>
            </div>
          `
          : ""
      }
      ${
        exportsOpen
          ? `
            <div class="filter-panel filter-panel-compact workspace-secondary-panel">
              <div class="filter-heading">
                <div>
                  <p class="eyebrow">Share</p>
                  <h3>Exports and handoff</h3>
                </div>
              </div>
              <div class="control-cluster workspace-export-cluster">
                <button class="action-button" id="copy-share-link">Copy share link</button>
                <button class="action-button" id="export-current-view">Export CSV</button>
                <button class="action-button" id="export-current-report">Export report</button>
                <button class="action-button" id="print-current-report">Print report</button>
              </div>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderTopbar() {
  const gearOpen = state.ui.panels.gearMenuOpen;
  return `
    <header class="app-topbar">
      <div class="app-topbar-inner">
        <button class="topbar-sidebar-toggle" id="toggle-sidebar" aria-label="${state.ui.sidebarCollapsed ? "Open" : "Close"} navigation" aria-expanded="${!state.ui.sidebarCollapsed}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="topbar-brand" data-view="overview" aria-label="WhistleIQ home">
          <span class="topbar-brand-dot" aria-hidden="true"></span>
          WhistleIQ
        </button>
        <span class="topbar-spacer"></span>
        <div class="topbar-actions">
          <button class="topbar-icon-btn" id="open-command-palette" title="Quick search (Cmd/Ctrl + K)">⌘K Search</button>
          <button class="topbar-icon-btn" id="toggle-theme">${state.ui.theme === "dark" ? "Light" : "Dark"}</button>
          <div class="gear-menu-shell">
            <button class="topbar-icon-btn ${gearOpen ? "is-active" : ""}" id="toggle-gear-menu" aria-label="Settings" aria-expanded="${gearOpen}" title="Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            ${gearOpen ? `
              <div class="gear-menu" id="gear-menu" role="menu">
                <button class="gear-menu-item" data-view="about" role="menuitem">About</button>
                <button class="gear-menu-item" data-view="admin" role="menuitem">Admin</button>
              </div>
              <div class="gear-menu-backdrop" id="close-gear-menu" aria-hidden="true"></div>
            ` : ""}
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderSidebar() {
  const collapsed = state.ui.sidebarCollapsed;
  return `
    ${!collapsed ? `<div class="sidebar-mobile-backdrop" id="close-sidebar-mobile" aria-hidden="true"></div>` : ""}
    <aside class="app-sidebar ${collapsed ? "is-collapsed" : ""}" id="app-sidebar" aria-label="Main navigation">
      <nav class="sidebar-nav">
        ${navigationGroups.map((group) => `
          <div class="sidebar-group">
            <span class="sidebar-group-label">${group.label}</span>
            ${group.views.map(([view, label]) => `
              <button class="sidebar-nav-item ${state.view === view ? "is-active" : ""}" data-view="${view}" aria-current="${state.view === view ? "page" : "false"}">
                ${label}
              </button>
            `).join("")}
          </div>
        `).join("")}
      </nav>
    </aside>
  `;
}

function renderFilterStrip(events) {
  if (!state.data || !state.lookups) return "";
  const activeCount = getActiveScopeTags().length;
  const drawerOpen = state.ui.panels.filterDrawerOpen;
  return `
    <section class="filter-bar filter-bar-slim">
      <div class="filter-bar-inner">
        <button class="filters-toggle-btn ${drawerOpen ? "is-active" : ""}" id="toggle-filter-drawer" aria-expanded="${drawerOpen}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          Filters
          ${activeCount > 0 ? `<span class="filters-active-badge">${activeCount}</span>` : ""}
        </button>
        ${activeCount > 0 ? `<button class="action-button action-button-quiet filter-bar-reset" id="reset-filters">Reset</button>` : ""}
        <span class="filter-strip-spacer"></span>
        <span class="filter-count-badge">${events.length.toLocaleString()} events</span>
      </div>
    </section>
  `;
}

function renderFilterDrawer() {
  if (!state.data || !state.lookups) return "";
  const open = state.ui.panels.filterDrawerOpen;
  const scopedEvents = getBaseFilteredEvents();
  const referees = getAvailableReferees(scopedEvents);
  const teams = getAvailableTeams(scopedEvents);
  const players = getAvailablePlayers(scopedEvents);
  const seasons = getSeasonOptions();
  const seasonTypes = getSeasonTypeOptions();

  return `
    <div class="filter-drawer-backdrop ${open ? "is-open" : ""}" id="filter-drawer-backdrop" aria-hidden="true"></div>
    <aside class="filter-drawer ${open ? "is-open" : ""}" id="filter-drawer" aria-label="Filters panel">
      <div class="filter-drawer-header">
        <span class="filter-drawer-title">Filters</span>
        <button class="filter-drawer-close" id="close-filter-drawer" aria-label="Close filters">✕</button>
      </div>
      <div class="filter-drawer-body">
        <div class="filter-group">
          <label for="filter-season">Season</label>
          <select id="filter-season">
            <option value="all">All seasons</option>
            ${seasons.map((s) => `<option value="${s}" ${state.filters.season === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-season-type">Season type</label>
          <select id="filter-season-type">
            <option value="all">All types</option>
            ${seasonTypes.map((t) => `<option value="${t}" ${state.filters.seasonType === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-referee">Referee</label>
          <select id="filter-referee">
            <option value="all">All referees</option>
            ${optionMarkup(referees, "id", (r) => r.displayName, state.filters.refereeId)}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-team">Team</label>
          <select id="filter-team">
            <option value="all">All teams</option>
            ${optionMarkup(teams, "id", (t) => `${t.abbreviation} | ${t.name}`, state.filters.teamId)}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-game">Game</label>
          <select id="filter-game">
            <option value="all">All games</option>
            ${optionMarkup(state.data.games, "id", (g) => getGameLabel(g, state.lookups), state.filters.gameId)}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-period">Quarter</label>
          <select id="filter-period">
            <option value="all">All quarters</option>
            <option value="1" ${state.filters.period === "1" ? "selected" : ""}>Q1</option>
            <option value="2" ${state.filters.period === "2" ? "selected" : ""}>Q2</option>
            <option value="3" ${state.filters.period === "3" ? "selected" : ""}>Q3</option>
            <option value="4" ${state.filters.period === "4" ? "selected" : ""}>Q4</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-player">Player</label>
          <select id="filter-player">
            <option value="all">All players</option>
            ${optionMarkup(players, "id", (p) => p.displayName, state.filters.playerId)}
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-score-state">Score state</label>
          <select id="filter-score-state">
            <option value="all">All score states</option>
            <option value="clutch" ${state.filters.scoreState === "clutch" ? "selected" : ""}>Clutch</option>
            <option value="tie" ${state.filters.scoreState === "tie" ? "selected" : ""}>Tied</option>
            <option value="one-possession" ${state.filters.scoreState === "one-possession" ? "selected" : ""}>One possession</option>
            <option value="close" ${state.filters.scoreState === "close" ? "selected" : ""}>Close game</option>
            <option value="blowout" ${state.filters.scoreState === "blowout" ? "selected" : ""}>Blowout</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="filter-venue-context">Whistle side</label>
          <select id="filter-venue-context">
            <option value="all">All whistle sides</option>
            <option value="against_home" ${state.filters.venueContext === "against_home" ? "selected" : ""}>Against home</option>
            <option value="against_away" ${state.filters.venueContext === "against_away" ? "selected" : ""}>Against away</option>
            <option value="benefit_home" ${state.filters.venueContext === "benefit_home" ? "selected" : ""}>Benefit home</option>
            <option value="benefit_away" ${state.filters.venueContext === "benefit_away" ? "selected" : ""}>Benefit away</option>
          </select>
        </div>
      </div>
      <div class="filter-drawer-footer">
        <button class="action-button action-button-quiet" id="reset-filters" style="flex:1">Reset all</button>
        <button class="action-button action-button-accent" id="close-filter-drawer" style="flex:1">Done</button>
      </div>
    </aside>
  `;
}

function renderContextStrip(events) {
  if (!state.data || !state.lookups) return "";
  const meta = getCurrentViewMeta();
  const scopeTags = getActiveScopeTags();
  const presetsOpen = state.ui.panels.presetsOpen;
  const exportsOpen = state.ui.panels.exportsOpen;
  const coverage = getCoverageSummary(events, state.data, state.lookups);

  const presetsPanel = presetsOpen
    ? `
      <div class="filter-panel filter-panel-compact workspace-secondary-panel">
        <div class="filter-heading">
          <div>
            <p class="eyebrow">Reuse</p>
            <h3>Saved presets</h3>
          </div>
        </div>
        <div class="preset-row">
          <label class="inline-control grow-control">
            <span>Saved preset</span>
            <select id="saved-preset-select">
              <option value="">Select a saved preset</option>
              ${state.presets.items.map((preset) => `<option value="${preset.id}" ${state.presets.selectedId === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>`).join("")}
            </select>
          </label>
          <label class="inline-control grow-control">
            <span>Preset name</span>
            <input id="preset-name" type="text" placeholder="Save current filters as..." value="${escapeHtml(state.presets.draftName)}" />
          </label>
          <button class="action-button" id="apply-preset" ${state.presets.selectedId ? "" : "disabled"}>Apply</button>
          <button class="action-button" id="save-preset">Save</button>
          <button class="action-button" id="delete-preset" ${state.presets.selectedId ? "" : "disabled"}>Delete</button>
        </div>
      </div>
    `
    : "";

  const exportsPanel = exportsOpen
    ? `
      <div class="filter-panel filter-panel-compact workspace-secondary-panel">
        <div class="filter-heading">
          <div>
            <p class="eyebrow">Share</p>
            <h3>Exports and handoff</h3>
          </div>
        </div>
        <div class="control-cluster workspace-export-cluster">
          <button class="action-button" id="copy-share-link">Copy link</button>
          <button class="action-button" id="export-current-view">Export CSV</button>
          <button class="action-button" id="export-current-report">Export report</button>
          <button class="action-button" id="print-current-report">Print</button>
        </div>
      </div>
    `
    : "";

  return `
    <section class="context-strip">
      <div class="context-strip-inner">
        <div class="context-view-meta">
          <p class="eyebrow">${meta.eyebrow}</p>
          <h2 class="context-view-title">${meta.title}</h2>
          <p class="context-view-desc">${meta.description}</p>
        </div>
        <div class="context-scope-tags">
          <span class="tag is-neutral">${coverage.games} games</span>
          <span class="tag is-neutral">${coverage.referees} refs</span>
          <span class="tag is-neutral">${coverage.teams} teams</span>
          ${scopeTags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
          ${!scopeTags.length ? `<span class="context-no-scope">Broad scope — use filters to narrow</span>` : ""}
        </div>
        <div class="context-strip-actions">
          <button class="action-button action-button-quiet ${presetsOpen ? "action-button-accent" : ""}" id="toggle-presets-panel">Presets</button>
          <button class="action-button action-button-quiet ${exportsOpen ? "action-button-accent" : ""}" id="toggle-exports-panel">Export</button>
        </div>
      </div>
      ${presetsOpen || exportsOpen ? `<div class="context-panels">${presetsPanel}${exportsPanel}</div>` : ""}
    </section>
  `;
}

function renderTabs() {
  const activeGroup = getActiveNavigationGroup();
  const currentViewGroup = navigationGroups.find((group) => group.key === getNavigationGroupKey(state.view)) || navigationGroups[0];
  const currentViewEntry = currentViewGroup.views.find(([value]) => value === state.view) || currentViewGroup.views[0];
  const currentViewLabel = currentViewEntry?.[1] || "Overview";
  const dropdownViewEntry = activeGroup.views.find(([value]) => value === state.view);
  const dropdownViewLabel = dropdownViewEntry?.[1] || "Select view";

  return `
    <nav class="tab-row">
      <div class="tab-top-row">
        ${navigationGroups
          .map(
            (group) => `
              <button
                class="tab-group-trigger ${activeGroup.key === group.key ? "is-active" : ""}"
                data-view-group="${group.key}"
                aria-expanded="${state.ui.panels.navExpanded && activeGroup.key === group.key ? "true" : "false"}"
              >
                ${group.label}
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="tab-subnav-shell">
        <button class="tab-subnav-trigger" id="toggle-nav-dropdown" aria-expanded="${state.ui.panels.navExpanded ? "true" : "false"}">
          <span class="tab-subnav-label">${activeGroup.label}</span>
          <strong>${dropdownViewLabel}</strong>
        </button>
        ${
          state.ui.panels.navExpanded
            ? `
              <div class="tab-dropdown-menu">
                ${activeGroup.views
                  .map(
                    ([value, label]) => `
                      <button class="tab-dropdown-button ${state.view === value ? "is-active" : ""}" data-view="${value}">
                        <span>${label}</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </div>
      <div class="tab-current-context">
        <span class="tag is-neutral">${currentViewGroup.label}</span>
        <span class="panel-caption">Current view: ${currentViewLabel}</span>
      </div>
    </nav>
  `;
}

function getScopedGames(events) {
  const gameIds = [...new Set(events.map((event) => event.gameId))];
  return gameIds
    .map((gameId) => state.lookups.games[gameId])
    .filter(Boolean)
    .sort((a, b) => (b.gameDate || "").localeCompare(a.gameDate || "") || String(b.id).localeCompare(String(a.id)));
}

function getHomeSlateGames(events) {
  const scopedGames = getScopedGames(events);
  if (!scopedGames.length) {
    return { title: "No games in scope", caption: "Change the dashboard filters to surface a game slate.", games: [] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const todaysGames = scopedGames.filter((game) => game.gameDate === today);
  if (todaysGames.length) {
    return {
      title: "Tonight's games",
      caption: `${todaysGames.length} games match ${formatShortDate(today)} in the current scope.`,
      games: todaysGames.slice(0, 6),
    };
  }

  const latestDate = scopedGames[0].gameDate;
  const latestGames = scopedGames.filter((game) => game.gameDate === latestDate);
  return {
    title: "Latest loaded slate",
    caption: `${latestGames.length} games from ${formatShortDate(latestDate)} are available in the current scope.`,
    games: latestGames.slice(0, 6),
  };
}

function getHomeChallengeRefRows(events) {
  return getTopRows(
    events.filter((event) => event.challengeReviewed),
    (event) => event.refereeId,
    (refereeId) => state.lookups.referees[refereeId]?.displayName || refereeId,
    5,
  );
}

function getHomeBiasSignalRows(events) {
  return buildBiasRows(events, state.data, "team_against", state.lookups, state.filters)
    .sort((a, b) => Math.abs(b.standardizedSignal) - Math.abs(a.standardizedSignal) || b.possessions - a.possessions)
    .slice(0, 5);
}

function renderHomeSlateCard(events) {
  const slate = getHomeSlateGames(events);

  return `
    <article class="panel-card span-two">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Slate</p>
          <h3>${slate.title}</h3>
        </div>
        <p class="panel-caption">${slate.caption}</p>
      </div>
      ${
        slate.games.length
          ? `<div class="dashboard-game-grid">
              ${slate.games
                .map((game) => {
                  const homeTeam = state.lookups.teams[game.homeTeamId];
                  const awayTeam = state.lookups.teams[game.awayTeamId];
                  const gameEvents = events.filter((event) => event.gameId === game.id);
                  const reviewed = gameEvents.filter((event) => event.challengeReviewed).length;
                  return `
                    <article class="dashboard-game-card">
                      <div class="split-header">
                        <div>
                          <strong>${awayTeam?.abbreviation || "AWY"} @ ${homeTeam?.abbreviation || "HOME"}</strong>
                          <p class="cell-subtle">${formatShortDate(game.gameDate)}</p>
                        </div>
                        <span class="tag">${gameEvents.length} whistles</span>
                      </div>
                      <div class="dashboard-game-meta">
                        <span>${awayTeam?.abbreviation || "AWY"} ${game.awayScoreFinal}</span>
                        <span>${homeTeam?.abbreviation || "HOME"} ${game.homeScoreFinal}</span>
                        <span>${reviewed} reviewed</span>
                      </div>
                      <div class="control-cluster">
                        <button class="action-button" data-open-game="${game.id}">Open game</button>
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>`
          : `<p class="empty-state">No slate rows are available for this scope yet.</p>`
      }
    </article>
  `;
}

function renderHomeSignalCard(events) {
  const signalRows = getHomeBiasSignalRows(events);

  return `
    <article class="panel-card">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Signal Watch</p>
          <h3>Biggest active pairings</h3>
        </div>
      </div>
      ${
        signalRows.length
          ? `<div class="dashboard-list">
              ${signalRows
                .map(
                  (row) => `
                    <button class="dashboard-list-item" data-bias-mode="team_against" data-view="bias">
                      <div>
                        <strong>${row.refereeName}</strong>
                        <div class="cell-subtle">${row.entityLabel} | ${Math.round(row.possessions)} shared possessions</div>
                      </div>
                      <span class="${row.standardizedSignal >= 0 ? "positive-signal" : "negative-signal"}">${formatSignal(row.standardizedSignal)}</span>
                    </button>
                  `,
                )
                .join("")}
            </div>`
          : `<p class="empty-state">Need more shared possessions in scope to surface adjusted signal pairings.</p>`
      }
    </article>
  `;
}

function renderHomeQuickLaunch(events) {
  const challengeRows = getHomeChallengeRefRows(events);
  const alerts = getOperationalAlerts().slice(0, 2);

  return `
    <article class="panel-card">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Start Here</p>
          <h3>Quick launch</h3>
        </div>
      </div>
      <div class="dashboard-action-grid">
        <button class="action-button action-button-accent" data-view="games">Open Game Explorer</button>
        <button class="action-button" data-view="challenge">Open Challenges</button>
        <button class="action-button" data-view="bias">Open Bias Lab</button>
        <button class="action-button" data-view="compare">Open Compare</button>
      </div>
      <div class="workspace-subpanel">
        <div class="split-header">
          <strong>Most challenged refs</strong>
          <span class="panel-caption">${challengeRows.length ? "Jump into the refs drawing the most reviews." : "No reviewed whistles in this scope."}</span>
        </div>
        ${
          challengeRows.length
            ? `<div class="dashboard-list">
                ${challengeRows
                  .map(
                    (row) => `
                      <button class="dashboard-list-item" data-profile-referee="${row.key}">
                        <div>
                          <strong>${row.label}</strong>
                          <div class="cell-subtle">Reviewed whistles in scope</div>
                        </div>
                        <span class="tag">${row.count}</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>`
            : ""
        }
        ${
          alerts.length
            ? `<div class="dashboard-alert-stack">
                ${alerts.map((alert) => `<div class="tag ${alert.level === "critical" || alert.level === "warning" ? "is-warning" : "is-neutral"}">${escapeHtml(alert.message)}</div>`).join("")}
              </div>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderOverview(events) {
  const callTypeRows = getCallTypeBreakdown(events).map(([key, count]) => ({ label: humanizeCallType(key), count }));
  const quarterRows = getQuarterBreakdown(events).map(([label, count]) => ({ label, count }));
  const seasonRows = getSeasonRows(events, state.lookups);
  const seasonTypeRows = getSeasonSplitRows(events, state.lookups);
  const homeAwayRows = getHomeAwaySplitRows(events, state.lookups, "against");
  const monthlyTrendRows = getMonthlyTrendRows(events, state.lookups, "calls").slice(-6);
  const topAgainstTeams = getTopRows(
    events,
    (event) => event.penalizedTeamId,
    (teamId) => `${state.lookups.teams[teamId].abbreviation} fouled`,
  );
  const topBenefitedPlayers = getTopRows(
    events.filter((event) => event.benefitedPlayerId),
    (event) => event.benefitedPlayerId,
    (playerId) => state.lookups.players[playerId].displayName,
  );
  const topRefs = getRefereeSignalRows(events, state.lookups).slice(0, 5);
  const presetCards = state.presets.items.slice(0, 4);

  return `
    <section class="view-grid">
      <article class="panel-card span-two">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Home</p>
            <h3>Dashboard snapshot</h3>
          </div>
          <p class="panel-caption">${state.data.metadata.note} Source: ${state.data.metadata.sampleType}. Start from the current slate, biggest signals, or reviewed-whistle pressure points below.</p>
        </div>
        <div class="metrics-grid">
          ${renderMetricCards(getHeadlineMetrics(events))}
        </div>
      </article>

      ${renderHomeSlateCard(events)}

      ${renderHomeSignalCard(events)}

      ${renderHomeQuickLaunch(events)}

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Tempo</p>
            <h3>Quarter split</h3>
          </div>
        </div>
        ${renderBarList(quarterRows)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Call Mix</p>
            <h3>Foul type breakdown</h3>
          </div>
        </div>
        ${renderBarList(callTypeRows)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Season Split</p>
            <h3>Regular season vs playoffs</h3>
          </div>
        </div>
        ${renderBarList(seasonTypeRows)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Season Scope</p>
            <h3>Season-over-season volume</h3>
          </div>
        </div>
        ${renderBarList(seasonRows)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Venue Split</p>
            <h3>Whistles against home vs away</h3>
          </div>
        </div>
        ${renderBarList(homeAwayRows)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Pressure Points</p>
            <h3>Most penalized teams</h3>
          </div>
        </div>
        ${renderBarList(topAgainstTeams)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Beneficiaries</p>
            <h3>Players drawing whistles</h3>
          </div>
        </div>
        ${renderBarList(topBenefitedPlayers)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Trendline</p>
            <h3>Recent whistle volume by month</h3>
          </div>
        </div>
        ${renderBarList(monthlyTrendRows, "count", "No monthly trend rows in this scope.")}
      </article>

      <article class="panel-card span-two">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Ref Activity</p>
            <h3>Most active referees in scope</h3>
          </div>
        </div>
        ${renderBarList(topRefs)}
      </article>

      <article class="panel-card span-two">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Report Cards</p>
            <h3>Saved scopes you can reopen quickly</h3>
          </div>
        </div>
        ${
          presetCards.length
            ? `<div class="report-card-grid">
                ${presetCards
                  .map(
                    (preset) => `
                      <article class="report-card">
                        <div class="split-header">
                          <div>
                            <strong>${escapeHtml(preset.name)}</strong>
                            <p class="panel-caption">${escapeHtml(describePreset(preset))}</p>
                          </div>
                          <span class="tag">${getPresetEventCount(preset)} events</span>
                        </div>
                        <div class="control-cluster">
                          <button class="action-button" data-apply-preset-id="${preset.id}">Open</button>
                        </div>
                      </article>
                    `,
                  )
                  .join("")}
              </div>`
            : `<p class="empty-state">Save a preset from the control bar to create reusable report cards here.</p>`
        }
      </article>
    </section>
  `;
}

function renderCommandPalette() {
  if (!state.palette.open) return "";
  const actions = getPaletteActions();
  const selectedIndex = Math.min(state.palette.selectedIndex, Math.max(actions.length - 1, 0));

  return `
    <section class="command-palette-backdrop" id="command-palette-backdrop">
      <div class="command-palette">
        <div class="command-palette-header">
          <input id="command-palette-input" type="text" placeholder="Jump to a view, referee, team, player, or preset..." value="${escapeHtml(state.palette.query)}" autofocus />
          <span class="tag">Cmd/Ctrl + K</span>
        </div>
        <div class="command-palette-results">
          ${
            actions.length
              ? actions
                  .map(
                    (action, index) => `
                      <button class="command-palette-item ${index === selectedIndex ? "is-active" : ""}" data-palette-index="${index}">
                        <strong>${escapeHtml(action.label)}</strong>
                        <span>${escapeHtml(action.detail)}</span>
                      </button>
                    `,
                  )
                  .join("")
              : `<div class="empty-state">No matching commands.</div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderEvidenceDrawer() {
  if (!state.video.drawerOpen || !state.video.active) return "";
  const active = state.video.active;
  const bookmarked = state.video.bookmarks.some((item) => item.id === active.id);

  return `
    <section class="evidence-drawer-backdrop" id="evidence-drawer-backdrop">
      <aside class="evidence-drawer">
        <div class="split-header">
          <div>
            <p class="eyebrow">Evidence Review</p>
            <h3>${escapeHtml(active.title)}</h3>
            <p class="panel-caption">${escapeHtml(active.subtitle)} | Q${active.period || "?"} ${escapeHtml(active.clock || "")}</p>
          </div>
          <div class="control-cluster">
            <button class="action-button" id="evidence-bookmark-toggle">${bookmarked ? "Remove bookmark" : "Bookmark play"}</button>
            <button class="action-button" id="evidence-close">Close</button>
          </div>
        </div>

        <div class="view-grid">
          <article class="panel-card span-two evidence-player">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Primary Evidence</p>
                <h3>${escapeHtml(active.callLabel)}</h3>
              </div>
              <span class="tag">${escapeHtml(active.reviewSource)}</span>
            </div>
            ${
              active.primaryUrlEmbeddable
                ? `<video class="evidence-media" controls src="${active.primaryUrl}"></video>`
                : `<div class="evidence-placeholder">
                    <strong>Embedded playback is not available for this source.</strong>
                    <p class="panel-caption">This evidence source is best reviewed in the linked official page or video tab.</p>
                  </div>`
            }
            <div class="evidence-links evidence-links-prominent">
              ${active.videoUrl ? `<a href="${active.videoUrl}" target="_blank" rel="noreferrer">Open video</a>` : ""}
              ${active.reportUrl ? `<a href="${active.reportUrl}" target="_blank" rel="noreferrer">Open official report</a>` : ""}
              <button class="mini-link-button" id="evidence-add-queue">Add to queue</button>
            </div>
          </article>

          <article class="panel-card">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Context</p>
                <h3>Play details</h3>
              </div>
            </div>
            <div class="admin-stat-list">
              <div class="stat-pair"><span>Against</span><strong>${escapeHtml(active.against)}</strong></div>
              <div class="stat-pair"><span>Benefited</span><strong>${escapeHtml(active.benefited)}</strong></div>
              <div class="stat-pair"><span>Outcome</span><strong>${escapeHtml(active.outcome || "Not tagged")}</strong></div>
              <div class="stat-pair"><span>Description</span><strong>${escapeHtml(active.description || "No extra description")}</strong></div>
            </div>
          </article>

          <article class="panel-card">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Queue</p>
                <h3>Film review list</h3>
              </div>
            </div>
            ${
              state.video.queue.length
                ? `<div class="evidence-list">
                    ${state.video.queue
                      .map(
                        (item) => `
                          <div class="evidence-list-item ${item.id === active.id ? "is-active" : ""}">
                            <button class="mini-link-button" data-open-evidence="${item.eventId || ""}" data-open-evidence-challenge="${item.challengeId || ""}">${escapeHtml(item.title)}</button>
                            <button class="mini-link-button" data-remove-evidence-queue="${item.id}">Remove</button>
                          </div>
                        `,
                      )
                      .join("")}
                  </div>`
                : `<p class="empty-state">Add plays to the queue while you review evidence.</p>`
            }
          </article>

          <article class="panel-card">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Bookmarks</p>
                <h3>Saved evidence</h3>
              </div>
            </div>
            ${
              state.video.bookmarks.length
                ? `<div class="evidence-list">
                    ${state.video.bookmarks
                      .slice(0, 8)
                      .map(
                        (item) => `
                          <div class="evidence-list-item ${item.id === active.id ? "is-active" : ""}">
                            <button class="mini-link-button" data-open-evidence="${item.eventId || ""}" data-open-evidence-challenge="${item.challengeId || ""}">${escapeHtml(item.title)}</button>
                            <span class="cell-subtle">${escapeHtml(item.reviewSource)}</span>
                          </div>
                        `,
                      )
                      .join("")}
                  </div>`
                : `<p class="empty-state">Bookmarked evidence will appear here.</p>`
            }
          </article>
        </div>
      </aside>
    </section>
  `;
}

function renderCompareView() {
  const seasons = getSeasonOptions();
  const seasonTypes = getSeasonTypeOptions();
  const events = getBaseFilteredEvents();
  const options = getSubjectOptions(state.compare.subject, events);
  const leftMetrics = getComparisonMetrics(
    state.compare.subject,
    state.compare.left.id !== "all" ? state.compare.left.id : options[0]?.id,
    events,
    state.compare.left.season,
    state.compare.left.seasonType,
  );
  const rightMetrics = getComparisonMetrics(
    state.compare.subject,
    state.compare.right.id !== "all" ? state.compare.right.id : options[1]?.id || options[0]?.id,
    events,
    state.compare.right.season,
    state.compare.right.seasonType,
  );
  const leftAdjusted =
    state.compare.subject === "referee"
      ? leftMetrics.adjusted?.whistlesPer100 || 0
      : leftMetrics.adjusted?.againstPer100 || 0;
  const rightAdjusted =
    state.compare.subject === "referee"
      ? rightMetrics.adjusted?.whistlesPer100 || 0
      : rightMetrics.adjusted?.againstPer100 || 0;

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="split-header">
          <div>
            <p class="eyebrow">Compare Mode</p>
            <h3>Put two scopes side by side</h3>
          </div>
          <label class="inline-control">
            <span>Compare</span>
            <select id="compare-subject">
              <option value="referee" ${state.compare.subject === "referee" ? "selected" : ""}>Referees</option>
              <option value="team" ${state.compare.subject === "team" ? "selected" : ""}>Teams</option>
              <option value="player" ${state.compare.subject === "player" ? "selected" : ""}>Players</option>
            </select>
          </label>
        </div>
        <p class="panel-caption">Each side can be scoped to a different season and season type so you can do true season-over-season or peer comparisons.</p>
      </article>

      <section class="compare-grid">
        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Left Scope</p>
              <h3>${leftMetrics.label}</h3>
            </div>
          </div>
          <div class="filters-grid compare-filters">
            <label>
              <span>${state.compare.subject}</span>
              <select id="compare-left-id">
                ${options.map((option) => `<option value="${option.id}" ${(state.compare.left.id === option.id || (!state.compare.left.id || state.compare.left.id === "all") && option.id === options[0]?.id) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Season</span>
              <select id="compare-left-season">
                <option value="all">All seasons</option>
                ${seasons.map((season) => `<option value="${season}" ${state.compare.left.season === season ? "selected" : ""}>${season}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Season type</span>
              <select id="compare-left-season-type">
                <option value="all">All season types</option>
                ${seasonTypes.map((seasonType) => `<option value="${seasonType}" ${state.compare.left.seasonType === seasonType ? "selected" : ""}>${seasonType}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="metrics-grid single-column">
            ${renderMetricCards([
              { label: "Whistles", value: String(leftMetrics.events), note: "Total foul events in this comparison scope" },
              { label: "Reviewed", value: String(leftMetrics.reviewed), note: `${formatPercent(leftMetrics.overturnRate)} overturn rate` },
              { label: "Free throws", value: String(leftMetrics.freeThrows), note: `${leftMetrics.closeCalls} close-game calls` },
              { label: state.compare.subject === "referee" ? "Whistles / 100" : "Against / 100", value: formatDecimal(leftAdjusted), note: `${leftMetrics.lastTwoCalls} last-two-minute calls` },
            ])}
          </div>
          ${renderBarList(leftMetrics.topCalls, "count", "No call mix rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Right Scope</p>
              <h3>${rightMetrics.label}</h3>
            </div>
          </div>
          <div class="filters-grid compare-filters">
            <label>
              <span>${state.compare.subject}</span>
              <select id="compare-right-id">
                ${options.map((option) => `<option value="${option.id}" ${(state.compare.right.id === option.id || (!state.compare.right.id || state.compare.right.id === "all") && option.id === (options[1]?.id || options[0]?.id)) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Season</span>
              <select id="compare-right-season">
                <option value="all">All seasons</option>
                ${seasons.map((season) => `<option value="${season}" ${state.compare.right.season === season ? "selected" : ""}>${season}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Season type</span>
              <select id="compare-right-season-type">
                <option value="all">All season types</option>
                ${seasonTypes.map((seasonType) => `<option value="${seasonType}" ${state.compare.right.seasonType === seasonType ? "selected" : ""}>${seasonType}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="metrics-grid single-column">
            ${renderMetricCards([
              { label: "Whistles", value: String(rightMetrics.events), note: "Total foul events in this comparison scope" },
              { label: "Reviewed", value: String(rightMetrics.reviewed), note: `${formatPercent(rightMetrics.overturnRate)} overturn rate` },
              { label: "Free throws", value: String(rightMetrics.freeThrows), note: `${rightMetrics.closeCalls} close-game calls` },
              { label: state.compare.subject === "referee" ? "Whistles / 100" : "Against / 100", value: formatDecimal(rightAdjusted), note: `${rightMetrics.lastTwoCalls} last-two-minute calls` },
            ])}
          </div>
          ${renderBarList(rightMetrics.topCalls, "count", "No call mix rows in this scope.")}
        </article>
      </section>

      <article class="panel-card">
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                ${renderTableHeaderCell("Metric", "Key comparison metric for the two selected scopes.")}
                ${renderTableHeaderCell("Left", "Value for the left comparison scope.")}
                ${renderTableHeaderCell("Right", "Value for the right comparison scope.")}
                ${renderTableHeaderCell("Delta", "Left minus right. Positive means the left scope is higher.")}
              </tr>
            </thead>
            <tbody>
              ${[
                ["Whistles", leftMetrics.events, rightMetrics.events],
                ["Reviewed", leftMetrics.reviewed, rightMetrics.reviewed],
                ["Overturn rate", formatPercent(leftMetrics.overturnRate), formatPercent(rightMetrics.overturnRate), (leftMetrics.overturnRate - rightMetrics.overturnRate) * 100],
                ["Free throws", leftMetrics.freeThrows, rightMetrics.freeThrows],
                ["Close-game calls", leftMetrics.closeCalls, rightMetrics.closeCalls],
                ["Last-two-minute calls", leftMetrics.lastTwoCalls, rightMetrics.lastTwoCalls],
                [state.compare.subject === "referee" ? "Whistles / 100" : "Against / 100", formatDecimal(leftAdjusted), formatDecimal(rightAdjusted), leftAdjusted - rightAdjusted],
              ]
                .map(([label, leftValue, rightValue, delta]) => `
                  <tr>
                    ${renderTableCell("Metric", label)}
                    ${renderTableCell("Left", leftValue)}
                    ${renderTableCell("Right", rightValue)}
                    ${renderTableCell("Delta", delta == null ? Number(leftValue) - Number(rightValue) : formatSignal(delta))}
                  </tr>
                `)
                .join("")}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderGameExplorer(events) {
  const fallbackGame = state.data.games.find((candidate) => events.some((event) => event.gameId === candidate.id)) || state.data.games[0];
  const selectedGameId = state.filters.gameId !== "all" ? state.filters.gameId : fallbackGame?.id;
  const game = selectedGameId ? state.lookups.games[selectedGameId] : null;
  const gameEvents = selectedGameId
    ? events.filter((event) => event.gameId === selectedGameId).sort((a, b) => a.gameClockSecondsElapsed - b.gameClockSecondsElapsed)
    : [];

  const officials = selectedGameId
    ? state.data.gameOfficials
        .filter((official) => official.gameId === selectedGameId)
        .map((official) => `${state.lookups.referees[official.refereeId].displayName} (${official.assignmentRole.replaceAll("_", " ")})`)
    : [];

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Game Explorer</p>
            <h3>${game ? getGameLabel(game, state.lookups) : "No game available in this scope"}</h3>
          </div>
          <div class="tag-row">
            <span class="tag">${gameEvents.length} whistles</span>
            ${game ? `<span class="tag">${state.lookups.teams[game.awayTeamId].abbreviation} ${game.awayScoreFinal} - ${game.homeScoreFinal} ${state.lookups.teams[game.homeTeamId].abbreviation}</span>` : ""}
          </div>
        </div>
        <p class="panel-caption">${officials.length ? `Crew: ${officials.join(" | ")}` : "No officiating crew available for this scope."}</p>
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Timeline</p>
            <h3>Call-by-call breakdown</h3>
          </div>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                ${renderTableHeaderCell("Quarter", "The period when the whistle happened, shown as Q1 through Q4 or later overtime frames.")}
                ${renderTableHeaderCell("Clock", "The game clock at the moment of the whistle within that quarter.")}
                ${renderTableHeaderCell("Referee", "The official credited with making the foul call in the play-by-play feed.")}
                ${renderTableHeaderCell("Call", "The foul family and subtype attached to the whistle, such as personal, shooting, or technical.")}
                ${renderTableHeaderCell("Against", "The player or team assessed with the foul.")}
                ${renderTableHeaderCell("Benefited", "The player or team that gained possession, free throws, or the favorable outcome from the whistle.")}
                ${renderTableHeaderCell("Score", "The scoreboard at whistle time, shown as away score and home score for game context.")}
                ${renderTableHeaderCell("State", "Late-game and review tags for the whistle, including score-state, challenge, overturn, and L2M overlays.")}
                ${renderTableHeaderCell("Evidence", "Links to official video or report evidence when the app has them, including L2M video and official report pages.")}
              </tr>
            </thead>
            <tbody>
              ${
                game && gameEvents.length
                  ? gameEvents
                      .map((event) => {
                        const penalizedPlayer = state.lookups.players[event.penalizedPlayerId];
                        const benefitedPlayer = event.benefitedPlayerId ? state.lookups.players[event.benefitedPlayerId] : null;
                        const home = state.lookups.teams[game.homeTeamId];
                        const away = state.lookups.teams[game.awayTeamId];
                        return `
                          <tr>
                            ${renderTableCell("Quarter", `Q${event.period}`)}
                            ${renderTableCell("Clock", event.periodClock)}
                            ${renderTableCell("Referee", state.lookups.referees[event.refereeId]?.displayName || "Unknown")}
                            ${renderTableCell("Call", `
                              <strong>${humanizeCallType(event.foulType)}</strong>
                              <div class="cell-subtle">${event.foulSubtype}</div>
                            `)}
                            ${renderTableCell("Against", `
                              <strong>${penalizedPlayer?.displayName || state.lookups.teams[event.penalizedTeamId]?.abbreviation || "Unknown"}</strong>
                              <div class="cell-subtle">${state.lookups.teams[event.penalizedTeamId]?.abbreviation || ""}</div>
                            `)}
                            ${renderTableCell("Benefited", `
                              <strong>${benefitedPlayer?.displayName || state.lookups.teams[event.benefitedTeamId]?.abbreviation || "Unknown"}</strong>
                              <div class="cell-subtle">${state.lookups.teams[event.benefitedTeamId]?.abbreviation || ""}</div>
                            `)}
                            ${renderTableCell("Score", `${away.abbreviation} ${event.awayScoreAtWhistle} - ${event.homeScoreAtWhistle} ${home.abbreviation}`)}
                            ${renderTableCell("State", `
                              <span class="tag">${getScoreState(event, state.lookups)}</span>
                              ${event.challengeReviewed ? `<span class="tag">${event.challengeOutcome || "challenge"}</span>` : ""}
                              ${event.challengeOverturned ? `<span class="tag is-warning">overturned</span>` : ""}
                              ${event.l2mDecision ? `<span class="tag">${event.l2mDecision}</span>` : ""}
                            `)}
                            ${renderTableCell("Evidence", renderEvidenceLinks(event))}
                          </tr>
                        `;
                      })
                      .join("")
                  : `<tr><td colspan="9" class="empty-cell">No calls match the selected scope for this game.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderRefereeLens(events) {
  const availableRefs = getAvailableReferees(events);
  const selectedRefId =
    state.focus.refereeId !== "all" && availableRefs.some((referee) => referee.id === state.focus.refereeId)
      ? state.focus.refereeId
      : (availableRefs[0]?.id || "all");
  const refEvents = selectedRefId === "all" ? [] : events.filter((event) => event.refereeId === selectedRefId);
  const referee = selectedRefId === "all" ? null : state.lookups.referees[selectedRefId];

  const againstPlayers = getTopRows(
    refEvents.filter((event) => event.penalizedPlayerId),
    (event) => event.penalizedPlayerId,
    (playerId) => state.lookups.players[playerId].displayName,
  );
  const benefitedTeams = getTopRows(
    refEvents,
    (event) => event.benefitedTeamId,
    (teamId) => state.lookups.teams[teamId].abbreviation,
  );
  const quarterRows = getQuarterBreakdown(refEvents).map(([label, count]) => ({ label, count }));
  const seasonRows = getSeasonSplitRows(refEvents, state.lookups);
  const againstVenueRows = getHomeAwaySplitRows(refEvents, state.lookups, "against");
  const benefitVenueRows = getHomeAwaySplitRows(refEvents, state.lookups, "benefit");
  const adjustedMetrics = getAdjustedRefereeMetrics(events, state.data, state.lookups, state.filters, selectedRefId);
  const reviewedEvents = refEvents.filter((event) => event.challengeReviewed);
  const upheldLikelyCount = reviewedEvents.filter((event) => String(event.challengeOutcome || "").startsWith("upheld")).length;
  const overturnedLikelyCount = reviewedEvents.filter(
    (event) => event.challengeOverturned || String(event.challengeOutcome || "").startsWith("overturned"),
  ).length;
  const unknownChallengeCount = reviewedEvents.length - upheldLikelyCount - overturnedLikelyCount;
  const overturnRate = reviewedEvents.length ? overturnedLikelyCount / reviewedEvents.length : 0;
  const recentChallengeRows = reviewedEvents
    .slice()
    .sort((a, b) => {
      const gameDateCompare = (state.lookups.games[b.gameId]?.gameDate || "").localeCompare(state.lookups.games[a.gameId]?.gameDate || "");
      if (gameDateCompare !== 0) return gameDateCompare;
      return b.gameClockSecondsElapsed - a.gameClockSecondsElapsed;
    })
    .slice(0, 10);

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="split-header">
          <div>
            <p class="eyebrow">Referee Lens</p>
            <h3>${referee ? referee.displayName : "No referee available"}</h3>
          </div>
          <div class="control-cluster">
            <label class="inline-control">
              <span>Focus referee</span>
              <select id="ref-focus">
                ${availableRefs.length ? `<option value="all">Select a referee</option>${optionMarkup(availableRefs, "id", (item) => item.displayName, selectedRefId)}` : `<option value="all">No referees in scope</option>`}
              </select>
            </label>
            <button class="action-button" id="open-ref-profile" ${referee ? "" : "disabled"}>Open full profile</button>
          </div>
        </div>
      </article>

      ${renderRawPlayByPlayNotice()}

      ${
        referee
          ? `
            <section class="view-grid">
              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Workload</p>
                    <h3>Call volume</h3>
                  </div>
                </div>
                <div class="metrics-grid single-column">
                  ${renderMetricCards([
                    { label: "Whistles made", value: String(refEvents.length), note: "Calls in current scope" },
                    { label: "Whistles / 100 poss", value: formatDecimal(adjustedMetrics?.whistlesPer100 || 0), note: `${Math.round(adjustedMetrics?.possessions || 0)} scoped team possessions` },
                    { label: "Free throws / 100 poss", value: formatDecimal(adjustedMetrics?.freeThrowsPer100 || 0), note: "Possession-adjusted whistle impact" },
                    { label: "Free throws awarded", value: String(sumBy(refEvents, (event) => event.freeThrowsAwarded)), note: "Trips created by this whistle set" },
                    { label: "Reviewed", value: String(refEvents.filter((event) => event.challengeReviewed).length), note: `${refEvents.filter((event) => event.challengeOverturned).length} inferred overturned` },
                  ])}
                </div>
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Timing</p>
                    <h3>Quarter distribution</h3>
                  </div>
                </div>
                ${renderBarList(quarterRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Season Split</p>
                    <h3>Regular season vs playoffs</h3>
                  </div>
                </div>
                ${renderBarList(seasonRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Venue Split</p>
                    <h3>Against home vs away</h3>
                  </div>
                </div>
                ${renderBarList(againstVenueRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Benefit Split</p>
                    <h3>Benefiting home vs away</h3>
                  </div>
                </div>
                ${renderBarList(benefitVenueRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Against</p>
                    <h3>Most penalized players</h3>
                  </div>
                </div>
                ${renderBarList(againstPlayers)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Challenge Reviews</p>
                    <h3>Whistles reviewed against this referee</h3>
                  </div>
                </div>
                <div class="metrics-grid single-column">
                  ${renderMetricCards([
                    { label: "Reviewed whistles", value: String(reviewedEvents.length), note: "Calls by this referee that were challenged in scope" },
                    { label: "Upheld likely", value: String(upheldLikelyCount), note: "Review appears to have left the call in place" },
                    { label: "Overturned likely", value: String(overturnedLikelyCount), note: "Review appears to have reversed the original ruling" },
                    { label: "Unknown", value: String(Math.max(0, unknownChallengeCount)), note: "Challenge was detected, but the outcome remains ambiguous" },
                    { label: "Overturn rate", value: formatPercent(overturnRate), note: "Overturned likely divided by reviewed whistles" },
                  ])}
                </div>
              </article>

              <article class="panel-card span-two">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Benefit</p>
                    <h3>Teams helped most often</h3>
                  </div>
                </div>
                ${renderBarList(benefitedTeams)}
              </article>

              <article class="panel-card span-two">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Challenge Log</p>
                    <h3>Most recent reviewed whistles</h3>
                  </div>
                </div>
                <div class="table-shell">
                  <table>
                    <thead>
                      <tr>
                        ${renderTableHeaderCell("Game", "The game where the challenged whistle occurred.")}
                        ${renderTableHeaderCell("Quarter", "The period of the challenged whistle.")}
                        ${renderTableHeaderCell("Clock", "The game clock when the challenged whistle was recorded.")}
                        ${renderTableHeaderCell("Call", "The foul type that was challenged.")}
                        ${renderTableHeaderCell("Against", "The player or team originally whistled for the foul.")}
                        ${renderTableHeaderCell("Benefited", "The player or team that benefited from the original whistle.")}
                        ${renderTableHeaderCell("Outcome", "The inferred review result. Upheld likely means the original ruling appears to have stood. Overturned likely means it appears to have been reversed. Unknown means the feed was too ambiguous to classify confidently.")}
                        ${renderTableHeaderCell("Source", "Whether the challenge result came from an explicit official signal or from the app's inference model. Most current rows are inferred from play-by-play sequence behavior.")}
                        ${renderTableHeaderCell("Confidence", "How confident the app is in the inferred challenge result, based on linked play-by-play context.")}
                        ${renderTableHeaderCell("Reason", "The main sequence pattern that led the model to infer this challenge result.")}
                        ${renderTableHeaderCell("Evidence", "Official video or report links tied to this challenged whistle when available.")}
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        recentChallengeRows.length
                          ? recentChallengeRows
                              .map((event) => {
                                const game = state.lookups.games[event.gameId];
                                const penalizedPlayer = state.lookups.players[event.penalizedPlayerId];
                                const benefitedPlayer = event.benefitedPlayerId ? state.lookups.players[event.benefitedPlayerId] : null;
                                return `
                                  <tr>
                                    ${renderTableCell("Game", game ? getGameLabel(game, state.lookups) : event.gameId)}
                                    ${renderTableCell("Quarter", `Q${event.period}`)}
                                    ${renderTableCell("Clock", event.periodClock)}
                                    ${renderTableCell("Call", `
                                      <strong>${humanizeCallType(event.foulType)}</strong>
                                      <div class="cell-subtle">${event.foulSubtype}</div>
                                    `)}
                                    ${renderTableCell("Against", penalizedPlayer?.displayName || state.lookups.teams[event.penalizedTeamId]?.abbreviation || "Unknown")}
                                    ${renderTableCell("Benefited", benefitedPlayer?.displayName || state.lookups.teams[event.benefitedTeamId]?.abbreviation || "Unknown")}
                                    ${renderTableCell("Outcome", `<span class="${getChallengeOutcomeTagClass(event.challengeOutcome)}">${formatChallengeOutcome(event.challengeOutcome)}</span>`)}
                                    ${renderTableCell("Source", formatChallengeSource(event.challengeOutcomeSource))}
                                    ${renderTableCell("Confidence", event.challengeInferenceConfidence != null ? formatPercent(event.challengeInferenceConfidence) : "Unknown")}
                                    ${renderTableCell("Reason", formatChallengeReason(event.challengeInferenceReason))}
                                    ${renderTableCell("Evidence", renderEvidenceLinks(event))}
                                  </tr>
                                `;
                              })
                              .join("")
                          : `<tr><td colspan="11" class="empty-cell">No reviewed whistles for this referee in the current scope.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          `
          : `<article class="panel-card"><p class="empty-state">No referee data available for this scope.</p></article>`
      }
    </section>
  `;
}

function renderEntities(events) {
  const mode = state.focus.entityMode;
  const availableEntities = mode === "player" ? getAvailablePlayers(events) : getAvailableTeams(events);
  const entityId =
    state.focus.entityId !== "all" && availableEntities.some((entity) => entity.id === state.focus.entityId)
      ? state.focus.entityId
      : (availableEntities[0]?.id || "all");

  const entityEvents =
    entityId === "all"
      ? []
      : events.filter((event) =>
          mode === "player"
            ? event.penalizedPlayerId === entityId || event.benefitedPlayerId === entityId
            : event.penalizedTeamId === entityId || event.benefitedTeamId === entityId,
        );

  const selectedTeam = mode === "team" && entityId !== "all" ? state.lookups.teams[entityId] : null;
  const title =
    entityId === "all"
      ? "No entity available"
      : mode === "player"
        ? state.lookups.players[entityId].displayName
        : `${selectedTeam.city} ${selectedTeam.name}`;

  const refsAgainst = getTopRows(
    entityEvents.filter((event) => (mode === "player" ? event.penalizedPlayerId === entityId : event.penalizedTeamId === entityId)),
    (event) => event.refereeId,
    (refereeId) => state.lookups.referees[refereeId].displayName,
  );

  const refsBenefiting = getTopRows(
    entityEvents.filter((event) => (mode === "player" ? event.benefitedPlayerId === entityId : event.benefitedTeamId === entityId)),
    (event) => event.refereeId,
    (refereeId) => state.lookups.referees[refereeId].displayName,
  );

  const quarterRows = getQuarterBreakdown(entityEvents).map(([label, count]) => ({ label, count }));
  const seasonRows = getSeasonSplitRows(entityEvents, state.lookups);
  const adjustedMetrics = getAdjustedEntityMetrics(events, state.data, state.lookups, state.filters, mode, entityId);
  const opponentContext = getOpponentContextRows(events, state.lookups, mode, entityId);
  const selectedPlayer = mode === "player" && entityId !== "all" ? state.lookups.players[entityId] : null;

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="split-header">
          <div>
            <p class="eyebrow">Entity Lens</p>
            ${
              mode === "team" && selectedTeam
                ? renderTeamIdentity(selectedTeam)
                : mode === "player" && selectedPlayer
                  ? renderPlayerIdentity(selectedPlayer)
                  : `<h3>${title}</h3>`
            }
          </div>
          <div class="control-cluster">
            <label class="inline-control">
              <span>Mode</span>
              <select id="entity-mode">
                <option value="player" ${mode === "player" ? "selected" : ""}>Player</option>
                <option value="team" ${mode === "team" ? "selected" : ""}>Team</option>
              </select>
            </label>
            <label class="inline-control">
              <span>Focus</span>
              <select id="entity-focus">
                ${availableEntities.length ? `<option value="all">Select one</option>${optionMarkup(availableEntities, "id", (item) => mode === "player" ? item.displayName : `${item.abbreviation} | ${item.name}`, entityId)}` : `<option value="all">No entities in scope</option>`}
              </select>
            </label>
          </div>
        </div>
      </article>

      ${renderRawPlayByPlayNotice()}

      ${
        entityId !== "all"
          ? `
            <section class="view-grid">
              <article class="panel-card span-two">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Adjusted Exposure</p>
                    <h3>Whistles relative to team possessions</h3>
                  </div>
                </div>
                <div class="metrics-grid">
                  ${renderMetricCards([
                    { label: "Team possessions", value: String(Math.round(adjustedMetrics?.possessions || 0)), note: "Scoped possession exposure for this entity's team" },
                    { label: "Against / 100 poss", value: formatDecimal(adjustedMetrics?.againstPer100 || 0), note: "Calls against this entity per 100 team possessions" },
                    { label: "Benefit / 100 poss", value: formatDecimal(adjustedMetrics?.benefitPer100 || 0), note: "Calls benefiting this entity per 100 team possessions" },
                  ])}
                </div>
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Pressure</p>
                    <h3>Referees calling against ${mode === "player" ? "this player" : "this team"}</h3>
                  </div>
                </div>
                ${renderBarList(refsAgainst)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Benefit</p>
                    <h3>Referees benefiting ${mode === "player" ? "this player" : "this team"}</h3>
                  </div>
                </div>
                ${renderBarList(refsBenefiting)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Timing</p>
                    <h3>Quarter-by-quarter exposure</h3>
                  </div>
                </div>
                ${renderBarList(quarterRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Season Split</p>
                    <h3>Regular season vs playoffs</h3>
                  </div>
                </div>
                ${renderBarList(seasonRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Opponents</p>
                    <h3>Most whistles against vs opponent</h3>
                  </div>
                </div>
                ${renderBarList(opponentContext.againstOpponents, "count", "No opponent rows in this scope.")}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Opponents</p>
                    <h3>Most whistles benefiting vs opponent</h3>
                  </div>
                </div>
                ${renderBarList(opponentContext.benefitOpponents, "count", "No benefit-by-opponent rows in this scope.")}
              </article>

              <article class="panel-card span-two">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Matchup Context</p>
                    <h3>Home/away whistle side by opponent</h3>
                  </div>
                </div>
                ${renderBarList(opponentContext.venueOpponentRows, "count", "No matchup-context rows in this scope.")}
              </article>
            </section>
          `
          : `<article class="panel-card"><p class="empty-state">Choose a player or team to inspect ref-specific splits.</p></article>`
      }
    </section>
  `;
}

function renderBiasLab(events) {
  const analytics = state.analytics.bias.data;
  const loading = state.analytics.bias.loading;
  const error = state.analytics.bias.error;
  const rows = analytics?.rows || [];
  const explainability =
    analytics?.explainability ||
    getBiasExplainability([]);
  const scopedPossessionEstimate = rows.reduce((total, row) => total + row.possessions, 0);
  const topSignal = rows[0] || null;
  const highConfidenceRows = explainability.confidenceCounts.high || 0;
  const sampleWarningText = explainability.sampleWarnings[0] || "Exposure and signal strength are healthy for the current rows.";

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="split-header">
          <div>
            <p class="eyebrow">Bias Lab</p>
            <h3>Possession-adjusted whistle signals</h3>
          </div>
          <label class="inline-control">
            <span>View</span>
            <select id="bias-mode">
              <option value="team_against" ${state.focus.biasMode === "team_against" ? "selected" : ""}>Teams penalized</option>
              <option value="team_benefited" ${state.focus.biasMode === "team_benefited" ? "selected" : ""}>Teams benefited</option>
              <option value="player_against" ${state.focus.biasMode === "player_against" ? "selected" : ""}>Players penalized</option>
              <option value="player_benefited" ${state.focus.biasMode === "player_benefited" ? "selected" : ""}>Players benefited</option>
            </select>
          </label>
        </div>
        <p class="panel-caption">
          This model adjusts for scoped team possession exposure before comparing actual whistles to an expected baseline. It is now computed server-side for the current scope, but it is still directional, not proof of intent or bias.
        </p>
      </article>
      ${loading && !analytics ? `<article class="loading-card compact-loading">Loading bias rows for this scope…</article>` : ""}
      ${loading && analytics ? `<article class="status-banner status-banner-info">Updating results for the current filters…</article>` : ""}
      ${error ? `<article class="status-banner status-banner-bad"><strong>Bias analytics could not be refreshed.</strong><div>${error}</div></article>` : ""}

      <article class="panel-card">
        <div class="metrics-grid">
          ${renderMetricCards([
            { label: "Signal rows", value: String(rows.length), note: "Ref and entity pairs with enough exposure to evaluate" },
            { label: "Shared possessions", value: String(Math.round(scopedPossessionEstimate)), note: "Sum of evaluated ref/entity team-possession exposure" },
            { label: "Top z-signal", value: formatDecimal(topSignal?.standardizedSignal || 0), note: topSignal ? `${topSignal.refereeName} vs ${topSignal.entityLabel}` : "No evaluated pair yet" },
            { label: "High-confidence rows", value: String(highConfidenceRows), note: sampleWarningText },
          ])}
        </div>
      </article>

      <section class="view-grid">
        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Methodology</p>
              <h3>How the signal works</h3>
            </div>
          </div>
          <div class="admin-stat-list">
            <div class="stat-pair"><span>Actual rate</span><strong>Observed whistles per 100 shared possessions</strong></div>
            <div class="stat-pair"><span>Baseline rate</span><strong>Ref rate x entity rate, normalized by the scoped global whistle rate</strong></div>
            <div class="stat-pair"><span>Delta / 100</span><strong>Actual rate minus the adjusted baseline rate</strong></div>
            <div class="stat-pair"><span>Z-signal</span><strong>How large the count gap is relative to expected variance</strong></div>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Confidence</p>
              <h3>How rows are graded</h3>
            </div>
          </div>
          <div class="tag-row">
            <span class="${getConfidenceTagClass("high")}">${highConfidenceRows} high confidence</span>
            <span class="${getConfidenceTagClass("medium")}">${explainability.confidenceCounts.medium || 0} medium confidence</span>
            <span class="${getConfidenceTagClass("low")}">${explainability.confidenceCounts.low || 0} low confidence</span>
          </div>
          <div class="admin-stat-list">
            <div class="stat-pair"><span>High confidence</span><strong>About ${explainability.thresholds.highPossessions}+ shared possessions, 3+ games, and |z| >= ${formatDecimal(explainability.thresholds.highZ)}</strong></div>
            <div class="stat-pair"><span>Medium confidence</span><strong>About ${explainability.thresholds.mediumPossessions}+ possessions, 2+ games, and |z| >= ${formatDecimal(explainability.thresholds.mediumZ)}</strong></div>
            <div class="stat-pair"><span>Low confidence</span><strong>Anything thinner than that. Useful for leads, not conclusions.</strong></div>
          </div>
        </article>
      </section>

      ${
        explainability.sampleWarnings.length
          ? `
            <article class="panel-card">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Scope Warnings</p>
                  <h3>Sample-size cautions</h3>
                </div>
              </div>
              <div class="stack-section compact-stack">
                ${explainability.sampleWarnings
                  .map((warning) => `<p class="status-banner status-banner-warning compact-banner">${warning}</p>`)
                  .join("")}
              </div>
            </article>
          `
          : ""
      }

      <article class="panel-card">
        <div class="table-shell vs-table-shell" data-vs-id="bias-rows">
          <table>
            <thead>
              <tr>
                ${renderTableHeaderCell("Referee", "The official in the evaluated referee and team or player pair.")}
                ${renderTableHeaderCell("Entity", "The team or player being measured against this referee in the selected bias view.")}
                ${renderTableHeaderCell("Confidence", "A quality grade based on shared possessions, game count, and signal size. High confidence means stronger evidence, not certainty.")}
                ${renderTableHeaderCell("Poss", "Shared possessions between this referee and entity inside the current filter scope. Larger samples are more trustworthy.")}
                ${renderTableHeaderCell("Actual", "The raw whistle count actually observed for this referee and entity pairing in the current scope.")}
                ${renderTableHeaderCell("Expected", "The adjusted whistle count predicted from referee tendency, entity exposure, and the scoped baseline rate.")}
                ${renderTableHeaderCell("Rate / 100", "The actual whistle rate per 100 shared possessions for this referee and entity pair.")}
                ${renderTableHeaderCell("Base / 100", "The adjusted baseline whistle rate per 100 shared possessions that this pairing would be expected to produce.")}
                ${renderTableHeaderCell("Delta / 100", "Actual rate minus baseline rate per 100 possessions. Positive means more whistles than expected. Negative means fewer than expected.")}
                ${renderTableHeaderCell("Z-Signal", "How far the observed whistle count sits from the adjusted expectation after accounting for variance. Larger positive values mean more whistles than expected, larger negative values mean fewer, and values near zero mean the pairing is close to baseline. Higher or lower is not inherently good or bad on its own; it depends on whether this view represents being penalized or benefited.")}
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? renderVsRows("bias-rows", rows, (row) => `
                      <tr>
                        ${renderTableCell("Referee", `
                          <strong>${row.refereeName}</strong>
                          <button class="mini-link-button" data-profile-referee="${row.refereeId}">Open profile</button>
                        `)}
                        ${renderTableCell("Entity", row.entityLabel)}
                        ${renderTableCell("Confidence", `<span class="${getConfidenceTagClass(row.confidence.level)}">${row.confidence.label.replace(" confidence", "")}</span>`)}
                        ${renderTableCell("Poss", Math.round(row.possessions))}
                        ${renderTableCell("Actual", row.actual)}
                        ${renderTableCell("Expected", formatDecimal(row.expected))}
                        ${renderTableCell("Rate / 100", formatDecimal(row.ratePer100))}
                        ${renderTableCell("Base / 100", formatDecimal(row.baselineRatePer100))}
                        ${renderTableCell("Delta / 100", formatSignal(row.rateDiffPer100), row.rateDiffPer100 >= 0 ? "positive-signal" : "negative-signal")}
                        ${renderTableCell("Z-Signal", formatSignal(row.standardizedSignal), row.standardizedSignal >= 0 ? "positive-signal" : "negative-signal")}
                      </tr>
                    `)
                  : `<tr><td colspan="10" class="empty-cell">Not enough shared possessions in scope to compute adjusted signal rows.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderChallengeAnalytics(events) {
  const challengeRows = buildChallengeRows(events);
  const reviewedCount = challengeRows.length;
  const upheldCount = challengeRows.filter((row) => String(row.challengeEvent.challengeOutcome || "").startsWith("upheld")).length;
  const overturnedCount = challengeRows.filter(
    (row) => row.challengeEvent.challengeOverturned || String(row.challengeEvent.challengeOutcome || "").startsWith("overturned"),
  ).length;
  const unknownCount = Math.max(0, reviewedCount - upheldCount - overturnedCount);
  const confidenceRows = challengeRows.filter((row) => row.challengeEvent.inferenceConfidence != null);
  const averageConfidence =
    confidenceRows.length
      ? confidenceRows.reduce((total, row) => total + Number(row.challengeEvent.inferenceConfidence || 0), 0) / confidenceRows.length
      : 0;
  const overturnRate = reviewedCount ? overturnedCount / reviewedCount : 0;

  const canUseSummary = canUseChallengeSummaryTables();
  const topRefRows = canUseSummary
    ? getChallengeSummaryRefRows()
        .slice(0, 6)
        .map((row) => ({
          label: state.lookups.referees[row.refereeId]?.displayName || row.refereeId,
          count: row.reviewedCalls,
        }))
    : getTopRows(
        challengeRows.filter((row) => row.challengeEvent.linkedRefereeId),
        (row) => row.challengeEvent.linkedRefereeId,
        (refereeId) => state.lookups.referees[refereeId]?.displayName || refereeId,
        6,
      );

  const refOverturnRows = canUseSummary
    ? getChallengeSummaryRefRows()
        .filter((row) => row.reviewedCalls >= 2)
        .sort((a, b) => b.overturnRate - a.overturnRate || b.reviewedCalls - a.reviewedCalls)
        .slice(0, 6)
        .map((row) => ({
          label: state.lookups.referees[row.refereeId]?.displayName || row.refereeId,
          count: Number((row.overturnRate * 100).toFixed(0)),
        }))
    : [...new Map(
        challengeRows
          .filter((row) => row.challengeEvent.linkedRefereeId)
          .map((row) => [row.challengeEvent.linkedRefereeId, null]),
      ).keys()]
        .map((refereeId) => {
          const rows = challengeRows.filter((row) => row.challengeEvent.linkedRefereeId === refereeId);
          const overturned = rows.filter(
            (row) => row.challengeEvent.challengeOverturned || String(row.challengeEvent.challengeOutcome || "").startsWith("overturned"),
          ).length;
          return {
            label: state.lookups.referees[refereeId]?.displayName || refereeId,
            count: rows.length ? Math.round((overturned / rows.length) * 100) : 0,
            sample: rows.length,
          };
        })
        .filter((row) => row.sample >= 2)
        .sort((a, b) => b.count - a.count || b.sample - a.sample)
        .slice(0, 6);

  const challengeTeamRows = canUseSummary
    ? getChallengeSummaryTeamRows()
        .slice(0, 6)
        .map((row) => ({
          label: state.lookups.teams[row.teamId]?.abbreviation || row.teamId,
          count: row.challenges,
        }))
    : getTopRows(
        challengeRows.filter((row) => row.challengeEvent.teamId),
        (row) => row.challengeEvent.teamId,
        (teamId) => state.lookups.teams[teamId]?.abbreviation || teamId,
        6,
      );

  const outcomeMixRows = canUseSummary
    ? getChallengeSummaryOutcomeRows("all").map((row) => ({
        label: formatChallengeOutcome(row.outcomeBucket),
        count: row.count,
      }))
    : [
        { label: "Upheld likely", count: upheldCount },
        { label: "Overturned likely", count: overturnedCount },
        { label: "Unknown", count: unknownCount },
      ];

  const seasonChallengeRows = canUseSummary
    ? (state.filters.seasonType !== "all" ? [state.filters.seasonType] : ["Regular Season", "Playoffs"])
        .map((seasonType) => {
          const count = getSummaryRows(state.data, "challengeOutcomeOverview", { seasonType, window: "all" }).reduce((total, row) => total + row.count, 0);
          return { label: seasonType, count };
        })
        .filter((row) => row.count > 0)
    : (() => {
        const counts = new Map();
        challengeRows.forEach((row) => {
          const seasonType = row.foulEvent?.seasonType || row.game?.seasonType || "Unknown";
          counts.set(seasonType, (counts.get(seasonType) || 0) + 1);
        });
        return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
      })();

  const lateGameRows = canUseSummary
    ? [
        {
          label: "All game states",
          count: getChallengeSummaryOutcomeRows("all").reduce((total, row) => total + row.count, 0),
        },
        {
          label: "Close games",
          count: getChallengeSummaryOutcomeRows("close_game").reduce((total, row) => total + row.count, 0),
        },
        {
          label: "Last two minutes",
          count: getChallengeSummaryOutcomeRows("last_two_minutes").reduce((total, row) => total + row.count, 0),
        },
      ]
    : [
        { label: "All game states", count: reviewedCount },
        { label: "Close games", count: challengeRows.filter((row) => row.foulEvent?.isCloseGame).length },
        { label: "Last two minutes", count: challengeRows.filter((row) => row.foulEvent?.isLastTwoMinutes).length },
      ];

  const recentRows = challengeRows
    .slice()
    .sort((a, b) => {
      const gameDateCompare = (b.game?.gameDate || "").localeCompare(a.game?.gameDate || "");
      if (gameDateCompare !== 0) return gameDateCompare;
      return b.foulEvent.gameClockSecondsElapsed - a.foulEvent.gameClockSecondsElapsed;
    })
    .slice(0, 12);

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Challenge Analytics</p>
            <h3>Review pressure and overturn patterns</h3>
          </div>
          <p class="panel-caption">Challenge outcomes are still inferred from play-by-play sequence logic unless the feed makes the result explicit. Use the confidence and reason fields as guardrails.</p>
        </div>
        <div class="metrics-grid">
          ${renderMetricCards([
            { label: "Reviewed whistles", value: String(reviewedCount), note: "Challenge-linked whistles in the current scope" },
            { label: "Upheld likely", value: String(upheldCount), note: "Original ruling appears to have stood" },
            { label: "Overturned likely", value: String(overturnedCount), note: "Original ruling appears to have been reversed" },
            { label: "Overturn rate", value: formatPercent(overturnRate), note: "Overturned likely divided by reviewed whistles" },
            { label: "Avg confidence", value: formatPercent(averageConfidence), note: "Average confidence on inferred challenge outcomes" },
          ])}
        </div>
      </article>

      <section class="view-grid">
        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Referees</p>
              <h3>Most challenged</h3>
            </div>
          </div>
          ${renderBarList(topRefRows, "count", "No challenged whistles in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Overturn Rate</p>
              <h3>Highest reversal share</h3>
            </div>
          </div>
          ${renderBarList(refOverturnRows, "count", "Need at least two reviewed whistles to rank overturn rate.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Teams</p>
              <h3>Most active challengers</h3>
            </div>
          </div>
          ${renderBarList(challengeTeamRows, "count", "No challenging team rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Outcome Mix</p>
              <h3>How reviews resolve</h3>
            </div>
          </div>
          ${renderBarList(outcomeMixRows, "count", "No challenge outcome rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Season Split</p>
              <h3>Regular season vs playoffs</h3>
            </div>
          </div>
          ${renderBarList(seasonChallengeRows, "count", "No season-level challenge rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Late Game</p>
              <h3>Close-game review pressure</h3>
            </div>
          </div>
          ${renderBarList(lateGameRows, "count", "No late-game challenge rows in this scope.")}
        </article>
      </section>

      <article class="panel-card">
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                ${renderTableHeaderCell("Game", "The game where the challenge occurred.")}
                ${renderTableHeaderCell("Referee", "The official whose whistle was reviewed.")}
                ${renderTableHeaderCell("Challenging Team", "The team that initiated the coach's challenge.")}
                ${renderTableHeaderCell("Quarter", "The period of the reviewed whistle.")}
                ${renderTableHeaderCell("Clock", "The game clock when the reviewed whistle occurred.")}
                ${renderTableHeaderCell("Call", "The foul type that was reviewed.")}
                ${renderTableHeaderCell("Outcome", "The inferred result of the review. Upheld likely means the original whistle appears to have stood. Overturned likely means it appears to have been changed.")}
                ${renderTableHeaderCell("Source", "Whether the review result came from an explicit official signal or from the app's inference model.")}
                ${renderTableHeaderCell("Confidence", "How confident the model is in the inferred review outcome.")}
                ${renderTableHeaderCell("Reason", "The primary post-review signal used to infer the outcome from the play-by-play sequence.")}
                ${renderTableHeaderCell("Evidence", "Official video or report links tied to this challenge row when available.")}
              </tr>
            </thead>
            <tbody>
              ${
                recentRows.length
                  ? recentRows
                      .map((row) => `
                        <tr>
                          ${renderTableCell("Game", row.game ? getGameLabel(row.game, state.lookups) : row.challengeEvent.gameId)}
                          ${renderTableCell("Referee", row.referee?.displayName || "Unknown")}
                          ${renderTableCell("Challenging Team", row.challengeTeam?.abbreviation || row.challengeEvent.teamId || "Unknown")}
                          ${renderTableCell("Quarter", `Q${row.foulEvent.period}`)}
                          ${renderTableCell("Clock", row.foulEvent.periodClock)}
                          ${renderTableCell("Call", `
                            <strong>${humanizeCallType(row.foulEvent.foulType)}</strong>
                            <div class="cell-subtle">${row.foulEvent.foulSubtype}</div>
                          `)}
                          ${renderTableCell("Outcome", `<span class="${getChallengeOutcomeTagClass(row.challengeEvent.challengeOutcome)}">${formatChallengeOutcome(row.challengeEvent.challengeOutcome)}</span>`)}
                          ${renderTableCell("Source", formatChallengeSource(row.challengeEvent.challengeOutcomeSource))}
                          ${renderTableCell("Confidence", row.challengeEvent.inferenceConfidence != null ? formatPercent(row.challengeEvent.inferenceConfidence) : "Unknown")}
                          ${renderTableCell("Reason", formatChallengeReason(row.challengeEvent.challengeInferenceReason))}
                          ${renderTableCell("Evidence", renderEvidenceLinks(row.foulEvent, row.challengeEvent))}
                        </tr>
                      `)
                      .join("")
                  : `<tr><td colspan="11" class="empty-cell">No challenge reviews match the current scope.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderCrewAnalytics(events) {
  const analytics = state.analytics.crew.data;
  const loading = state.analytics.crew.loading;
  const error = state.analytics.crew.error;
  const crewPayload = analytics || getCrewAnalytics(events, state.data, state.lookups);
  const rows = crewPayload.rows || [];
  const topOverturnRows = rows
    .filter((row) => row.reviewedCalls >= 2)
    .slice()
    .sort((a, b) => b.overturnRate - a.overturnRate || b.reviewedCalls - a.reviewedCalls)
    .slice(0, 6)
    .map((row) => ({ label: row.crewLabel, count: Math.round(row.overturnRate * 100) }));
  const homeTiltRows = rows
    .slice()
    .sort((a, b) => Math.abs(b.againstHomeShare - 0.5) - Math.abs(a.againstHomeShare - 0.5))
    .slice(0, 6)
    .map((row) => ({ label: row.crewLabel, count: Math.round(row.againstHomeShare * 100) }));
  const consistencyRows = rows
    .slice()
    .sort((a, b) => b.consistencyScore - a.consistencyScore || b.games - a.games)
    .slice(0, 6)
    .map((row) => ({ label: row.crewLabel, count: Math.round(row.consistencyScore) }));

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Crew Analytics</p>
            <h3>How referee crews behave together</h3>
          </div>
          <p class="panel-caption">Crew rows group all officials assigned to a game together, so you can inspect patterns that are bigger than any one whistleblower.</p>
        </div>
        ${loading && !analytics ? `<article class="loading-card compact-loading">Loading crew analytics for this scope…</article>` : ""}
        ${loading && analytics ? `<article class="status-banner status-banner-info">Updating results for the current filters…</article>` : ""}
        ${error ? `<article class="status-banner status-banner-bad"><strong>Crew analytics could not be refreshed.</strong><div>${error}</div></article>` : ""}
        <div class="metrics-grid">
          ${renderMetricCards([
            { label: "Crews in scope", value: String(crewPayload.metrics?.crews || rows.length), note: "Distinct officiating crews across the current filter" },
            { label: "Games in scope", value: String(crewPayload.metrics?.games || new Set(events.map((event) => event.gameId)).size), note: "Crew coverage across games" },
            { label: "Avg calls / crew game", value: formatDecimal(crewPayload.metrics?.averageCallsPerCrewGame || 0), note: "Crew foul volume normalized per game" },
            { label: "Review rate", value: formatPercent(crewPayload.metrics?.reviewRate || 0), note: "Reviewed whistles as a share of crew calls" },
          ])}
        </div>
      </article>

      <section class="view-grid">
        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Volume</p>
              <h3>Most active crews</h3>
            </div>
          </div>
          ${renderBarList(rows.slice(0, 6).map((row) => ({ label: row.crewLabel, count: row.totalCalls })), "count", "No crew rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Challenges</p>
              <h3>Highest overturn rate</h3>
            </div>
          </div>
          ${renderBarList(topOverturnRows, "count", "Need at least two reviewed whistles to compare overturn rates.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Venue Tilt</p>
              <h3>Strongest home whistle lean</h3>
            </div>
          </div>
          ${renderBarList(homeTiltRows, "count", "No home/away crew tilt rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Consistency</p>
              <h3>Most even quarter spread</h3>
            </div>
          </div>
          ${renderBarList(consistencyRows, "count", "No crew quarter consistency rows in this scope.")}
        </article>
      </section>

      <article class="panel-card">
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                ${renderTableHeaderCell("Crew", "The officials assigned together in the current game crew. This is the unit being evaluated, not one referee alone.")}
                ${renderTableHeaderCell("Games", "How many games from the current scope include this exact crew combination.")}
                ${renderTableHeaderCell("Calls", "Total foul calls by games worked by this crew in the current scope.")}
                ${renderTableHeaderCell("/ Game", "Average foul calls per game for this crew.")}
                ${renderTableHeaderCell("Reviewed", "How many whistles from this crew were later challenged.")}
                ${renderTableHeaderCell("Overturn %", "Share of reviewed whistles that appear to have been overturned. Higher is not automatically bad, but it does mean more reviewed rulings changed.")}
                ${renderTableHeaderCell("Against Home %", "Share of crew whistles assessed against the home team. Values far from 50 percent are worth inspecting in context.")}
                ${renderTableHeaderCell("Benefit Home %", "Share of crew whistles that benefited the home team.")}
                ${renderTableHeaderCell("Close", "Crew foul calls in close-game states.")}
                ${renderTableHeaderCell("Last Two", "Crew foul calls in the final two minutes of the fourth quarter or overtime.")}
                ${renderTableHeaderCell("Consistency", "A quarter-balance score. Higher means this crew's whistle volume is spread more evenly across quarters instead of clustering heavily in one period.")}
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (row) => `
                          <tr>
                            ${renderTableCell("Crew", `
                              <strong>${row.crewLabel}</strong>
                              <div class="cell-subtle">${row.refereeIds
                                .map((refereeId) => `<button class="mini-link-button" data-profile-referee="${refereeId}">${state.lookups.referees[refereeId]?.displayName || refereeId}</button>`)
                                .join(" ")}</div>
                            `)}
                            ${renderTableCell("Games", row.games)}
                            ${renderTableCell("Calls", row.totalCalls)}
                            ${renderTableCell("/ Game", formatDecimal(row.callsPerGame))}
                            ${renderTableCell("Reviewed", row.reviewedCalls)}
                            ${renderTableCell("Overturn %", formatPercent(row.overturnRate))}
                            ${renderTableCell("Against Home %", formatPercent(row.againstHomeShare))}
                            ${renderTableCell("Benefit Home %", formatPercent(row.benefitHomeShare))}
                            ${renderTableCell("Close", row.closeGameCalls)}
                            ${renderTableCell("Last Two", row.lastTwoMinutesCalls)}
                            ${renderTableCell("Consistency", Math.round(row.consistencyScore))}
                          </tr>
                        `,
                      )
                      .join("")
                  : `<tr><td colspan="11" class="empty-cell">No crew analytics are available for this scope.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderRefereeProfile(events) {
  const availableRefs = getAvailableReferees(events);
  const selectedRefId =
    state.focus.profileRefereeId !== "all" && availableRefs.some((referee) => referee.id === state.focus.profileRefereeId)
      ? state.focus.profileRefereeId
      : (state.focus.refereeId !== "all" && availableRefs.some((referee) => referee.id === state.focus.refereeId)
          ? state.focus.refereeId
          : (availableRefs[0]?.id || "all"));
  const analytics = state.analytics.profile.data;
  const loading = state.analytics.profile.loading;
  const error = state.analytics.profile.error;
  const profile = selectedRefId !== "all"
    ? analytics?.profile || getRefereeProfileData(events, state.data, state.lookups, state.filters, selectedRefId)
    : null;

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="split-header">
          <div>
            <p class="eyebrow">Referee Profile</p>
            <h3>${profile?.referee?.displayName || "Choose a referee"}</h3>
          </div>
          <div class="control-cluster">
            <label class="inline-control">
              <span>Profile referee</span>
              <select id="profile-ref-focus">
                <option value="all">Select a referee</option>
                ${optionMarkup(availableRefs, "id", (item) => item.displayName, selectedRefId)}
              </select>
            </label>
            <button class="action-button" id="back-to-ref-lens">Open Referee Lens</button>
          </div>
        </div>
        <p class="panel-caption">This view is a deeper drill-down that blends whistle volume, challenge history, crew context, and recent game behavior for one referee.</p>
      </article>
      ${loading && !profile ? `<article class="loading-card compact-loading">Loading referee profile for this scope…</article>` : ""}
      ${loading && profile ? `<article class="status-banner status-banner-info">Updating results for the current filters…</article>` : ""}
      ${error ? `<article class="status-banner status-banner-bad"><strong>Referee profile could not be refreshed.</strong><div>${error}</div></article>` : ""}
      ${
        profile
          ? `
            <section class="view-grid">
              ${renderRefereePhotoCard(profile.referee)}

              <article class="panel-card span-two">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Workload</p>
                    <h3>Profile snapshot</h3>
                  </div>
                </div>
                <div class="metrics-grid">
                  ${renderMetricCards([
                    { label: "Whistles", value: String(profile.metrics.whistles), note: "Calls made in the current scope" },
                    { label: "Whistles / 100 poss", value: formatDecimal(profile.metrics.whistlesPer100), note: `${Math.round(profile.metrics.possessions)} scoped possessions` },
                    { label: "FT / 100 poss", value: formatDecimal(profile.metrics.freeThrowsPer100), note: "Possession-adjusted whistle impact" },
                    { label: "Reviewed whistles", value: String(profile.metrics.reviewedWhistles), note: `${profile.metrics.overturnedWhistles} overturned likely` },
                    { label: "Close-game calls", value: String(profile.metrics.closeGameCalls), note: `${profile.metrics.lastTwoMinuteCalls} in the last two minutes` },
                  ])}
                </div>
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Timing</p>
                    <h3>Quarter split</h3>
                  </div>
                </div>
                ${renderBarList(profile.quarterRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Season Split</p>
                    <h3>Regular season vs playoffs</h3>
                  </div>
                </div>
                ${renderBarList(profile.seasonRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Venue Split</p>
                    <h3>Against home vs away</h3>
                  </div>
                </div>
                ${renderBarList(profile.againstVenueRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Benefit Split</p>
                    <h3>Benefiting home vs away</h3>
                  </div>
                </div>
                ${renderBarList(profile.benefitVenueRows)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Against Players</p>
                    <h3>Most penalized players</h3>
                  </div>
                </div>
                ${renderBarList(profile.againstPlayers)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Against Teams</p>
                    <h3>Most penalized teams</h3>
                  </div>
                </div>
                ${renderBarList(profile.againstTeams)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Benefited Players</p>
                    <h3>Players helped most often</h3>
                  </div>
                </div>
                ${renderBarList(profile.benefitedPlayers)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Benefited Teams</p>
                    <h3>Teams helped most often</h3>
                  </div>
                </div>
                ${renderBarList(profile.benefitedTeams)}
              </article>

              <article class="panel-card">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Crew Context</p>
                    <h3>Most common crew combinations</h3>
                  </div>
                </div>
                ${renderBarList(profile.crewRows)}
              </article>

              <article class="panel-card span-two">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Recent Games</p>
                    <h3>Recent workload</h3>
                  </div>
                </div>
                <div class="table-shell">
                  <table>
                    <thead>
                      <tr>
                        ${renderTableHeaderCell("Game", "The recent game worked by this referee.")}
                        ${renderTableHeaderCell("Whistles", "Foul calls attributed to this referee in that game.")}
                        ${renderTableHeaderCell("Reviewed", "Whistles in that game that were challenged.")}
                        ${renderTableHeaderCell("Close", "Calls in that game that happened in close-game states.")}
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        profile.recentGames.length
                          ? profile.recentGames
                              .map(
                                (row) => `
                                  <tr>
                                    ${renderTableCell("Game", row.game ? getGameLabel(row.game, state.lookups) : row.gameId)}
                                    ${renderTableCell("Whistles", row.whistles)}
                                    ${renderTableCell("Reviewed", row.reviewed)}
                                    ${renderTableCell("Close", row.closeGameCalls)}
                                  </tr>
                                `,
                              )
                              .join("")
                          : `<tr><td colspan="4" class="empty-cell">No recent game rows in the current scope.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </article>

              <article class="panel-card span-two">
                <div class="panel-header">
                  <div>
                    <p class="eyebrow">Challenge History</p>
                    <h3>Reviewed whistles tied to this referee</h3>
                  </div>
                </div>
                <div class="table-shell">
                  <table>
                    <thead>
                      <tr>
                        ${renderTableHeaderCell("Game", "The game where the reviewed whistle occurred.")}
                        ${renderTableHeaderCell("Quarter", "The period of the reviewed whistle.")}
                        ${renderTableHeaderCell("Clock", "The game clock at the challenged whistle.")}
                        ${renderTableHeaderCell("Call", "The foul type that was reviewed.")}
                        ${renderTableHeaderCell("Against", "The player or team originally called for the foul.")}
                        ${renderTableHeaderCell("Benefited", "The player or team that benefited from the original whistle.")}
                        ${renderTableHeaderCell("Outcome", "The inferred review result for this whistle.")}
                        ${renderTableHeaderCell("Source", "Whether the outcome was explicitly signaled or inferred from sequence behavior.")}
                        ${renderTableHeaderCell("Evidence", "Official video or report links tied to this reviewed whistle when available.")}
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        profile.challengeRows.length
                          ? profile.challengeRows
                              .map(
                                (event) => `
                                  <tr>
                                    ${renderTableCell("Game", state.lookups.games[event.gameId] ? getGameLabel(state.lookups.games[event.gameId], state.lookups) : event.gameId)}
                                    ${renderTableCell("Quarter", `Q${event.period}`)}
                                    ${renderTableCell("Clock", event.periodClock)}
                                    ${renderTableCell("Call", humanizeCallType(event.foulType))}
                                    ${renderTableCell("Against", state.lookups.players[event.penalizedPlayerId]?.displayName || state.lookups.teams[event.penalizedTeamId]?.abbreviation || "Unknown")}
                                    ${renderTableCell("Benefited", state.lookups.players[event.benefitedPlayerId]?.displayName || state.lookups.teams[event.benefitedTeamId]?.abbreviation || "Unknown")}
                                    ${renderTableCell("Outcome", `<span class="${getChallengeOutcomeTagClass(event.challengeOutcome)}">${formatChallengeOutcome(event.challengeOutcome)}</span>`)}
                                    ${renderTableCell("Source", formatChallengeSource(event.challengeOutcomeSource))}
                                    ${renderTableCell("Evidence", renderEvidenceLinks(event))}
                                  </tr>
                                `,
                              )
                              .join("")
                          : `<tr><td colspan="9" class="empty-cell">No reviewed whistles for this referee in the current scope.</td></tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          `
          : `<article class="panel-card"><p class="empty-state">Choose a referee to load a full profile.</p></article>`
      }
    </section>
  `;
}

function getSummaryTopRows(window, entityRole, labelFn, limit = 5) {
  const rows = getSummaryRows(state.data, "refereeEntity", {
    seasonType: state.filters.seasonType,
    window,
    entityRole,
  });

  const counts = new Map();
  rows.forEach((row) => {
    counts.set(row.entityId, (counts.get(row.entityId) || 0) + row.count);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, label: labelFn(key), count }));
}

function getSummaryTopReferees(window, limit = 5) {
  const rows = getSummaryRows(state.data, "refereeOverview", {
    seasonType: state.filters.seasonType,
    window,
  });

  return rows
    .slice()
    .sort((a, b) => b.totalCalls - a.totalCalls)
    .slice(0, limit)
    .map((row) => ({
      key: row.refereeId,
      label: state.lookups.referees[row.refereeId]?.displayName || row.refereeId,
      count: row.totalCalls,
    }));
}

function renderWindowDashboard(viewKey, title, caption, events) {
  const summaryWindow = viewKey === "close" ? "close_game" : "last_two_minutes";
  const metrics = getHeadlineMetrics(events);
  const topRefs = state.data.summaryTables
    ? getSummaryTopReferees(summaryWindow)
    : getRefereeSignalRows(events, state.lookups).slice(0, 5);
  const topTeams = state.data.summaryTables
    ? getSummaryTopRows(summaryWindow, "penalized_team", (teamId) => `${state.lookups.teams[teamId].abbreviation} fouled`)
    : getTopRows(events, (event) => event.penalizedTeamId, (teamId) => `${state.lookups.teams[teamId].abbreviation} fouled`);
  const topPlayers = state.data.summaryTables
    ? getSummaryTopRows(summaryWindow, "benefited_player", (playerId) => state.lookups.players[playerId].displayName)
    : getTopRows(events.filter((event) => event.benefitedPlayerId), (event) => event.benefitedPlayerId, (playerId) => state.lookups.players[playerId].displayName);
  const challengeRows = getTopRows(
    events.filter((event) => event.challengeReviewed),
    (event) => event.challengeOutcome || "unknown",
    (value) => value.replaceAll("_", " "),
  );

  return `
    <section class="view-grid">
      <article class="panel-card span-two">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Focused Dashboard</p>
            <h3>${title}</h3>
          </div>
          <p class="panel-caption">${caption}</p>
        </div>
        <div class="metrics-grid">
          ${renderMetricCards(metrics)}
        </div>
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Referees</p>
            <h3>Most active in this window</h3>
          </div>
        </div>
        ${renderBarList(topRefs)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Teams</p>
            <h3>Most penalized teams</h3>
          </div>
        </div>
        ${renderBarList(topTeams)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Players</p>
            <h3>Players drawing whistles</h3>
          </div>
        </div>
        ${renderBarList(topPlayers)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Challenges</p>
            <h3>Outcome mix</h3>
          </div>
        </div>
        ${renderBarList(challengeRows, "count", "No challenge reviews in this scope.")}
      </article>
    </section>
  `;
}

function renderTrendsView(events) {
  const callRows = getMonthlyTrendRows(events, state.lookups, "calls");
  const reviewedRows = getMonthlyTrendRows(events, state.lookups, "reviewed");
  const freeThrowRows = getMonthlyTrendRows(events, state.lookups, "free_throws");
  const refereeTrendRows = getRefereeTrendRows(events, state.lookups, 10);

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Trends</p>
            <h3>How whistle patterns move over time</h3>
          </div>
          <p class="panel-caption">These rows are grouped by game month inside the current filter scope so you can see when volume and review patterns changed.</p>
        </div>
      </article>

      <section class="view-grid">
        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Whistles</p>
              <h3>Calls by month</h3>
            </div>
          </div>
          ${renderBarList(callRows, "count", "No monthly whistle rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Reviews</p>
              <h3>Reviewed whistles by month</h3>
            </div>
          </div>
          ${renderBarList(reviewedRows, "count", "No monthly review rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Free Throws</p>
              <h3>Free throws awarded by month</h3>
            </div>
          </div>
          ${renderBarList(freeThrowRows, "count", "No free-throw trend rows in this scope.")}
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Referee Movement</p>
              <h3>Monthly ref activity snapshot</h3>
            </div>
          </div>
          ${renderBarList(refereeTrendRows.map((row) => ({ label: `${row.month} | ${row.refereeName}`, count: row.count })), "count", "No ref trend rows in this scope.")}
        </article>
      </section>

      <article class="panel-card">
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                ${renderTableHeaderCell("Month", "Calendar month of the scoped games in YYYY-MM format.")}
                ${renderTableHeaderCell("Games", "Games in the scoped sample for that month.")}
                ${renderTableHeaderCell("Calls", "Total foul events in that month.")}
                ${renderTableHeaderCell("Reviewed", "Calls in that month that were challenged.")}
                ${renderTableHeaderCell("Review Rate", "Reviewed whistles divided by total whistles for that month.")}
                ${renderTableHeaderCell("Overturned", "Reviewed whistles that appear to have been overturned.")}
                ${renderTableHeaderCell("Overturn Rate", "Overturned likely divided by reviewed whistles for that month.")}
                ${renderTableHeaderCell("FT Awarded", "Free throws awarded off whistles in that month.")}
                ${renderTableHeaderCell("L2M Tagged", "Whistles that also have a last-two-minute overlay in that month.")}
              </tr>
            </thead>
            <tbody>
              ${
                callRows.length
                  ? callRows
                      .map(
                        (row) => `
                          <tr>
                            ${renderTableCell("Month", row.label)}
                            ${renderTableCell("Games", row.games)}
                            ${renderTableCell("Calls", row.calls)}
                            ${renderTableCell("Reviewed", row.reviewed)}
                            ${renderTableCell("Review Rate", formatPercent(row.reviewRate))}
                            ${renderTableCell("Overturned", row.overturned)}
                            ${renderTableCell("Overturn Rate", formatPercent(row.overturnRate))}
                            ${renderTableCell("FT Awarded", row.freeThrows)}
                            ${renderTableCell("L2M Tagged", row.l2mTagged)}
                          </tr>
                        `,
                      )
                      .join("")
                  : `<tr><td colspan="9" class="empty-cell">No monthly trend rows match the current scope.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderAboutView(events) {
  const health = state.admin.health;
  const datasetStatus = health?.datasetStatus || {};
  const coverage = getCoverageSummary(events, state.data, state.lookups);
  const syncState = health?.syncState || {};

  return `
    <section class="stack-section">
      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">About</p>
            <h3>App version, data coverage, and sync posture</h3>
          </div>
        </div>
        <p class="panel-caption">This page is meant to make the deployment easier to trust at a glance: what version is running, what data is loaded, and how broad the current analytical scope actually is.</p>
      </article>

      <section class="view-grid">
        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Build</p>
              <h3>Runtime identity</h3>
            </div>
          </div>
          <div class="admin-stat-list">
            <div class="stat-pair"><span>App version</span><strong>v${health?.appVersion || "dev"}</strong></div>
            <div class="stat-pair"><span>Dataset type</span><strong>${datasetStatus.sampleType || "unknown"}</strong></div>
            <div class="stat-pair"><span>Generated at</span><strong>${formatDateTime(datasetStatus.generatedAt)}</strong></div>
            <div class="stat-pair"><span>Last successful sync</span><strong>${formatDateTime(syncState.lastCompletedAt || datasetStatus.generatedAt)}</strong></div>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Coverage</p>
              <h3>Current scoped sample</h3>
            </div>
          </div>
          <div class="admin-stat-list">
            <div class="stat-pair"><span>Games</span><strong>${coverage.games}</strong></div>
            <div class="stat-pair"><span>Crews</span><strong>${coverage.crews}</strong></div>
            <div class="stat-pair"><span>Referees</span><strong>${coverage.referees}</strong></div>
            <div class="stat-pair"><span>Teams</span><strong>${coverage.teams}</strong></div>
            <div class="stat-pair"><span>Players</span><strong>${coverage.players}</strong></div>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Quality</p>
              <h3>Challenge and L2M coverage</h3>
            </div>
          </div>
          <div class="admin-stat-list">
            <div class="stat-pair"><span>Reviewed whistles</span><strong>${coverage.reviewedWhistles}</strong></div>
            <div class="stat-pair"><span>Challenge outcomes inferred</span><strong>${formatPercent(coverage.inferredChallengeShare)}</strong></div>
            <div class="stat-pair"><span>L2M-tagged whistle share</span><strong>${formatPercent(coverage.l2mShare)}</strong></div>
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderAdminView() {
  const health = state.admin.health;
  const syncStatus = state.admin.syncStatus;
  const syncState = syncStatus?.syncState || health?.syncState || {};
  const syncDefaults = syncStatus?.defaults || {};
  const summaryRows = getSyncSummaryRows();
  const session = getAdminSessionState();
  const authRequired = Boolean(health?.adminAuthEnabled);
  const syncUnlocked = !authRequired || session.authenticated;
  const datasetStatus = syncStatus?.datasetStatus || health?.datasetStatus || {};
  const syncEvaluation = syncStatus?.syncEvaluation || health?.syncEvaluation || {};

  return `
    <section class="stack-section">

      <article class="panel-card admin-sync-card">
        <div class="split-header">
          <div>
            <p class="eyebrow">Manual Sync</p>
            <h3>Pull fresh data from the NBA API</h3>
          </div>
          <div class="control-cluster">
            <button class="action-button" id="admin-refresh" ${state.admin.isRefreshing ? "disabled" : ""}>
              ${state.admin.isRefreshing ? "Refreshing..." : "Refresh status"}
            </button>
            <button class="action-button action-button-accent" id="admin-sync" ${state.admin.isSubmitting || !syncUnlocked ? "disabled" : ""}>
              ${state.admin.isSubmitting ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </div>

        ${
          syncState?.running
            ? `<article class="status-banner status-banner-info"><strong>Sync is running.</strong> This page will update automatically when it finishes.</article>`
            : ""
        }
        ${state.admin.message ? `<article class="status-banner status-banner-good"><strong>${state.admin.message}</strong></article>` : ""}
        ${state.admin.error ? `<article class="status-banner status-banner-bad"><strong>${state.admin.error}</strong></article>` : ""}

        <div class="admin-sync-fields">
          <label>
            <span>Sync from</span>
            <input id="admin-sync-from" type="date" value="${state.admin.syncForm.from}" />
          </label>
          <label>
            <span>Sync to</span>
            <input id="admin-sync-to" type="date" value="${state.admin.syncForm.to}" />
          </label>
          <label>
            <span>Max games</span>
            <input id="admin-sync-max-games" type="number" min="0" step="1" placeholder="Default" value="${state.admin.syncForm.maxGames}" />
          </label>
        </div>
        <p class="panel-caption">Leave dates blank for the rolling recent window. Set Max games to 0 to backfill everything in the date range without dropping older data.</p>
      </article>

      ${
        authRequired
          ? `
          <article class="panel-card">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Authentication</p>
                <h3>${session.authenticated ? "Session active" : "Sign in required"}</h3>
              </div>
              ${session.authenticated ? `<span class="tag is-good">Authenticated</span>` : `<span class="tag is-warning">Locked</span>`}
            </div>
            <div class="admin-token-row">
              <label class="inline-control grow-control">
                <span>Admin access token</span>
                <input id="admin-token" type="password" placeholder="Enter ADMIN_TOKEN from server config" value="${state.admin.loginToken}" />
              </label>
              <button class="action-button action-button-accent" id="admin-login" ${state.admin.isAuthenticating || !state.admin.loginToken.trim() ? "disabled" : ""}>
                ${state.admin.isAuthenticating ? "Signing in…" : session.authenticated ? "Refresh session" : "Sign in"}
              </button>
              ${session.authenticated ? `<button class="action-button" id="admin-logout" ${state.admin.isSigningOut ? "disabled" : ""}>${state.admin.isSigningOut ? "Signing out…" : "Sign out"}</button>` : ""}
            </div>
            <p class="panel-caption">
              ${session.authenticated ? `Session active until ${formatDateTime(session.expiresAt)}.` : "Enter the ADMIN_TOKEN value set in your server environment to unlock sync."}
            </p>
          </article>
          `
          : `
          <article class="status-banner status-banner-info">
            <strong>No authentication required.</strong>
            Sync is open because no ADMIN_TOKEN is configured. Set one in your environment to restrict access.
          </article>
          `
      }

      <section class="view-grid">
        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Service Health</p>
              <h3>Runtime status</h3>
            </div>
          </div>
          <div class="metrics-grid single-column">
            ${renderMetricCards([
              { label: "API health", value: health?.ok ? "Healthy" : "Unknown", note: "Live status from /api/health" },
              { label: "Database", value: health?.databaseEnabled ? "Enabled" : "Disabled", note: "Whether Postgres persistence is configured" },
              { label: "Auto sync", value: health?.autoSyncEnabled ? "On" : "Off", note: "Recurring background sync state" },
              { label: "Auth", value: authRequired ? (session.authenticated ? "Authenticated" : "Locked") : "Open", note: authRequired ? "ADMIN_TOKEN is configured" : "No token set — sync is open" },
              { label: "Sync runner", value: syncState?.running ? "Running" : "Idle", note: syncState?.running ? "A sync job is currently active" : "No sync job is active" },
            ])}
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Last Sync</p>
              <h3>Schedule and result</h3>
            </div>
          </div>
          <div class="admin-stat-list">
            <div class="stat-pair"><span>Default window from</span><strong>${syncDefaults.from || "Unknown"}</strong></div>
            <div class="stat-pair"><span>Default window to</span><strong>${syncDefaults.to || "Unknown"}</strong></div>
            <div class="stat-pair"><span>Max games default</span><strong>${syncDefaults.maxGames ?? "Unknown"}</strong></div>
            <div class="stat-pair"><span>Last started</span><strong>${formatDateTime(syncState?.lastStartedAt)}</strong></div>
            <div class="stat-pair"><span>Last completed</span><strong>${formatDateTime(syncState?.lastCompletedAt)}</strong></div>
            <div class="stat-pair"><span>Last failed</span><strong>${formatDateTime(syncState?.lastFailedAt)}</strong></div>
          </div>
          ${
            summaryRows.length
              ? `<div class="admin-stat-list" style="margin-top:10px">${summaryRows.map((row) => `<div class="stat-pair"><span>${row.label}</span><strong>${row.value}</strong></div>`).join("")}</div>`
              : ""
          }
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Freshness</p>
              <h3>Dataset status</h3>
            </div>
          </div>
          <div class="admin-stat-list">
            <div class="stat-pair"><span>Dataset type</span><strong>${datasetStatus.sampleType || "Unknown"}</strong></div>
            <div class="stat-pair"><span>Generated</span><strong>${formatDateTime(datasetStatus.generatedAt)}</strong></div>
            <div class="stat-pair"><span>Freshness state</span><strong>${syncEvaluation.status || "healthy"}</strong></div>
            <div class="stat-pair"><span>Stale threshold</span><strong>${syncEvaluation.staleThresholdHours ?? "Unknown"} hours</strong></div>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Alerts</p>
              <h3>Operational warnings</h3>
            </div>
          </div>
          ${
            getOperationalAlerts().length
              ? getOperationalAlerts()
                  .map(
                    (alert) => `
                      <div class="status-banner ${getAlertClassName(alert.level)} compact-banner">
                        <strong>${alert.message}</strong>
                        ${alert.detail ? `<div>${alert.detail}</div>` : ""}
                      </div>
                    `,
                  )
                  .join("")
              : `<p class="empty-state">No active sync or freshness alerts.</p>`
          }
        </article>
      </section>
    </section>
  `;
}

function getPlayoffSeries() {
  if (!state.data) return [];
  const seriesMap = new Map();
  state.data.games
    .filter((g) => g.seasonType === "Playoffs")
    .forEach((game) => {
      const sorted = [game.homeTeamId, game.awayTeamId].sort();
      const key = `${game.season}|${sorted[0]}|${sorted[1]}`;
      if (!seriesMap.has(key)) {
        seriesMap.set(key, { key, season: game.season, teamAId: sorted[0], teamBId: sorted[1], games: [] });
      }
      seriesMap.get(key).games.push(game);
    });
  for (const s of seriesMap.values()) {
    s.games.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  }
  return [...seriesMap.values()].sort((a, b) => b.season.localeCompare(a.season) || a.teamAId.localeCompare(b.teamAId));
}

function renderSeriesTotalChart(gameStats) {
  const n = gameStats.length;
  if (!n) return "";
  const vw = 480, vh = 180, ml = 36, mr = 12, mt = 20, mb = 32;
  const cw = vw - ml - mr, ch = vh - mt - mb;
  const maxVal = Math.max(...gameStats.map((g) => g.total), 1);
  const colW = cw / n;
  const barW = Math.min(colW * 0.55, 48);

  const gridlines = [0, 0.5, 1].map((frac) => {
    const val = Math.round(maxVal * frac);
    const y = mt + ch - frac * ch;
    return `<line x1="${ml}" y1="${y}" x2="${vw - mr}" y2="${y}" stroke="currentColor" stroke-opacity="0.07" stroke-dasharray="3,3"/>
            <text x="${ml - 5}" y="${y + 4}" text-anchor="end" fill="currentColor" font-size="10" opacity="0.45">${val}</text>`;
  }).join("");

  const bars = gameStats.map((gs, i) => {
    const bh = Math.max((gs.total / maxVal) * ch, 2);
    const x = ml + i * colW + (colW - barW) / 2;
    const y = mt + ch - bh;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="var(--accent)" opacity="0.82"/>
            <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" fill="currentColor" font-size="11" font-weight="700">${gs.total}</text>
            <text x="${ml + i * colW + colW / 2}" y="${vh - 6}" text-anchor="middle" fill="currentColor" font-size="11" opacity="0.6">G${gs.gameNum}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${vw} ${vh}" style="width:100%;max-height:${vh}px" aria-hidden="true">${gridlines}${bars}</svg>`;
}

function renderSeriesSplitChart(gameStats, teamA, teamB) {
  const n = gameStats.length;
  if (!n) return "";
  const vw = 480, vh = 180, ml = 36, mr = 12, mt = 20, mb = 32;
  const cw = vw - ml - mr, ch = vh - mt - mb;
  const maxVal = Math.max(...gameStats.flatMap((g) => [g.againstA, g.againstB]), 1);
  const colW = cw / n;
  const barW = Math.min(colW * 0.28, 22);
  const gap = 3;

  const gridlines = [0, 0.5, 1].map((frac) => {
    const val = Math.round(maxVal * frac);
    const y = mt + ch - frac * ch;
    return `<line x1="${ml}" y1="${y}" x2="${vw - mr}" y2="${y}" stroke="currentColor" stroke-opacity="0.07" stroke-dasharray="3,3"/>
            <text x="${ml - 5}" y="${y + 4}" text-anchor="end" fill="currentColor" font-size="10" opacity="0.45">${val}</text>`;
  }).join("");

  const bars = gameStats.map((gs, i) => {
    const cx = ml + i * colW + colW / 2;
    const xA = cx - barW - gap / 2;
    const xB = cx + gap / 2;
    const bhA = Math.max((gs.againstA / maxVal) * ch, 2);
    const bhB = Math.max((gs.againstB / maxVal) * ch, 2);
    return `<rect x="${xA}" y="${mt + ch - bhA}" width="${barW}" height="${bhA}" rx="3" fill="var(--accent)" opacity="0.82"/>
            <text x="${xA + barW / 2}" y="${mt + ch - bhA - 4}" text-anchor="middle" fill="currentColor" font-size="10" font-weight="700">${gs.againstA}</text>
            <rect x="${xB}" y="${mt + ch - bhB}" width="${barW}" height="${bhB}" rx="3" fill="var(--secondary)" opacity="0.82"/>
            <text x="${xB + barW / 2}" y="${mt + ch - bhB - 4}" text-anchor="middle" fill="currentColor" font-size="10" font-weight="700">${gs.againstB}</text>
            <text x="${cx}" y="${vh - 6}" text-anchor="middle" fill="currentColor" font-size="11" opacity="0.6">G${gs.gameNum}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${vw} ${vh}" style="width:100%;max-height:${vh}px" aria-hidden="true">${gridlines}${bars}</svg>`;
}

function renderSeriesView() {
  if (!state.data || !state.lookups) return `<section class="stack-section"><article class="loading-card compact-loading">Loading…</article></section>`;

  const allSeries = getPlayoffSeries();

  if (!allSeries.length) {
    return `
      <section class="stack-section">
        <article class="panel-card">
          <p class="eyebrow">No Playoff Data</p>
          <h3>No playoff series available yet</h3>
          <p class="panel-caption">Sync playoff games to see series-level analysis. Series are grouped automatically by matching team pairs across multiple playoff games.</p>
        </article>
      </section>
    `;
  }

  if (!state.series.selectedKey || !allSeries.find((s) => s.key === state.series.selectedKey)) {
    state.series.selectedKey = allSeries[0].key;
  }

  const selected = allSeries.find((s) => s.key === state.series.selectedKey);
  const teamA = state.lookups.teams[selected.teamAId];
  const teamB = state.lookups.teams[selected.teamBId];
  const seriesGameIds = new Set(selected.games.map((g) => g.id));
  const seriesEvents = state.data.foulEvents.filter((e) => seriesGameIds.has(e.gameId));

  const gameStats = selected.games.map((game, idx) => {
    const ge = seriesEvents.filter((e) => e.gameId === game.id);
    const againstA = ge.filter((e) => e.penalizedTeamId === selected.teamAId).length;
    const againstB = ge.filter((e) => e.penalizedTeamId === selected.teamBId).length;
    const homeTeam = state.lookups.teams[game.homeTeamId];
    const awayTeam = state.lookups.teams[game.awayTeamId];
    const homeWon = game.homeScoreFinal > game.awayScoreFinal;
    return { game, gameNum: idx + 1, total: ge.length, againstA, againstB, homeTeam, awayTeam, homeWon };
  });

  // Per-ref whistle counts across the series
  const refMap = new Map();
  seriesEvents.forEach((e) => {
    if (!e.refereeId) return;
    const r = refMap.get(e.refereeId) || { count: 0, againstA: 0, againstB: 0 };
    r.count++;
    if (e.penalizedTeamId === selected.teamAId) r.againstA++;
    if (e.penalizedTeamId === selected.teamBId) r.againstB++;
    refMap.set(e.refereeId, r);
  });
  const refRows = [...refMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([id, r]) => {
      const ref = state.lookups.referees[id];
      return `<tr>
        ${renderTableCell("Referee", ref?.displayName || id)}
        ${renderTableCell("Whistles", r.count)}
        ${renderTableCell(`vs ${teamA?.abbreviation}`, r.againstA)}
        ${renderTableCell(`vs ${teamB?.abbreviation}`, r.againstB)}
      </tr>`;
    }).join("");

  // Series wins tally
  const winsA = gameStats.filter((gs) => {
    const homeIsA = gs.game.homeTeamId === selected.teamAId;
    return homeIsA ? gs.homeWon : !gs.homeWon;
  }).length;
  const winsB = gameStats.length - winsA;

  const seriesSelector = allSeries.length > 1 ? `
    <div class="filter-group series-selector">
      <label for="series-select">Series</label>
      <select id="series-select">
        ${allSeries.map((s) => {
          const tA = state.lookups.teams[s.teamAId];
          const tB = state.lookups.teams[s.teamBId];
          return `<option value="${s.key}" ${s.key === state.series.selectedKey ? "selected" : ""}>${tA?.abbreviation ?? "?"} vs ${tB?.abbreviation ?? "?"} — ${s.season} (${s.games.length} game${s.games.length !== 1 ? "s" : ""})</option>`;
        }).join("")}
      </select>
    </div>
  ` : "";

  return `
    <section class="stack-section">
      <article class="panel-card">
        ${seriesSelector}
        <div class="split-header">
          <div>
            <p class="eyebrow">Playoff Series · ${selected.season}</p>
            <h3>${teamA?.name ?? selected.teamAId} vs ${teamB?.name ?? selected.teamBId}</h3>
          </div>
          <div class="tag-row">
            <span class="tag">${selected.games.length} game${selected.games.length !== 1 ? "s" : ""}</span>
            <span class="tag">${seriesEvents.length} total whistles</span>
            <span class="tag">${teamA?.abbreviation} ${winsA} – ${winsB} ${teamB?.abbreviation}</span>
          </div>
        </div>
      </article>

      <div class="series-games-row">
        ${gameStats.map((gs) => {
          const homeIsA = gs.game.homeTeamId === selected.teamAId;
          const aWon = homeIsA ? gs.homeWon : !gs.homeWon;
          return `
            <article class="panel-card series-game-card">
              <p class="eyebrow">Game ${gs.gameNum} · ${gs.game.gameDate}</p>
              <div class="series-score">
                <span class="${!aWon ? "series-winner" : ""}">${gs.awayTeam.abbreviation}</span>
                <span class="score-num ${!aWon ? "series-winner" : ""}">${gs.game.awayScoreFinal}</span>
                <span class="score-dash">–</span>
                <span class="score-num ${gs.homeWon ? "series-winner" : ""}">${gs.game.homeScoreFinal}</span>
                <span class="${gs.homeWon ? "series-winner" : ""}">${gs.homeTeam.abbreviation}</span>
              </div>
              <div class="tag-row" style="margin-top:6px">
                <span class="tag">${gs.total} whistles</span>
              </div>
            </article>
          `;
        }).join("")}
      </div>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Whistle Volume</p>
            <h3>Total calls per game</h3>
          </div>
        </div>
        ${renderSeriesTotalChart(gameStats)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Foul Split</p>
            <h3>Calls against each team per game</h3>
          </div>
        </div>
        <div class="chart-legend">
          <span class="legend-dot legend-team-a"></span> ${teamA?.abbreviation} penalized
          <span class="legend-dot legend-team-b"></span> ${teamB?.abbreviation} penalized
        </div>
        ${renderSeriesSplitChart(gameStats, teamA, teamB)}
      </article>

      <article class="panel-card">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Officials</p>
            <h3>Referee breakdown across series</h3>
          </div>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                ${renderTableHeaderCell("Referee", "Official credited with whistles in this series.")}
                ${renderTableHeaderCell("Whistles", "Total whistles attributed in the series.")}
                ${renderTableHeaderCell(`vs ${teamA?.abbreviation}`, `Calls against ${teamA?.name}.`)}
                ${renderTableHeaderCell(`vs ${teamB?.abbreviation}`, `Calls against ${teamB?.name}.`)}
              </tr>
            </thead>
            <tbody>${refRows || `<tr><td colspan="4" class="empty-cell">No whistle data for this series.</td></tr>`}</tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderView() {
  const events = getEventsForView();

  switch (state.view) {
    case "games":
      return renderGameExplorer(events);
    case "referees":
      return renderRefereeLens(events);
    case "profile":
      return renderRefereeProfile(events);
    case "entities":
      return renderEntities(events);
    case "bias":
      return renderBiasLab(events);
    case "crew":
      return renderCrewAnalytics(events);
    case "challenge":
      return renderChallengeAnalytics(events);
    case "compare":
      return renderCompareView();
    case "trends":
      return renderTrendsView(events);
    case "series":
      return renderSeriesView();
    case "close":
      return renderWindowDashboard("close", "Close game dashboard", "Calls made with the score margin at five or less.", events);
    case "last2":
      return renderWindowDashboard("last2", "Last two minutes dashboard", "Fourth quarter and overtime whistles inside the final two minutes.", events);
    case "about":
      return renderAboutView(events);
    case "admin":
      return renderAdminView();
    case "overview":
    default:
      return renderOverview(events);
  }
}

function renderViewSafe() {
  try {
    return renderView();
  } catch (err) {
    console.error("[WhistleIQ] View render error:", err);
    return `
      <section class="stack-section">
        <article class="status-banner status-banner-bad">
          <strong>This view ran into an error and could not render.</strong>
          <div>${escapeHtml(err?.message || String(err))}</div>
        </article>
      </section>
    `;
  }
}

function render() {
  maybeLoadViewAnalytics();
  const events = getEventsForView();
  document.body.classList.toggle("sidebar-collapsed", state.ui.sidebarCollapsed);
  const html = `
    ${renderTopbar()}
    ${renderSidebar()}
    ${state.data ? renderFilterStrip(events) : ""}
    ${renderFilterDrawer()}
    ${renderUiBanner()}
    ${renderOperationalAlerts()}
    ${state.data && state.view !== "admin" ? renderContextStrip(events) : ""}
    ${state.view === "admin" ? renderAppStatusStrip() : ""}
    ${renderViewSafe()}
    ${renderEvidenceDrawer()}
    ${renderCommandPalette()}
  `;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  morphdom(app, tmp, { childrenOnly: true });
  initVirtualScrollers();
}

async function loadDataset(options = {}) {
  const includeRawPlayByPlay = options.includeRawPlayByPlay === true;
  const query = includeRawPlayByPlay ? "" : "?includeRaw=0";
  const response = await fetch(`/api/data${query}`);
  if (!response.ok) {
    throw new Error(`Dataset request failed: ${response.status}`);
  }
  const data = await response.json();
  state.data = data;
  state.lookups = buildLookups(data);
  state.rawPlayByPlayLoaded = Array.isArray(data.rawPlayByPlayEvents) && data.rawPlayByPlayEvents.length > 0;
  state.analytics.bias.key = "";
  state.analytics.crew.key = "";
  state.analytics.profile.key = "";
  state.analytics.bias.data = null;
  state.analytics.crew.data = null;
  state.analytics.profile.data = null;
  state.analytics.bias.loading = false;
  state.analytics.crew.loading = false;
  state.analytics.profile.loading = false;
  state.analytics.bias.error = "";
  state.analytics.crew.error = "";
  state.analytics.profile.error = "";
  if (state.rawPlayByPlayLoaded) {
    state.rawPlayByPlayError = "";
  }
}

async function ensureRawPlayByPlayLoaded() {
  if (state.rawPlayByPlayLoaded || state.rawPlayByPlayLoading) {
    return;
  }

  state.rawPlayByPlayLoading = true;
  state.rawPlayByPlayError = "";
  render();

  try {
    const response = await fetch("/api/data/raw-play-by-play");
    if (!response.ok) {
      throw new Error(`Raw play-by-play request failed: ${response.status}`);
    }

    const payload = await response.json();
    state.data.rawPlayByPlayEvents = payload.rawPlayByPlayEvents || [];
    state.rawPlayByPlayLoaded = true;
    state.rawPlayByPlayError = "";
  } catch (error) {
    state.rawPlayByPlayError = error instanceof Error ? error.message : String(error);
  } finally {
    state.rawPlayByPlayLoading = false;
    render();
  }
}

async function waitForSyncToFinish(timeoutMs = 30 * 60 * 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    await loadAdminStatus();

    const syncState = state.admin.syncStatus?.syncState || {};
    if (!syncState.running) {
      if (syncState.lastError) {
        throw new Error(syncState.lastError);
      }
      return syncState.lastSummary || null;
    }

    state.admin.message = "Manual sync is still running. The app will refresh when the job finishes.";
    render();
  }

  throw new Error("Manual sync is still running in the background. Refresh Admin status in a few minutes.");
}

async function loadAdminStatus() {
  const [healthResponse, syncResponse, sessionResponse] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/sync/status"),
    fetch("/api/admin/session"),
  ]);
  if (!healthResponse.ok) {
    throw new Error(`Health request failed: ${healthResponse.status}`);
  }
  if (!syncResponse.ok) {
    throw new Error(`Sync status request failed: ${syncResponse.status}`);
  }
  if (!sessionResponse.ok) {
    throw new Error(`Session request failed: ${sessionResponse.status}`);
  }
  state.admin.health = await healthResponse.json();
  state.admin.syncStatus = await syncResponse.json();
  state.admin.session = await sessionResponse.json();
  hydrateAdminSyncForm(state.admin.syncStatus?.defaults || {});
}

async function refreshAdminPanel() {
  state.admin.isRefreshing = true;
  state.admin.error = "";
  try {
    await Promise.all([loadAdminStatus(), loadDataset({ includeRawPlayByPlay: false })]);
    state.admin.message = "Status refreshed.";
  } catch (error) {
    state.admin.error = error instanceof Error ? error.message : String(error);
    state.admin.message = "";
  } finally {
    state.admin.isRefreshing = false;
    render();
  }
}

async function signInAdmin() {
  state.admin.isAuthenticating = true;
  state.admin.message = "";
  state.admin.error = "";
  render();

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: state.admin.loginToken,
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Login failed: ${response.status}`);
    }

    await loadAdminStatus();
    state.admin.message = `Admin session active until ${formatDateTime(payload.expiresAt)}.`;
    state.admin.error = "";
  } catch (error) {
    state.admin.error = error instanceof Error ? error.message : String(error);
    state.admin.message = "";
  } finally {
    state.admin.isAuthenticating = false;
    render();
  }
}

async function signOutAdmin() {
  state.admin.isSigningOut = true;
  state.admin.message = "";
  state.admin.error = "";
  render();

  try {
    const response = await fetch("/api/admin/logout", {
      method: "POST",
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Logout failed: ${response.status}`);
    }

    await loadAdminStatus();
    state.admin.message = "Admin session signed out.";
    state.admin.error = "";
  } catch (error) {
    state.admin.error = error instanceof Error ? error.message : String(error);
    state.admin.message = "";
  } finally {
    state.admin.isSigningOut = false;
    render();
  }
}

async function runManualSync() {
  state.admin.isSubmitting = true;
  state.admin.message = "";
  state.admin.error = "";
  render();

  try {
    const response = await fetch("/api/admin/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: state.admin.syncForm.from,
        to: state.admin.syncForm.to,
        maxGames: state.admin.syncForm.maxGames,
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Sync request failed: ${response.status}`);
    }

    state.admin.message = payload.reason === "already_running"
      ? "A sync job is already running. Waiting for it to finish..."
      : "Manual sync started. This can take a while for large backfills.";
    render();

    const summary = await waitForSyncToFinish();
    await Promise.all([loadAdminStatus(), loadDataset({ includeRawPlayByPlay: false })]);
    if (viewNeedsRawPlayByPlay(state.view)) {
      ensureRawPlayByPlayLoaded();
    }
    state.admin.message = summary
      ? `Manual sync completed for ${summary.from || state.admin.syncForm.from} through ${summary.to || state.admin.syncForm.to}: ${summary.games} games, ${summary.foulEvents} fouls, ${summary.challenges} challenges, ${summary.l2mReviews} L2M reviews.`
      : "Manual sync completed.";
    state.admin.error = "";
  } catch (error) {
    await loadAdminStatus().catch(() => {});
    state.admin.error = error instanceof Error ? error.message : String(error);
    state.admin.message = "";
  } finally {
    state.admin.isSubmitting = false;
    render();
  }
}

async function quickSync() {
  if (state.admin.isSubmitting) return;
  state.admin.isSubmitting = true;
  state.ui.message = "";
  state.ui.error = "";
  render();
  try {
    const response = await fetch("/api/admin/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Sync request failed: ${response.status}`);
    }
    state.ui.message = "Sync started. Waiting for completion…";
    render();
    await waitForSyncToFinish();
    await Promise.all([loadAdminStatus(), loadDataset({ includeRawPlayByPlay: false })]);
    state.ui.message = "Sync complete. Data is fresh.";
    state.ui.error = "";
  } catch (error) {
    state.ui.error = error instanceof Error ? error.message : String(error);
    state.ui.message = "";
  } finally {
    state.admin.isSubmitting = false;
    render();
  }
}

function handleChange(target) {
  const filterMap = {
    "filter-season": "season",
    "filter-game": "gameId",
    "filter-referee": "refereeId",
    "filter-team": "teamId",
    "filter-player": "playerId",
    "filter-period": "period",
    "filter-score-state": "scoreState",
    "filter-season-type": "seasonType",
    "filter-venue-context": "venueContext",
  };

  if (filterMap[target.id]) {
    state.filters[filterMap[target.id]] = target.value;
    syncLocationState();
    renderDebounced();
    return;
  }

  if (target.id === "ref-focus") {
    state.focus.refereeId = target.value;
    if (target.value !== "all") {
      state.focus.profileRefereeId = target.value;
    }
    syncLocationState();
    renderDebounced();
    return;
  }

  if (target.id === "profile-ref-focus") {
    state.focus.profileRefereeId = target.value;
    syncLocationState();
    renderDebounced();
    return;
  }

  if (target.id === "entity-mode") {
    state.focus.entityMode = target.value;
    state.focus.entityId = "all";
    syncLocationState();
    renderDebounced();
    return;
  }

  if (target.id === "entity-focus") {
    state.focus.entityId = target.value;
    syncLocationState();
    renderDebounced();
    return;
  }

  if (target.id === "bias-mode") {
    state.focus.biasMode = target.value;
    syncLocationState();
    renderDebounced();
    return;
  }

  if (target.id === "series-select") {
    state.series.selectedKey = target.value;
    render();
    return;
  }

  const compareFieldMap = {
    "compare-left-id": ["left", "id"],
    "compare-right-id": ["right", "id"],
    "compare-left-season": ["left", "season"],
    "compare-right-season": ["right", "season"],
    "compare-left-season-type": ["left", "seasonType"],
    "compare-right-season-type": ["right", "seasonType"],
  };

  if (target.id === "compare-subject") {
    state.compare.subject = target.value;
    state.compare.left.id = "all";
    state.compare.right.id = "all";
    syncLocationState();
    renderDebounced();
    return;
  }

  if (compareFieldMap[target.id]) {
    const [side, key] = compareFieldMap[target.id];
    state.compare[side][key] = target.value;
    syncLocationState();
    renderDebounced();
    return;
  }

  if (target.id === "saved-preset-select") {
    state.presets.selectedId = target.value;
    render();
    return;
  }

  if (target.id === "admin-token") {
    state.admin.loginToken = target.value;
    syncAdminLoginButtonState();
    return;
  }

  if (target.id === "admin-sync-from") {
    state.admin.syncForm.from = target.value;
    return;
  }

  if (target.id === "admin-sync-to") {
    state.admin.syncForm.to = target.value;
    return;
  }

  if (target.id === "admin-sync-max-games") {
    state.admin.syncForm.maxGames = target.value;
  }
}

function handleInput(target) {
  if (target.id === "command-palette-input") {
    state.palette.query = target.value;
    state.palette.selectedIndex = 0;
    render();
    const input = document.querySelector("#command-palette-input");
    if (input) input.focus();
    return;
  }

  if (target.id === "preset-name") {
    state.presets.draftName = target.value;
    return;
  }

  if (target.id === "admin-token") {
    state.admin.loginToken = target.value;
    syncAdminLoginButtonState();
    return;
  }

  if (target.id === "admin-sync-from") {
    state.admin.syncForm.from = target.value;
    return;
  }

  if (target.id === "admin-sync-to") {
    state.admin.syncForm.to = target.value;
    return;
  }

  if (target.id === "admin-sync-max-games") {
    state.admin.syncForm.maxGames = target.value;
  }
}

function handleClick(target) {
  if (state.ui.panels.gearMenuOpen && !target.closest("#toggle-gear-menu") && !target.closest("#gear-menu")) {
    state.ui.panels.gearMenuOpen = false;
    // continue handling the click below
  }

  if (target.id === "open-command-palette") {
    state.palette.open = true;
    render();
    window.setTimeout(() => document.querySelector("#command-palette-input")?.focus(), 0);
    return;
  }

  if (target.id === "toggle-filters-panel") {
    toggleUiPanel("filtersOpen");
    return;
  }

  if (target.id === "toggle-advanced-filters") {
    toggleUiPanel("advancedFiltersOpen");
    return;
  }

  if (target.id === "toggle-presets-panel") {
    toggleUiPanel("presetsOpen");
    return;
  }

  if (target.id === "toggle-exports-panel") {
    toggleUiPanel("exportsOpen");
    return;
  }

  if (target.id === "reset-filters") {
    resetFilters();
    return;
  }

  if (target.closest("#toggle-sidebar")) {
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    persistSidebarPreference();
    render();
    return;
  }

  if (target.id === "close-sidebar-mobile") {
    state.ui.sidebarCollapsed = true;
    persistSidebarPreference();
    render();
    return;
  }

  if (target.closest("#toggle-gear-menu")) {
    state.ui.panels.gearMenuOpen = !state.ui.panels.gearMenuOpen;
    render();
    return;
  }

  if (target.id === "close-gear-menu") {
    state.ui.panels.gearMenuOpen = false;
    render();
    return;
  }

  if (target.id === "toggle-filter-drawer") {
    toggleUiPanel("filterDrawerOpen");
    return;
  }

  if (target.id === "close-filter-drawer" || target.id === "filter-drawer-backdrop") {
    state.ui.panels.filterDrawerOpen = false;
    render();
    return;
  }

  if (target.id === "toggle-theme") {
    toggleTheme();
    return;
  }

  if (target.id === "toggle-nav-dropdown") {
    state.ui.panels.navExpanded = !state.ui.panels.navExpanded;
    render();
    return;
  }

  if (target.id === "admin-refresh") {
    refreshAdminPanel();
    return;
  }

  if (target.id === "quick-sync-btn") {
    quickSync();
    return;
  }

  if (target.id === "admin-sync") {
    runManualSync();
    return;
  }

  if (target.id === "admin-login") {
    signInAdmin();
    return;
  }

  if (target.id === "copy-share-link") {
    copyShareLink();
    return;
  }

  if (target.id === "export-current-view") {
    exportCurrentViewCsv();
    return;
  }

  if (target.id === "export-current-report") {
    exportCurrentViewReport();
    return;
  }

  if (target.id === "print-current-report") {
    printCurrentViewReport();
    return;
  }

  if (target.id === "apply-preset") {
    applySelectedPreset();
    return;
  }

  if (target.id === "save-preset") {
    saveCurrentPreset();
    return;
  }

  if (target.id === "delete-preset") {
    deleteSelectedPreset();
    return;
  }

  if (target.id === "open-ref-profile") {
    openRefereeProfile(state.focus.refereeId);
    return;
  }

  if (target.id === "evidence-close") {
    state.video.drawerOpen = false;
    render();
    return;
  }

  if (target.id === "evidence-add-queue") {
    addEvidenceToQueue(state.video.active);
    state.ui.message = "Added play to the review queue.";
    render();
    return;
  }

  if (target.id === "evidence-bookmark-toggle") {
    toggleEvidenceBookmark(state.video.active);
    return;
  }

  if (target.id === "back-to-ref-lens") {
    if (state.focus.profileRefereeId !== "all") {
      state.focus.refereeId = state.focus.profileRefereeId;
    }
    navigateToView("referees", { pushHistory: true });
    return;
  }

  const profileRefButton = target.closest("[data-profile-referee]");
  if (profileRefButton) {
    openRefereeProfile(profileRefButton.dataset.profileReferee);
    return;
  }

  const openGameButton = target.closest("[data-open-game]");
  if (openGameButton) {
    state.filters.gameId = openGameButton.dataset.openGame;
    navigateToView("games", { pushHistory: true });
    return;
  }

  const biasModeButton = target.closest("[data-bias-mode]");
  if (biasModeButton) {
    state.focus.biasMode = biasModeButton.dataset.biasMode;
  }

  const evidenceButton = target.closest("[data-open-evidence]");
  if (evidenceButton) {
    openEvidenceDrawerByIds(
      evidenceButton.dataset.openEvidence,
      evidenceButton.dataset.openEvidenceChallenge || "",
    );
    return;
  }

  const evidenceRemoveButton = target.closest("[data-remove-evidence-queue]");
  if (evidenceRemoveButton) {
    removeEvidenceQueueItem(evidenceRemoveButton.dataset.removeEvidenceQueue);
    render();
    return;
  }

  if (target.id === "evidence-drawer-backdrop") {
    state.video.drawerOpen = false;
    render();
    return;
  }

  if (target.id === "command-palette-backdrop") {
    state.palette.open = false;
    render();
    return;
  }

  const paletteButton = target.closest("[data-palette-index]");
  if (paletteButton) {
    const actions = getPaletteActions();
    const action = actions[Number(paletteButton.dataset.paletteIndex)];
    if (action) {
      action.run();
      render();
    }
    return;
  }

  const presetButton = target.closest("[data-apply-preset-id]");
  if (presetButton) {
    state.presets.selectedId = presetButton.dataset.applyPresetId;
    applySelectedPreset();
    return;
  }

  if (target.id === "admin-logout") {
    signOutAdmin();
    return;
  }

  const navGroupButton = target.closest("[data-view-group]");
  if (navGroupButton) {
    const nextGroup = navigationGroups.find((group) => group.key === navGroupButton.dataset.viewGroup);
    if (!nextGroup) return;
    const isSameGroup = state.ui.navGroup === nextGroup.key;
    state.ui.navGroup = nextGroup.key;
    state.ui.panels.navExpanded = isSameGroup ? !state.ui.panels.navExpanded : true;
    render();
    return;
  }

  const tab = target.closest("[data-view]");
  if (!tab) return;
  navigateToView(tab.dataset.view, { pushHistory: true });
}

async function bootstrap() {
  try {
    try {
      state.admin.loginToken = window.localStorage.getItem(legacyAdminTokenStorageKey) || "";
      window.localStorage.removeItem(legacyAdminTokenStorageKey);
    } catch {
      state.admin.loginToken = "";
    }
    loadThemePreference();
    loadSidebarPreference();
    loadSavedPresets();
    loadEvidenceBookmarks();
    state.presets.selectedId = state.presets.items[0]?.id || "";
    applyLocationState();
    await Promise.all([loadDataset({ includeRawPlayByPlay: false }), loadAdminStatus()]);
    syncLocationState();
    render();
    if (viewNeedsRawPlayByPlay(state.view)) {
      ensureRawPlayByPlayLoaded();
    }
  } catch (error) {
    app.innerHTML = `
      <section class="loading-card is-error">
        <p>Unable to load WhistleIQ.</p>
        <p class="error-detail">${error instanceof Error ? error.message : String(error)}</p>
      </section>
    `;
  }
}

document.addEventListener("change", (event) => handleChange(event.target));
document.addEventListener("click", (event) => handleClick(event.target));
document.addEventListener("input", (event) => handleInput(event.target));
document.addEventListener("mouseover", (event) => handleNavigationHover(event.target));
document.addEventListener("mouseout", (event) => handleNavigationMouseOut(event));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.ui.panels.filterDrawerOpen) {
    state.ui.panels.filterDrawerOpen = false;
    render();
    return;
  }

  if (event.key === "Escape" && state.ui.panels.gearMenuOpen) {
    state.ui.panels.gearMenuOpen = false;
    render();
    return;
  }

  if (event.key === "Escape" && state.ui.panels.navExpanded) {
    state.ui.panels.navExpanded = false;
    render();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    state.palette.open = !state.palette.open;
    if (!state.palette.open) {
      state.palette.query = "";
      state.palette.selectedIndex = 0;
    }
    render();
    if (state.palette.open) {
      window.setTimeout(() => document.querySelector("#command-palette-input")?.focus(), 0);
    }
    return;
  }

  if (!state.palette.open) return;

  if (event.key === "Escape") {
    state.palette.open = false;
    state.palette.query = "";
    state.palette.selectedIndex = 0;
    render();
    return;
  }

  const actions = getPaletteActions();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.palette.selectedIndex = Math.min(state.palette.selectedIndex + 1, Math.max(actions.length - 1, 0));
    render();
    document.querySelector("#command-palette-input")?.focus();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.palette.selectedIndex = Math.max(state.palette.selectedIndex - 1, 0);
    render();
    document.querySelector("#command-palette-input")?.focus();
    return;
  }

  if (event.key === "Enter") {
    if (document.activeElement?.id === "command-palette-input") {
      event.preventDefault();
      const action = actions[state.palette.selectedIndex];
      if (action) {
        action.run();
        render();
      }
    }
  }
});
window.addEventListener("popstate", () => {
  applyLocationState();
  if (state.view === "admin") {
    refreshAdminPanel();
    return;
  }
  render();
  if (viewNeedsRawPlayByPlay(state.view)) {
    ensureRawPlayByPlayLoaded();
  }
});

bootstrap();

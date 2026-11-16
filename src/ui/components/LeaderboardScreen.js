/**
 * LeaderboardScreen.js
 *
 * Task 72: Leaderboard display screen — a standalone full-screen component
 * showing the per-ruleset personal records and top-score table stored by
 * LeaderboardManager (Task 70 data model, Task 71 update logic).
 *
 * Fits into the router's navigation tree as: Main Menu → Statistics →
 * Leaderboard (StatisticsScreen gained an optional `onLeaderboard` button in
 * this task, since MainMenu.js has no leaderboard slot of its own).
 *
 * What this module owns:
 *   - The "Leaderboard" headline.
 *   - Ruleset tabs (`role="tablist"`) — one per ruleset — shown only when
 *     there is more than one ruleset to choose between. Clicking a tab
 *     re-renders the screen for that ruleset.
 *   - A "Personal Records" key/value grid for the selected ruleset:
 *       Highest Score      — value, plus "<difficulty> · <n>P" detail
 *       Fastest Win        — "<n> hands", plus "<score> pts · <difficulty> · <n>P"
 *       Current Win Streak — number
 *       Longest Win Streak — number
 *     Records that don't exist yet show "—".
 *   - A "Top Scores" ranked list for the selected ruleset (rank, score,
 *     difficulty, player count, hands played when known, date). An empty
 *     ruleset shows a short empty-state message instead.
 *   - A "Clear Leaderboard" button with the same two-step confirmation as
 *     StatisticsScreen's Reset: first click → "Tap again to confirm clear";
 *     second click → `leaderboardManager.clearAll()` and a re-render. This
 *     clears EVERY ruleset (clearAll() is table-wide) — the button label says
 *     "Clear All" when more than one ruleset is shown so that's not a surprise.
 *   - A "Back" button that calls `options.onBack`.
 *
 * What this module deliberately does NOT own:
 *   - Routing — the caller wires `onBack`.
 *   - Which rulesets / labels exist — passed in via `options.rulesets`, so
 *     this module needs no change as Riichi / Chinese Official come online
 *     (same "caller decides availability" approach as RuleSelection.js).
 *     When omitted, rulesets are derived from whatever the stored data
 *     contains, labelled by their raw ids.
 *   - Storage — data is read fresh from the manager on every render; the
 *     only mutation is `clearAll()`.
 *
 * API:
 *   renderLeaderboardScreen(container, leaderboardManager, options)
 *     - container:            DOM Element — rendered into as a child; the
 *                             container's own className is never modified.
 *     - leaderboardManager:   LeaderboardManager instance (Tasks 70–71).
 *     - options.onBack:       () => void — required.
 *     - options.rulesets:     Array<{ id: string, label: string }> — tabs, in order.
 *     - options.initialRulesetId: string — tab selected first (default: first ruleset).
 *     - options.difficultyLabels: Object<string,string> — display names for
 *                             difficulty ids (default: the raw id, capitalised).
 *     - options.maxRows:      positive integer — rows shown in Top Scores
 *                             (default LEADERBOARD_MAX_ENTRIES).
 *   Returns the `.leaderboard-screen` panel element.
 */

import { LeaderboardManager, LEADERBOARD_MAX_ENTRIES } from '../../persistence/LeaderboardManager.js';

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Renders the leaderboard screen inside `container`.
 *
 * @param {Element} container
 * @param {LeaderboardManager} leaderboardManager
 * @param {Object} options
 * @param {function(): void} options.onBack
 * @param {{id: string, label: string}[]} [options.rulesets]
 * @param {string} [options.initialRulesetId]
 * @param {Object<string, string>} [options.difficultyLabels]
 * @param {number} [options.maxRows]
 * @returns {Element} the `.leaderboard-screen` panel
 */
export function renderLeaderboardScreen(container, leaderboardManager, options = {}) {
  _assertContainer(container);
  _assertLeaderboardManager(leaderboardManager);

  const onBack = typeof options.onBack === 'function' ? options.onBack : null;
  if (!onBack) {
    throw new TypeError('[LeaderboardScreen] options.onBack callback is required.');
  }

  const suppliedRulesets = _normalizeRulesets(options.rulesets);
  const maxRows = options.maxRows === undefined ? LEADERBOARD_MAX_ENTRIES : options.maxRows;
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new TypeError(`[LeaderboardScreen] options.maxRows must be a positive integer; got ${maxRows}.`);
  }
  const difficultyLabels =
    options.difficultyLabels && typeof options.difficultyLabels === 'object' ? options.difficultyLabels : {};

  const ctx = {
    container,
    leaderboardManager,
    onBack,
    suppliedRulesets,
    difficultyLabels,
    maxRows,
    selectedRulesetId: typeof options.initialRulesetId === 'string' ? options.initialRulesetId : null,
  };
  return _doRender(ctx);
}

// -----------------------------------------------------------------------
// Pure formatting helpers (exported for unit tests)
// -----------------------------------------------------------------------

/**
 * Formats a difficulty id for display: explicit label if supplied, else the
 * id with its first letter capitalised ("basic" → "Basic").
 * @param {string} difficulty
 * @param {Object<string,string>} [labels]
 * @returns {string}
 */
export function formatDifficulty(difficulty, labels = {}) {
  if (typeof difficulty !== 'string' || difficulty === '') return '—';
  if (typeof labels[difficulty] === 'string') return labels[difficulty];
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/**
 * Formats an ISO timestamp as a short local date, or "—" when invalid.
 * @param {string} iso
 * @returns {string}
 */
export function formatEntryDate(iso) {
  if (typeof iso !== 'string') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Builds the four record rows for one ruleset's records object.
 * @param {Object} records  LeaderboardManager#getRecords() result
 * @param {Object<string,string>} [difficultyLabels]
 * @returns {{ key: string, label: string, value: string, detail: string }[]}
 */
export function buildRecordRows(records, difficultyLabels = {}) {
  const hs = records?.highestScore ?? null;
  const fw = records?.fastestWin ?? null;
  const ctxDetail = (r) => `${formatDifficulty(r.difficulty, difficultyLabels)} · ${r.playerCount}P`;

  return [
    {
      key: 'highestScore',
      label: 'Highest Score',
      value: hs ? String(hs.value) : '—',
      detail: hs ? ctxDetail(hs) : '',
    },
    {
      key: 'fastestWin',
      label: 'Fastest Win',
      value: fw ? `${fw.value} ${fw.value === 1 ? 'hand' : 'hands'}` : '—',
      detail: fw ? `${fw.score} pts · ${ctxDetail(fw)}` : '',
    },
    {
      key: 'currentWinStreak',
      label: 'Current Win Streak',
      value: String(records?.currentWinStreak ?? 0),
      detail: '',
    },
    {
      key: 'longestWinStreak',
      label: 'Longest Win Streak',
      value: String(records?.longestWinStreak ?? 0),
      detail: '',
    },
  ];
}

// -----------------------------------------------------------------------
// Core render
// -----------------------------------------------------------------------

/** @private */
function _doRender(ctx) {
  const { container, leaderboardManager } = ctx;
  container.innerHTML = '';

  const rulesets = _resolveRulesets(ctx);
  if (!rulesets.some((r) => r.id === ctx.selectedRulesetId)) {
    ctx.selectedRulesetId = rulesets.length > 0 ? rulesets[0].id : null;
  }
  const selected = rulesets.find((r) => r.id === ctx.selectedRulesetId) ?? null;

  const panel = document.createElement('div');
  panel.className = 'leaderboard-screen';
  container.appendChild(panel);

  _renderHeader(panel, selected, rulesets.length);

  if (rulesets.length > 1) {
    _renderTabs(panel, rulesets, ctx);
  }

  if (selected) {
    _renderRecords(panel, leaderboardManager.getRecords(selected.id), ctx.difficultyLabels);
    _renderTopScores(panel, leaderboardManager.getTopEntries(ctx.maxRows, { rulesetId: selected.id }), selected, ctx.difficultyLabels);
  } else {
    _renderEmpty(panel, 'No games recorded yet. Finish a game to set your first record.');
  }

  _renderActions(panel, {
    clearLabel: rulesets.length > 1 ? 'Clear All Leaderboards' : 'Clear Leaderboard',
    onBack: ctx.onBack,
    onClear() {
      leaderboardManager.clearAll();
      _doRender(ctx);
    },
  });

  return panel;
}

// -----------------------------------------------------------------------
// Header + tabs
// -----------------------------------------------------------------------

/** @private */
function _renderHeader(panel, selected, rulesetCount) {
  const header = document.createElement('div');
  header.className = 'leaderboard-screen-header';

  const title = document.createElement('h1');
  title.className = 'leaderboard-screen-title';
  title.textContent = 'Leaderboard';
  header.appendChild(title);

  // With a single ruleset there are no tabs, so name it in a subtitle.
  if (selected && rulesetCount === 1) {
    const subtitle = document.createElement('p');
    subtitle.className = 'leaderboard-screen-subtitle';
    subtitle.textContent = selected.label;
    header.appendChild(subtitle);
  }

  panel.appendChild(header);
}

/** @private */
function _renderTabs(panel, rulesets, ctx) {
  const tablist = document.createElement('div');
  tablist.className = 'leaderboard-screen-tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Ruleset');

  for (const ruleset of rulesets) {
    const isSelected = ruleset.id === ctx.selectedRulesetId;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'leaderboard-screen-tab' + (isSelected ? ' leaderboard-screen-tab--selected' : '');
    tab.textContent = ruleset.label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    tab.setAttribute('data-ruleset-id', ruleset.id);
    tab.addEventListener('click', () => {
      if (ctx.selectedRulesetId === ruleset.id) return;
      ctx.selectedRulesetId = ruleset.id;
      _doRender(ctx);
    });
    tablist.appendChild(tab);
  }

  panel.appendChild(tablist);
}

// -----------------------------------------------------------------------
// Records
// -----------------------------------------------------------------------

/** @private */
function _renderRecords(panel, records, difficultyLabels) {
  const section = _makeSection(panel, 'Personal Records');

  const grid = document.createElement('dl');
  grid.className = 'leaderboard-screen-records';

  for (const row of buildRecordRows(records, difficultyLabels)) {
    const dt = document.createElement('dt');
    dt.className = 'leaderboard-screen-record-label';
    dt.textContent = row.label;
    grid.appendChild(dt);

    const dd = document.createElement('dd');
    dd.className = 'leaderboard-screen-record-value';
    dd.setAttribute('data-record', row.key);

    const value = document.createElement('span');
    value.className = 'leaderboard-screen-record-number';
    value.textContent = row.value;
    dd.appendChild(value);

    if (row.detail) {
      const detail = document.createElement('span');
      detail.className = 'leaderboard-screen-record-detail';
      detail.textContent = row.detail;
      dd.appendChild(detail);
    }
    grid.appendChild(dd);
  }

  section.appendChild(grid);
}

// -----------------------------------------------------------------------
// Top scores
// -----------------------------------------------------------------------

/** @private */
function _renderTopScores(panel, entries, ruleset, difficultyLabels) {
  const section = _makeSection(panel, 'Top Scores');

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'leaderboard-screen-empty';
    empty.textContent = `No ${ruleset.label} games recorded yet.`;
    section.appendChild(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'leaderboard-screen-list';

  entries.forEach((entry, i) => {
    const rank = i + 1;
    const row = document.createElement('li');
    row.className = 'leaderboard-screen-row' + (rank === 1 ? ' leaderboard-screen-row--first' : '');

    const rankEl = document.createElement('span');
    rankEl.className = 'leaderboard-screen-rank';
    rankEl.textContent = String(rank);
    row.appendChild(rankEl);

    const info = document.createElement('span');
    info.className = 'leaderboard-screen-info';

    const meta = document.createElement('span');
    meta.className = 'leaderboard-screen-meta';
    const parts = [formatDifficulty(entry.difficulty, difficultyLabels), `${entry.playerCount}P`];
    if (Number.isInteger(entry.handsPlayed)) {
      parts.push(`${entry.handsPlayed} ${entry.handsPlayed === 1 ? 'hand' : 'hands'}`);
    }
    meta.textContent = parts.join(' · ');
    info.appendChild(meta);

    const date = document.createElement('span');
    date.className = 'leaderboard-screen-date';
    date.textContent = formatEntryDate(entry.addedAt);
    info.appendChild(date);

    row.appendChild(info);

    const score = document.createElement('span');
    score.className = 'leaderboard-screen-score';
    score.textContent = String(entry.score);
    row.appendChild(score);

    list.appendChild(row);
  });

  section.appendChild(list);
}

/** @private */
function _renderEmpty(panel, text) {
  const empty = document.createElement('p');
  empty.className = 'leaderboard-screen-empty';
  empty.textContent = text;
  panel.appendChild(empty);
}

/** @private */
function _makeSection(panel, heading) {
  const section = document.createElement('section');
  section.className = 'leaderboard-screen-section';

  const h2 = document.createElement('h2');
  h2.className = 'leaderboard-screen-section-heading';
  h2.textContent = heading;
  section.appendChild(h2);

  panel.appendChild(section);
  return section;
}

// -----------------------------------------------------------------------
// Actions (Clear with confirmation + Back)
// -----------------------------------------------------------------------

/** @private */
function _renderActions(panel, { clearLabel, onBack, onClear }) {
  const actions = document.createElement('div');
  actions.className = 'leaderboard-screen-actions';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'leaderboard-screen-btn leaderboard-screen-btn--danger';
  clearBtn.textContent = clearLabel;

  let awaitingConfirm = false;
  clearBtn.addEventListener('click', () => {
    if (!awaitingConfirm) {
      awaitingConfirm = true;
      clearBtn.textContent = 'Tap again to confirm clear';
      clearBtn.classList.add('leaderboard-screen-btn--confirm');
    } else {
      onClear();
    }
  });
  actions.appendChild(clearBtn);

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'leaderboard-screen-btn leaderboard-screen-btn--primary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', onBack);
  actions.appendChild(backBtn);

  panel.appendChild(actions);
}

// -----------------------------------------------------------------------
// Ruleset resolution
// -----------------------------------------------------------------------

/**
 * Validates `options.rulesets`. Returns null when omitted (→ derive from data).
 * @private
 */
function _normalizeRulesets(rulesets) {
  if (rulesets === undefined || rulesets === null) return null;
  if (!Array.isArray(rulesets)) {
    throw new TypeError('[LeaderboardScreen] options.rulesets must be an array of { id, label }.');
  }
  const seen = new Set();
  return rulesets.map((r, i) => {
    if (!r || typeof r.id !== 'string' || r.id === '') {
      throw new TypeError(`[LeaderboardScreen] options.rulesets[${i}].id must be a non-empty string.`);
    }
    if (seen.has(r.id)) {
      throw new TypeError(`[LeaderboardScreen] options.rulesets contains duplicate id "${r.id}".`);
    }
    seen.add(r.id);
    return { id: r.id, label: typeof r.label === 'string' && r.label !== '' ? r.label : r.id };
  });
}

/**
 * The tab list: the caller's rulesets when supplied, else every ruleset that
 * appears in stored entries or records (raw ids as labels).
 * @private
 */
function _resolveRulesets(ctx) {
  if (ctx.suppliedRulesets) return ctx.suppliedRulesets;
  const ids = new Set(Object.keys(ctx.leaderboardManager.getAllRecords()));
  for (const e of ctx.leaderboardManager.getEntries()) {
    if (typeof e?.rulesetId === 'string') ids.add(e.rulesetId);
  }
  return [...ids].map((id) => ({ id, label: id }));
}

// -----------------------------------------------------------------------
// Guards
// -----------------------------------------------------------------------

/** @private */
function _assertContainer(container) {
  if (!(container instanceof Element)) {
    throw new TypeError('[LeaderboardScreen] container must be a DOM Element.');
  }
}

/** @private */
function _assertLeaderboardManager(lm) {
  if (!(lm instanceof LeaderboardManager)) {
    throw new TypeError('[LeaderboardScreen] leaderboardManager must be a LeaderboardManager instance.');
  }
}

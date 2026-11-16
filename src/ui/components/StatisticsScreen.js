/**
 * StatisticsScreen.js
 *
 * Task 69: Statistics display screen — a standalone full-screen component
 * that shows the player's lifetime statistics stored by StatisticsManager
 * (Task 67) and wired into the game loop in Task 68.
 *
 * Fits into the router's navigation tree as: Main Menu → Statistics.
 * The only action is "Back" (returns the caller to whatever invoked it —
 * normally the main menu).
 *
 * What this module owns:
 *   - The "Statistics" headline.
 *   - Four stat sections, each displayed as a labelled key-value grid:
 *       Games   — gamesPlayed, gamesWon, gamesLost, gamesDrawn, win rate
 *       Hands   — handsPlayed, handsWon, tsumoWins, ronWins
 *       Streaks — currentWinStreak, longestWinStreak
 *       Fan     — totalFanEarned, highestFanHand
 *   - A "Win Rate" derived display: gamesWon ÷ gamesPlayed, shown as a
 *     percentage (one decimal place) or "—" when no games have been played.
 *   - A "Reset Statistics" button with a two-step confirmation: the first
 *     click changes the button text to "Tap again to confirm reset"; a
 *     second click on the now-confirming button calls `resetAll()` and
 *     re-renders the screen with zeroed values.
 *   - A "Back" button that calls `options.onBack`.
 *
 * What this module deliberately does NOT own:
 *   - Routing — the caller wires `onBack` to the appropriate navigator.
 *   - Storage — it reads stats once from `statisticsManager.getAll()` on
 *     each render, then passes all mutations through `statisticsManager`.
 *   - Any per-session or per-hand history breakdown — that is for a future
 *     History screen.
 *
 * API:
 *   renderStatisticsScreen(container, statisticsManager, options)
 *     - container:          DOM Element — rendered into as a child, following
 *                           the same "modify container's children, not its
 *                           className" convention as every other screen.
 *     - statisticsManager:  StatisticsManager instance (from Task 67).
 *     - options.onBack:     () => void — required; fires when "Back" is clicked.
 *     - options.onLeaderboard: () => void — optional (Task 72); when supplied a
 *                           "Leaderboard" button is rendered above Back. Omitted,
 *                           the screen renders exactly as it did at Task 69.
 */

import { StatisticsManager } from '../../persistence/StatisticsManager.js';

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Renders the statistics screen inside `container`.
 *
 * @param {Element} container
 * @param {StatisticsManager} statisticsManager
 * @param {Object}   [options]
 * @param {function(): void} options.onBack  Called when the Back button is clicked.
 * @param {function(): void} [options.onLeaderboard]  Task 72: shows a Leaderboard button when supplied.
 */
export function renderStatisticsScreen(container, statisticsManager, options = {}) {
  _assertContainer(container);
  _assertStatisticsManager(statisticsManager);

  const onBack = typeof options.onBack === 'function' ? options.onBack : null;
  if (!onBack) {
    throw new TypeError('[StatisticsScreen] options.onBack callback is required.');
  }

  const onLeaderboard = typeof options.onLeaderboard === 'function' ? options.onLeaderboard : null;

  _doRender(container, statisticsManager, onBack, onLeaderboard);
}

// -----------------------------------------------------------------------
// Core render (called once initially and again after a reset)
// -----------------------------------------------------------------------

/** @private */
function _doRender(container, statisticsManager, onBack, onLeaderboard = null) {
  container.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'statistics-screen';
  container.appendChild(panel);

  const stats = statisticsManager.getAll();

  _renderHeader(panel);
  _renderStatSections(panel, stats);
  _renderActions(panel, {
    onBack,
    onLeaderboard,
    onReset() {
      statisticsManager.resetAll();
      _doRender(container, statisticsManager, onBack, onLeaderboard);
    },
  });
}

// -----------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------

/** @private */
function _renderHeader(panel) {
  const header = document.createElement('div');
  header.className = 'statistics-screen-header';

  const title = document.createElement('h1');
  title.className = 'statistics-screen-title';
  title.textContent = 'Statistics';
  header.appendChild(title);

  panel.appendChild(header);
}

// -----------------------------------------------------------------------
// Stat sections
// -----------------------------------------------------------------------

/**
 * @private
 * @typedef {{ label: string, value: string }} StatRow
 * @typedef {{ heading: string, rows: StatRow[] }} StatSection
 */

/** @private */
function _renderStatSections(panel, stats) {
  const sections = _buildSections(stats);

  for (const { heading, rows } of sections) {
    const section = document.createElement('div');
    section.className = 'statistics-screen-section';

    const h2 = document.createElement('h2');
    h2.className = 'statistics-screen-section-heading';
    h2.textContent = heading;
    section.appendChild(h2);

    const grid = document.createElement('dl');
    grid.className = 'statistics-screen-grid';

    for (const { label, value } of rows) {
      const dt = document.createElement('dt');
      dt.className = 'statistics-screen-label';
      dt.textContent = label;
      grid.appendChild(dt);

      const dd = document.createElement('dd');
      dd.className = 'statistics-screen-value';
      dd.textContent = value;
      grid.appendChild(dd);
    }

    section.appendChild(grid);
    panel.appendChild(section);
  }
}

/**
 * Builds the ordered list of display sections from a raw stats object.
 * @private
 * @param {Object.<string, number>} stats  Result of StatisticsManager.getAll()
 * @returns {StatSection[]}
 */
function _buildSections(stats) {
  const winRate =
    stats.gamesPlayed > 0
      ? `${((stats.gamesWon / stats.gamesPlayed) * 100).toFixed(1)}%`
      : '—';

  return [
    {
      heading: 'Games',
      rows: [
        { label: 'Played',   value: String(stats.gamesPlayed) },
        { label: 'Won',      value: String(stats.gamesWon) },
        { label: 'Lost',     value: String(stats.gamesLost) },
        { label: 'Drawn',    value: String(stats.gamesDrawn) },
        { label: 'Win Rate', value: winRate },
      ],
    },
    {
      heading: 'Hands',
      rows: [
        { label: 'Played',    value: String(stats.handsPlayed) },
        { label: 'Won',       value: String(stats.handsWon) },
        { label: 'Tsumo Wins', value: String(stats.tsumoWins) },
        { label: 'Ron Wins',  value: String(stats.ronWins) },
      ],
    },
    {
      heading: 'Streaks',
      rows: [
        { label: 'Current Win Streak', value: String(stats.currentWinStreak) },
        { label: 'Longest Win Streak', value: String(stats.longestWinStreak) },
      ],
    },
    {
      heading: 'Fan Records',
      rows: [
        { label: 'Total Fan Earned',  value: String(stats.totalFanEarned) },
        { label: 'Highest Fan Hand',  value: String(stats.highestFanHand) },
      ],
    },
  ];
}

// -----------------------------------------------------------------------
// Action buttons (Back + Reset with confirmation)
// -----------------------------------------------------------------------

/** @private */
function _renderActions(panel, { onBack, onLeaderboard, onReset }) {
  const actions = document.createElement('div');
  actions.className = 'statistics-screen-actions';

  // Reset Statistics — two-step confirmation.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'statistics-screen-btn statistics-screen-btn--danger';
  resetBtn.textContent = 'Reset Statistics';

  let awaitingConfirm = false;
  resetBtn.addEventListener('click', () => {
    if (!awaitingConfirm) {
      awaitingConfirm = true;
      resetBtn.textContent = 'Tap again to confirm reset';
      resetBtn.classList.add('statistics-screen-btn--confirm');
    } else {
      onReset();
    }
  });
  actions.appendChild(resetBtn);

  // Leaderboard button (Task 72) — secondary, only when wired by the caller.
  if (onLeaderboard) {
    const leaderboardBtn = document.createElement('button');
    leaderboardBtn.type = 'button';
    leaderboardBtn.className = 'statistics-screen-btn statistics-screen-btn--secondary';
    leaderboardBtn.textContent = 'Leaderboard';
    leaderboardBtn.addEventListener('click', onLeaderboard);
    actions.appendChild(leaderboardBtn);
  }

  // Back button — primary action.
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'statistics-screen-btn statistics-screen-btn--primary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', onBack);
  actions.appendChild(backBtn);

  panel.appendChild(actions);
}

// -----------------------------------------------------------------------
// Guards
// -----------------------------------------------------------------------

/** @private */
function _assertContainer(container) {
  if (!(container instanceof Element)) {
    throw new TypeError('[StatisticsScreen] container must be a DOM Element.');
  }
}

/** @private */
function _assertStatisticsManager(sm) {
  if (!(sm instanceof StatisticsManager)) {
    throw new TypeError(
      '[StatisticsScreen] statisticsManager must be a StatisticsManager instance.'
    );
  }
}

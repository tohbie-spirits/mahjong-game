/**
 * main.js
 *
 * The single entry point loaded by index.html (`<script type="module" src="src/main.js">`).
 *
 *   1. Verify the environment the app needs is actually available.
 *   2. Install global error handling so failures are visible and logged
 *      consistently, rather than silently swallowed by the browser.
 *   3. Confirm the EventBus is wired up correctly end-to-end in a real
 *      browser (as opposed to the Node-based tests used during development).
 *   4. Start the app: Main Menu → New Game wizard → GameScreen → EndGameScreen.
 *
 * Task 56 replaces this file's former temporary boot-confirmation view
 * (every screen component before this task — MainMenu through
 * DifficultySelection — had nowhere to navigate TO yet) with the actual
 * screen router this comment always said was coming. It's a plain
 * function-based switcher living right here rather than its own module:
 * the project plan never reserved a dedicated router file, and "wiring
 * together already-built, independently-tested screens" is exactly
 * main.js's own job description above. Every screen it calls into
 * (MainMenu, RuleSelection, PlayerCountSelection, DifficultySelection,
 * GameScreen) is itself fully unit-tested in isolation — see
 * tests/ui/components/ — so this file's only real responsibility is
 * sequencing the handful of callbacks between them correctly, which is
 * too tied to a live DOM + full module graph to be worth a separate
 * test file of its own (matching every prior task's note that main.js
 * itself has no dedicated tests).
 *
 * WHICH rulesets/difficulties are offered as selectable is decided
 * here, not by RuleSelection.js/DifficultySelection.js themselves (see
 * their own doc comments). Rulesets: Task 102 — all three are live (Hong
 * Kong, Riichi, Chinese Official). Each factory takes { playerCount } so the
 * 3-player variants get their own engine options (Riichi sanma tiles and
 * settlement, Chinese Official three-seat play); GameSnapshot passes the
 * saved table's player count when restoring.
 *
 * Task 79: AI difficulties come from src/ai/StrategyRegistry.js, which
 * now offers Basic AND Advanced. The picker enables exactly the tiers the
 * registry can build; the game's AIManager is built from the seats' own
 * difficulties (createAIManagerForSeats), and GameManager checks it covers
 * every AI seat. The tier picked last is pre-selected the next time the
 * wizard reaches the difficulty step (session only, not persisted).
 */

import { gameEventBus } from './core/EventBus.js';
import { RULESET_ID, AI_DIFFICULTY_LABEL } from './utils/constants.js';
import { renderMainMenu } from './ui/components/MainMenu.js';
import { renderRuleSelection } from './ui/components/RuleSelection.js';
import { renderPlayerCountSelection } from './ui/components/PlayerCountSelection.js';
import { renderDifficultySelection } from './ui/components/DifficultySelection.js';
import { renderGameScreen, deriveGameResult } from './ui/components/GameScreen.js';
import { renderEndGameScreen } from './ui/components/EndGameScreen.js';
import { renderStatisticsScreen } from './ui/components/StatisticsScreen.js';
import { renderLeaderboardScreen } from './ui/components/LeaderboardScreen.js';
import { renderSettingsMenu } from './ui/components/SettingsMenu.js';
import { SettingsManager, SETTING_KEYS } from './persistence/SettingsManager.js';
import { AnimationEngine } from './ui/AnimationEngine.js';
import { AudioManager } from './audio/AudioManager.js';
import { MusicPlayer } from './audio/MusicPlayer.js';
import { renderAppToolbar } from './ui/components/AppToolbar.js';
import { FullscreenManager } from './ui/FullscreenManager.js';
import { createAnnouncer } from './ui/Announcer.js';
import { HintAdvisor } from './ai/HintAdvisor.js';
import { RULESET_LABEL } from './utils/constants.js';
import { GameManager } from './core/GameManager.js';
import { HongKongRules } from './rules/hongkong/HongKongRules.js';
import { RiichiRules } from './rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from './rules/chineseOfficial/ChineseOfficialRules.js';
import { getHongKongReference } from './rules/hongkong/HongKongReference.js';
import { getRiichiReference } from './rules/riichi/RiichiReference.js';
import { getChineseOfficialReference } from './rules/chineseOfficial/ChineseOfficialReference.js';
import { renderRuleReferenceScreen } from './ui/components/RuleReferenceScreen.js';
import { renderTutorialScreen } from './ui/components/TutorialScreen.js';
import { STRATEGY_FACTORIES, getAvailableDifficulties, buildPlayerConfigs, createAIManagerForSeats } from './ai/StrategyRegistry.js';
import { StorageManager } from './persistence/StorageManager.js';
import { SaveGameManager } from './persistence/SaveGameManager.js';
import { StatisticsManager } from './persistence/StatisticsManager.js';
import { buildSnapshot, hydrateGameManager } from './persistence/GameSnapshot.js';
import { LeaderboardManager } from './persistence/LeaderboardManager.js';

const APP_VERSION = '0.0.1-dev';

/**
 * Task 102: every ruleset is live. Factories take { playerCount } (3 or 4);
 * GameSnapshot#hydrateGameManager passes the saved table's count.
 */
const RULE_ENGINE_FACTORIES = Object.freeze({
  [RULESET_ID.HONG_KONG]: () => new HongKongRules(),
  [RULESET_ID.RIICHI]: ({ playerCount = 4 } = {}) => new RiichiRules({ playerCount }),
  [RULESET_ID.CHINESE_OFFICIAL]: ({ playerCount = 4 } = {}) => new ChineseOfficialRules({ playerCount }),
});

const HUMAN_SEAT_INDEX = 0;

/**
 * Task 114: the rules reference of each ruleset — data that lives with the
 * ruleset it describes (src/rules/<ruleset>/*Reference.js); the UI receives it
 * from here, the composition root, and never imports a ruleset itself.
 */
const RULE_REFERENCES = Object.freeze({
  [RULESET_ID.HONG_KONG]: getHongKongReference,
  [RULESET_ID.RIICHI]: getRiichiReference,
  [RULESET_ID.CHINESE_OFFICIAL]: getChineseOfficialReference,
});
const referenceFor = (rulesetId) => { try { return RULE_REFERENCES[rulesetId]?.() ?? null; } catch (e) { console.warn('[Mahjong] Rule reference unavailable:', e); return null; } };

/**
 * Installs window-level handlers so uncaught errors and unhandled promise
 * rejections are (a) logged consistently and (b) broadcast on the shared
 * EventBus, so a future error-reporting/telemetry-free debug overlay can
 * subscribe to 'app-error' without main.js needing to know it exists.
 */
function installGlobalErrorHandling() {
  window.addEventListener('error', (event) => {
    console.error('[Mahjong] Uncaught error:', event.error ?? event.message);
    gameEventBus.emit('app-error', {
      source: 'window.onerror',
      message: event.message,
      error: event.error ?? null,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Mahjong] Unhandled promise rejection:', event.reason);
    gameEventBus.emit('app-error', {
      source: 'unhandledrejection',
      message: event.reason?.message ?? String(event.reason),
      error: event.reason ?? null,
    });
  });
}

/**
 * Confirms the browser environment has what the app needs. Throws with a
 * clear message if something critical is missing, so `boot()` can turn
 * that into a visible fatal-error screen instead of a silent blank page.
 */
function assertEnvironmentSupport() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('This app must run in a browser environment.');
  }

  if (!('localStorage' in window)) {
    // The game is fully playable without storage working (settings/stats/
    // leaderboards simply won't persist), so this is a console warning,
    // not a fatal error — unlike a missing #app-root, which is fatal.
    console.warn(
      '[Mahjong] localStorage is not available. Settings, statistics, and leaderboards will not be saved between sessions.'
    );
  }
}

/**
 * Runs a short round-trip through the shared EventBus to confirm it is
 * wired correctly in an actual browser module context (this already has
 * unit-style coverage under Node — see Task 6 — this is a live smoke test).
 * @returns {boolean}
 */
function verifyEventBus() {
  let received = false;
  const unsubscribe = gameEventBus.once('__boot-smoke-test__', () => {
    received = true;
  });
  gameEventBus.emit('__boot-smoke-test__');
  unsubscribe(); // no-op if already fired, safe either way
  return received;
}

/**
 * Builds the screen router/wizard closed over a single `root` element.
 * Each `show*` function fully replaces whatever the previous screen
 * rendered and wires that screen's callbacks to whichever step comes
 * next. Returns the entry point (`showMainMenu`) for `boot()` to call.
 *
 * Every screen component clears its container's CHILDREN on render, but
 * each also adds its own root class (`main-menu`, `rule-selection`,
 * `game-screen`, ...) directly onto the container it's given and never
 * removes it — fine when a container is dedicated to one screen, but
 * this router reuses ONE root for all of them, so without a reset the
 * classes would accumulate (a manual boot smoke test showed `#app-root`
 * ending up with all five at once, which would apply every menu
 * screen's centered-flex/padding rules to the game table). `show()`
 * below wipes both children and classes before each screen renders.
 * @param {HTMLElement} root
 */
function createRouter(root) {
  // Single SaveGameManager instance for the whole session, shared by all
  // screen paths. Created once here rather than re-constructed every time
  // a screen renders — the StorageManager namespace is the same either way,
  // but sharing one instance avoids redundant migrate() calls.
  const storage = new StorageManager();
  const saveGame = new SaveGameManager(storage);
  const stats = new StatisticsManager(storage);
  const leaderboard = new LeaderboardManager(storage);
  const settings = new SettingsManager(storage);
  // Task 103: one animation engine for the app, following the Animations setting
  // (and the OS reduce-motion preference, which the engine watches itself).
  const animations = new AnimationEngine({ enabled: settings.get(SETTING_KEYS.ANIMATIONS_ENABLED) !== false });
  applyTheme(settings.get(SETTING_KEYS.THEME));
  applyMotion(settings.get(SETTING_KEYS.ANIMATIONS_ENABLED) !== false); // Task 107
  // Task 108: one audio manager for the app, following the volume / mute settings.
  const audio = new AudioManager();
  audio.syncWithSettings(settings);
  installAudioUnlock(audio);
  // Task 110: background music — a calm track on the menus, another at the table.
  const music = new MusicPlayer({ audio });
  // Task 110: the Sound button (top right, every screen); M toggles it. Muting is saved.
  const soundControl = {
    isMuted: () => audio.isMuted(),
    setMuted: (muted) => {
      try { settings.set(SETTING_KEYS.MUTED, muted); } catch (e) { console.warn('[Mahjong] Could not save the mute setting:', e); }
      audio.setMuted(muted);
    },
    subscribe: (fn) => audio.onChange(fn),
  };
  // Task 115: one announcer (ARIA live regions) for the app.
  const announcer = createAnnouncer();
  /**
   * Task 116: hints for the human seat — the Advanced AI's choice, explained
   * (src/ai/HintAdvisor.js), only while Settings → Hints is on. A fresh
   * advisor per game; it sees only what the human seat may see.
   */
  const makeHints = () => {
    const advisor = new HintAdvisor();
    return {
      isEnabled: () => settings.get(SETTING_KEYS.HINTS) !== false,
      discard: (gm, seat, context) => advisor.discardHint(gm.getPlayer(seat), context ?? gm.getDecisionContext(seat)),
      action: (gm, seat, actions) => advisor.actionHint(gm.getPlayer(seat), actions, gm.getDecisionContext(seat)),
      claim: (gm, seat, claimOptions) => advisor.claimHint(gm.getPlayer(seat), claimOptions, gm.getDecisionContext(seat)), // Task 118
    };
  };
  // Task 111: fullscreen for the whole page (toolbar button, F, Settings row).
  const fullscreen = new FullscreenManager();
  const toolbarHost = document.getElementById('app-toolbar');
  if (toolbarHost) renderAppToolbar(toolbarHost, { sound: soundControl, fullscreen });
  // Task 79: last difficulty picked this session, pre-selected next time.
  let lastDifficulty;
  // Task 114: the Rule Reference tab last viewed this session.
  let lastReferenceRuleset;
  // Task 113: tutorial progress (step, solved exercises, finished) — kept between visits.
  const tutorialStore = storage.namespace('tutorial');
  try { tutorialStore.migrate({}); } catch { /* best effort */ }
  const readTutorial = () => {
    try {
      const step = tutorialStore.get('step');
      const completed = tutorialStore.get('completed');
      return { step: Number.isInteger(step) && step >= 0 ? step : 0, completed: Array.isArray(completed) ? completed.filter((x) => typeof x === 'string') : [] };
    } catch { return { step: 0, completed: [] }; }
  };
  const saveTutorial = (patch) => { try { for (const [k, v] of Object.entries(patch)) tutorialStore.set(k, v); } catch (e) { console.warn('[Mahjong] Could not save tutorial progress:', e); } };

  function show(renderScreen) {
    root.innerHTML = '';
    root.className = '';
    renderScreen();
    // Task 115: a new screen takes focus — its own choice (a primary button) if it
    // made one, otherwise its heading — so keyboard and screen-reader users land on it.
    const active = document.activeElement;
    if (!active || active === document.body || !root.contains(active)) {
      const heading = root.querySelector('h1, h2');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        try { heading.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    }
    // Task 110: the table has its own track; every other screen the menu track.
    // Read from what is actually on screen (a failed restore re-routes to the
    // wizard from inside renderScreen). Waits silently until audio is unlocked.
    music.play(root.classList.contains('game-screen') ? 'table' : 'menu');
  }

  function showMainMenu() {
    show(() => _renderMainMenuScreen());
  }
  function showRuleSelection() {
    show(() => _renderRuleSelectionScreen());
  }
  function showPlayerCountSelection(rulesetId) {
    show(() => _renderPlayerCountScreen(rulesetId));
  }
  function showDifficultySelection(rulesetId, playerCount) {
    show(() => _renderDifficultyScreen(rulesetId, playerCount));
  }
  function startGame(selection) {
    show(() => _renderGameScreenFor(selection));
  }
  function showEndGame(players, rulesetId) {
    show(() => _renderEndGameScreenFor(players, rulesetId));
  }
  function showStatistics() {
    show(() => _renderStatisticsScreen());
  }
  function showLeaderboard(initialRulesetId, backTo = showStatistics) {
    show(() => _renderLeaderboardScreen(initialRulesetId, backTo));
  }
  function showSettings() {
    show(() => _renderSettingsScreen());
  }
  function showTutorial() {
    show(() => _renderTutorialScreen());
  }
  function showRuleReference(rulesetId) {
    show(() => _renderRuleReferenceScreen(rulesetId));
  }
  function showContinue() {
    const snapshot = saveGame.load();
    if (!snapshot) {
      // Save slot was present but couldn't be loaded (schema too new,
      // corrupted, etc.). Clear it and fall back to the new-game wizard
      // so the player isn't presented with an un-navigable "Continue" loop.
      console.warn('[Mahjong] Saved game could not be loaded; clearing slot and starting wizard.');
      saveGame.clear();
      showRuleSelection();
      return;
    }
    show(() => _renderRestoredGameScreenFor(snapshot));
  }

  function _renderMainMenuScreen() {
    renderMainMenu(root, {
      tagline: 'A premium, offline Mahjong experience.',
      version: APP_VERSION,
      onNewGame: showRuleSelection,
      // Only wire up "Continue" when a save slot actually exists. Re-
      // evaluated on every render so the button appears/disappears correctly
      // after a game ends and clears the slot.
      onContinue: saveGame.hasSave() ? showContinue : undefined,
      onSettings: showSettings,
      onStatistics: showStatistics,
      onLeaderboard: () => showLeaderboard(undefined, showMainMenu),
      onHowToPlay: showTutorial, // Task 113
      onRuleReference: () => showRuleReference(), // Task 114
    });
  }

  /**
   * Task 113: the interactive walkthrough. Its rule exercises are judged by a
   * Hong Kong engine built here (the UI never imports a ruleset). Progress is
   * saved after every step, so a visit resumes where the last one stopped;
   * finishing starts again from the top next time.
   */
  function _renderTutorialScreen() {
    const engine = new HongKongRules();
    const saved = readTutorial();
    const finished = (() => { try { return tutorialStore.get('finished') === true; } catch { return false; } })();
    renderTutorialScreen(root, {
      checkHand: (hand) => engine.checkWin(hand).isWin,
      scoreHand: (hand, context) => engine.scoreHand(hand, context),
      initialStep: finished ? 0 : saved.step,
      completed: saved.completed,
      onProgress: ({ step, completed }) => saveTutorial({ step, completed }),
      onFinish: ({ completed }) => saveTutorial({ step: 0, completed, finished: true }),
      onPlay: () => startGame({ rulesetId: RULESET_ID.HONG_KONG, playerCount: 4, difficulty: 'basic' }),
      onRuleReference: () => showRuleReference(RULESET_ID.HONG_KONG),
      onExit: showMainMenu,
    });
  }

  /** Task 114: the rules of every live ruleset, one tab each. */
  function _renderRuleReferenceScreen(rulesetId) {
    const references = Object.keys(RULE_ENGINE_FACTORIES).map(referenceFor).filter(Boolean);
    renderRuleReferenceScreen(root, {
      references,
      initialRulesetId: rulesetId ?? lastReferenceRuleset,
      onSelect: (id) => { lastReferenceRuleset = id; },
      onBack: showMainMenu,
    });
  }

  function _renderRuleSelectionScreen() {
    renderRuleSelection(root, {
      availableRulesetIds: Object.keys(RULE_ENGINE_FACTORIES),
      onSelect: (rulesetId) => showPlayerCountSelection(rulesetId),
      onBack: showMainMenu,
    });
  }

  function _renderPlayerCountScreen(rulesetId) {
    renderPlayerCountSelection(root, {
      onSelect: (playerCount) => showDifficultySelection(rulesetId, playerCount),
      onBack: showRuleSelection,
    });
  }

  function _renderDifficultyScreen(rulesetId, playerCount) {
    renderDifficultySelection(root, {
      availableDifficulties: getAvailableDifficulties(STRATEGY_FACTORIES),
      selectedDifficulty: lastDifficulty,
      onSelect: (difficulty) => {
        lastDifficulty = difficulty;
        startGame({ rulesetId, playerCount, difficulty });
      },
      onBack: () => showPlayerCountSelection(rulesetId),
    });
  }

  function _renderGameScreenFor({ rulesetId, playerCount, difficulty }) {
    const ruleEngine = RULE_ENGINE_FACTORIES[rulesetId]({ playerCount });
    // Task 79: every AI seat gets the chosen tier; the AIManager holds one
    // strategy per tier the seats use (GameManager verifies the coverage).
    const playerConfigs = buildPlayerConfigs({ playerCount, difficulty, humanSeatIndex: HUMAN_SEAT_INDEX });
    const aiManager = createAIManagerForSeats(playerConfigs, { factories: STRATEGY_FACTORIES });
    const gameManager = new GameManager({ ruleEngine, playerConfigs, aiManager });
    // Task 71: hands dealt this session (for the leaderboard's fastest-win
    // record). Incremented by onHandStarted and persisted into every save
    // snapshot so a restored game continues the count.
    const session = { handsPlayed: 0 };

    renderGameScreen(root, gameManager, {
      animationEngine: animations, // Task 103
      audio, // Task 109
      announcer, // Task 115
      hints: makeHints(), // Task 116
      ruleReference: referenceFor(rulesetId), // Task 114: Pause → Rules
      humanSeatIndex: HUMAN_SEAT_INDEX,
      onExit: showMainMenu,
      onSave: (gm) => {
        try {
          const snap = buildSnapshot(gm, { rulesetId, difficulty });
          saveGame.save({ ...snap, handsPlayed: session.handsPlayed });
        } catch (err) {
          console.warn('[Mahjong] Auto-save failed:', err);
        }
      },
      onClearSave: () => saveGame.clear(),
      // Restart: clear any saved progress for this game and launch a fresh
      // session with identical settings — same ruleset, player count, and
      // difficulty tier.
      onRestart: () => {
        saveGame.clear();
        startGame({ rulesetId, playerCount, difficulty });
      },
      // Statistics callbacks (Task 68): any error is non-fatal — the game
      // continues even if the stats storage layer fails (e.g. localStorage
      // quota exceeded or corrupted state).
      onHandStarted: () => {
        if (session.handsPlayed !== null) session.handsPlayed += 1;
        try { stats.recordHandPlayed(); } catch (e) { console.warn('[Mahjong] Stats error (onHandStarted):', e); }
      },
      onHandWon: (data) => { try { stats.recordHandWin(data); } catch (e) { console.warn('[Mahjong] Stats error (onHandWon):', e); } },
      onGameEnded: (data) => { try { stats.recordGameResult(data); } catch (e) { console.warn('[Mahjong] Stats error (onGameEnded):', e); } },
      // Leaderboard (Tasks 70–71): record the final score AND update the
      // ruleset's records (highest score, fastest win, streaks). Non-fatal.
      onGameComplete: (players) => {
        _recordLeaderboardResult(players, { rulesetId, difficulty, playerCount, handsPlayed: session.handsPlayed });
        showEndGame(players, rulesetId);
      },
    });
  }

  /**
   * Restores a GameManager from a previously-saved snapshot and starts
   * GameScreen in restored state. If hydration fails (unknown ruleset,
   * corrupted snapshot, etc.) the broken save is cleared and the player
   * is redirected to the new-game wizard.
   * @param {Object} snapshot — the blob returned by saveGame.load()
   */
  function _renderRestoredGameScreenFor(snapshot) {
    let gameManager;
    try {
      gameManager = hydrateGameManager(snapshot, { RULE_ENGINE_FACTORIES, STRATEGY_FACTORIES });
    } catch (err) {
      console.error('[Mahjong] Could not restore saved game:', err);
      saveGame.clear();
      showRuleSelection();
      return;
    }

    const { rulesetId, difficulty } = snapshot;
    if (typeof difficulty === 'string') lastDifficulty = difficulty; // Task 79
    // Derive playerCount from the saved playerConfigs so the Restart
    // callback can launch a fresh game with the same player count.
    const playerCount = Array.isArray(snapshot.playerConfigs)
      ? snapshot.playerConfigs.length
      : 4; // defensive fallback; hydrateGameManager would have thrown before this point if playerConfigs was invalid
    // Task 71: continue the hand count from the save. The in-progress hand is
    // already included (GameScreen skips its first onHandStarted on restore).
    // Saves written before Task 71 carry no count — the session's handsPlayed
    // is then unknown (null), so it can't claim a fastest-win record.
    const session = { handsPlayed: _readSavedHandsPlayed(snapshot) };

    renderGameScreen(root, gameManager, {
      animationEngine: animations, // Task 103
      audio, // Task 109
      announcer, // Task 115
      hints: makeHints(), // Task 116
      ruleReference: referenceFor(rulesetId), // Task 114: Pause → Rules
      humanSeatIndex: HUMAN_SEAT_INDEX,
      onExit: showMainMenu,
      onSave: (gm) => {
        try {
          const snap = buildSnapshot(gm, { rulesetId, difficulty });
          saveGame.save({ ...snap, handsPlayed: session.handsPlayed });
        } catch (err) {
          console.warn('[Mahjong] Auto-save failed:', err);
        }
      },
      onClearSave: () => saveGame.clear(),
      // Restart from a restored game: clear the stale save and launch a
      // brand-new game with the same settings the restored game was using.
      onRestart: () => {
        saveGame.clear();
        startGame({ rulesetId, playerCount, difficulty });
      },
      // Statistics callbacks (Task 68). skipFirstHandEvent suppresses the
      // onHandStarted fire for the hand that was in progress when the save
      // was created — that hand was already counted before the save.
      skipFirstHandEvent: true,
      onHandStarted: () => {
        if (session.handsPlayed !== null) session.handsPlayed += 1;
        try { stats.recordHandPlayed(); } catch (e) { console.warn('[Mahjong] Stats error (onHandStarted):', e); }
      },
      onHandWon: (data) => { try { stats.recordHandWin(data); } catch (e) { console.warn('[Mahjong] Stats error (onHandWon):', e); } },
      onGameEnded: (data) => { try { stats.recordGameResult(data); } catch (e) { console.warn('[Mahjong] Stats error (onGameEnded):', e); } },
      // Leaderboard (Tasks 70–71): record the final score AND update the
      // ruleset's records (highest score, fastest win, streaks). Non-fatal.
      onGameComplete: (players) => {
        _recordLeaderboardResult(players, { rulesetId, difficulty, playerCount, handsPlayed: session.handsPlayed });
        showEndGame(players, rulesetId);
      },
    });
  }

  /**
   * Task 71: records a finished game on the leaderboard — score-table entry
   * plus per-ruleset records. `handsPlayed` is omitted when unknown (a game
   * restored from a pre-Task-71 save). Never throws: storage failures are
   * logged and the end-of-game flow continues.
   */
  function _recordLeaderboardResult(players, { rulesetId, difficulty, playerCount, handsPlayed }) {
    try {
      const humanScore = typeof players[HUMAN_SEAT_INDEX]?.score === 'number'
        ? players[HUMAN_SEAT_INDEX].score
        : 0;
      const { won, drawn } = deriveGameResult(players, HUMAN_SEAT_INDEX);
      leaderboard.recordGameResult({
        score: humanScore,
        rulesetId,
        difficulty,
        playerCount,
        won,
        drawn,
        ...(Number.isInteger(handsPlayed) && handsPlayed >= 0 ? { handsPlayed } : {}),
      });
    } catch (e) { console.warn('[Mahjong] Leaderboard error (onGameComplete):', e); }
  }

  /** Task 71: hand count stored in a save by `onSave`, or null when absent/invalid. */
  function _readSavedHandsPlayed(snapshot) {
    const hp = snapshot?.handsPlayed;
    return Number.isInteger(hp) && hp >= 1 ? hp : null;
  }

  function _renderStatisticsScreen() {
    renderStatisticsScreen(root, stats, {
      onBack: showMainMenu,
      // Task 72: MainMenu.js has no leaderboard slot, so the leaderboard is
      // reached from the Statistics screen.
      onLeaderboard: () => showLeaderboard(),
    });
  }

  /**
   * Task 72: leaderboard screen. Tabs list every ruleset that has a working
   * RuleEngine (same source as RuleSelection's availability), so Riichi /
   * Chinese Official tabs appear automatically once they come online.
   * @param {string} [initialRulesetId]
   */
  function _renderLeaderboardScreen(initialRulesetId, backTo = showStatistics) {
    renderLeaderboardScreen(root, leaderboard, {
      rulesets: Object.keys(RULE_ENGINE_FACTORIES).map((id) => ({ id, label: RULESET_LABEL[id] ?? id })),
      initialRulesetId,
      difficultyLabels: AI_DIFFICULTY_LABEL,
      onBack: backTo,
    });
  }

  /** Settings (Task 63): live write-through; theme changes apply at once. */
  function _renderSettingsScreen() {
    root.classList.add('settings-screen');
    renderSettingsMenu(root, settings, {
      fullscreen, // Task 111
      onSettingChange: (key, value) => {
        if (key === SETTING_KEYS.THEME) applyTheme(value);
        if ([SETTING_KEYS.VOLUME, SETTING_KEYS.SFX_VOLUME, SETTING_KEYS.MUSIC_VOLUME, SETTING_KEYS.MUTED].includes(key)) audio.syncWithSettings(settings); // Task 108
        if (key === SETTING_KEYS.ANIMATIONS_ENABLED) {
          animations.setEnabled(value !== false); // Task 103
          applyMotion(value !== false); // Task 107
        }
      },
      onBack: showMainMenu,
    });
  }

  function _renderEndGameScreenFor(players, rulesetId) {
    renderEndGameScreen(root, players, {
      rulesetLabel: RULESET_LABEL[rulesetId],
      onPlayAgain: showRuleSelection,
      onReturnToMenu: showMainMenu,
    });
  }

  return showMainMenu;
}

/** Applies a colour theme to <body data-theme>. */
function applyTheme(theme) {
  if (typeof document !== 'undefined' && document.body) document.body.dataset.theme = theme;
}

/**
 * Task 108: browsers only start audio after a user gesture — the first
 * pointerdown / keydown unlocks it. Page hidden → audio suspended; shown
 * again → resumed (only if it had been unlocked). Every button press clicks.
 */
function installAudioUnlock(audio) {
  if (typeof document === 'undefined') return;
  const unlock = () => {
    audio.unlock();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend(); else audio.resume();
  });
  document.addEventListener('click', (e) => {
    const b = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
    if (b && !b.disabled) audio.play('ui-click');
  }, true);
}

/** Task 107: <body data-motion="off"> also stills CSS transitions (styles/interactions.css). */
function applyMotion(enabled) {
  if (typeof document !== 'undefined' && document.body) document.body.dataset.motion = enabled ? 'on' : 'off';
}

/**
 * Renders a fatal-error view if boot fails outright (e.g. #app-root is
 * missing from the page, or the environment check throws).
 * @param {Error} error
 */
function renderFatalError(error) {
  const fallbackTarget = document.body ?? document.documentElement;
  const container = document.createElement('div');
  container.setAttribute('role', 'alert');
  container.style.cssText =
    'padding: 2rem; font-family: sans-serif; color: #c65b4e; background: #1a0e0c;';
  container.innerHTML = `
    <h1 style="margin-bottom: 0.5em;">Mahjong failed to start</h1>
    <p>${error.message}</p>
  `;
  fallbackTarget.appendChild(container);
}

function boot() {
  try {
    assertEnvironmentSupport();
    installGlobalErrorHandling();

    const root = document.getElementById('app-root');
    if (!root) {
      throw new Error('#app-root element was not found in the document.');
    }

    const eventBusOk = verifyEventBus();
    if (!eventBusOk) {
      // Not fatal (same tolerance as the missing-localStorage case
      // above) — but worth a loud warning, since EventBus not round-
      // tripping is a genuine core bug, not a missing optional feature.
      console.warn('[Mahjong] EventBus self-test failed; continuing to start the app anyway.');
    }

    const showMainMenu = createRouter(root);
    showMainMenu();

    console.info(
      `[Mahjong] Boot complete (v${APP_VERSION}). EventBus verified: ${eventBusOk}.`
    );
    gameEventBus.emit('app-ready', { version: APP_VERSION });
  } catch (error) {
    console.error('[Mahjong] Fatal error during boot:', error);
    renderFatalError(error);
  }
}

boot();

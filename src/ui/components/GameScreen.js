/**
 * GameScreen.js
 *
 * Task 56: the live-game screen — the orchestrator that finally drives
 * an actual GameManager session on screen, tying together every
 * Task-4x/5x renderer and dialog built so far. Unlike every renderer
 * before it, this module is NOT a one-shot "render current state and
 * return" function: a mahjong hand plays out over many draws,
 * discards, and AI turns, so `renderGameScreen()` starts an ongoing
 * loop and returns a small controller object (`{ destroy() }`) instead
 * of the container, so a caller (main.js's router) can tear the loop
 * down cleanly when navigating away.
 *
 * What this module owns vs. what it delegates:
 *   - It never computes game rules itself — every decision (what's
 *     legal, who won, what happens next) comes from calling the
 *     GameManager instance it's given. This module's only job is
 *     sequencing: figure out whose turn it is and what they need next,
 *     call the one right GameManager method, then re-render.
 *   - Rendering itself is 100% delegated to the existing renderers:
 *     HandRenderer (local + opponent), DiscardPileRenderer,
 *     WallRenderer, TurnIndicatorRenderer, and ClaimPromptDialog for
 *     the human's own post-draw self-declarations (concealed/added
 *     Kong, Tsumo). This file adds no new tile/board visuals of its
 *     own — only the thin plumbing connecting user clicks to
 *     GameManager calls and GameManager results back to re-renders.
 *
 * CALLS ON OTHERS' DISCARDS (Task 118 — until then the human could never
 * call them; see GameManager.js's header): this screen turns on
 * gameManager.setHumanClaimPrompts(true). When an AI discard is one the
 * human may call (and the call would beat every AI's choice), playAITurn()
 * returns 'awaiting-claim'; the screen shows ClaimPromptDialog headed
 * "AI 2 discards 5 of Dots" (Pass / Escape declines, Hint asks the
 * advisor's claimHint) and answers with resolveHumanClaim(). A winning
 * discard (Ron) is still taken automatically. The human's own post-draw
 * choices (Kong / Tsumo / Riichi / nine terminals) use the same dialog.
 * Option `humanClaims: false` restores the old behaviour.
 *
 * Task 57 update: the round-over panel now delegates entirely to
 * ScoreScreen.js (_renderRoundOver() calls renderScoreScreen()). The
 * "intentionally minimal" placeholder from the original Task 56 work is
 * fully replaced; the .game-screen-round-over CSS class is no longer
 * added by this module.
 *
 * Task 58 update: when the whole game session is complete
 * (`gameManager.isGameComplete()`), _renderRoundOver() calls the new
 * `options.onGameComplete` callback (if supplied) after ScoreScreen's
 * "Return to Menu" button is clicked, instead of falling straight back
 * to `onExit`. This lets the router (main.js) show EndGameScreen.js
 * between the final-hand ScoreScreen and the main menu without
 * GameScreen needing to know about EndGameScreen directly.
 *
 * Task 65 update: two new optional callbacks support auto-save/restore:
 *   - `options.onSave(gameManager)` — called after each human discard
 *     (if the round is still in progress) and at the start of each new
 *     hand. The caller is responsible for serialising and storing the
 *     snapshot; this module just provides the right moments to do so.
 *   - `options.onClearSave()` — called when the save slot should be
 *     erased: on Quit and when the whole game session ends (so a stale
 *     save doesn't offer a "Continue" option for a finished game).
 *
 * Task 66 update: pause/resume/restart functionality.
 *   - A "Pause" button (top-left) is added alongside the existing
 *     "Quit" button (top-right). Clicking it freezes the game loop
 *     (cancels any pending AI-turn timer), and shows PauseMenu.js inside
 *     the shared overlay slot.
 *   - `options.onRestart()` — optional callback fired when the player
 *     confirms Restart from the pause menu. The caller is responsible for
 *     tearing down and re-launching a fresh game with the same settings;
 *     this module destroys itself first so the caller starts clean. When
 *     omitted, the Restart option is not shown in the pause menu.
 *   - Resuming hides the overlay and restarts the game loop via `_step()`.
 *
 * Task 68 update: statistics tracking callbacks.
 *   - `options.onHandStarted()` — fired once per hand, right before the
 *     first `_step()` of that hand, and again at the top of `onNextHand`
 *     after each `gameManager.startNextHand()`.
 *   - `options.onHandWon({ winType, fan })` — fired when the human player
 *     wins a hand; `winType` is `'tsumo'` or `'ron'` (mapped from the core
 *     engine's `'self'`/`'discard'`), `fan` is the hand's fan count (0 if
 *     unavailable).  Fired from `_renderRoundOver()` before the overlay
 *     shows, so the statistic is recorded regardless of which ScoreScreen
 *     action the player clicks next.
 *   - `options.onGameEnded({ won, drawn })` — fired once at the very end of
 *     the game session, also from `_renderRoundOver()`.
 *   - `options.skipFirstHandEvent` — boolean; when `true`, suppresses the
 *     first `onHandStarted` fire.  Used by the restore path to avoid
 *     double-counting a hand that was counted before the save.
 *   Two pure module-level helpers are exported for unit testing:
 *     `deriveHandWon(lastOutcome, humanSeatIndex)` and
 *     `deriveGameResult(players, humanSeatIndex)`.
 *
 * Task 71 update: in `onNextHand`, `onHandStarted()` now fires BEFORE
 * `onSave()` (previously after), so a caller-side hand counter already
 * includes the new hand when the start-of-hand snapshot is written. No
 * other behaviour change.
 */

import { Renderer } from '../Renderer.js';
import { renderLocalPlayerHand, renderOpponentHand } from '../HandRenderer.js';
import { renderDiscardPile } from '../DiscardPileRenderer.js';
import { renderWallIndicator } from '../WallRenderer.js';
import { renderSeatLabel, highlightCurrentPlayer } from '../TurnIndicatorRenderer.js';
import { renderClaimPrompt } from '../dialogs/ClaimPromptDialog.js';
import { renderScoreScreen } from './ScoreScreen.js';
import { scoreFormatFor } from '../scoreFormat.js';
import { renderTableInfo, tableInfoFrom } from '../TableInfoRenderer.js';
import { rectOf, lastTileRect, findTileByInstance, animateDiscard, animateDraw, animateGhost, popNew, DRAW_FLY_MS, DISCARD_FLY_MS } from '../TableAnimations.js';
import { connectGameSounds } from '../../audio/GameSoundBridge.js';
import { renderPauseMenu } from './PauseMenu.js';
import { revealWin } from '../WinReveal.js';
import { installTileHover } from '../TableHighlights.js';
import { renderRuleReferenceScreen } from './RuleReferenceScreen.js';
import { connectGameAnnouncer } from '../GameAnnouncer.js';
import { trapFocus } from '../FocusTrap.js';
import { formatDiscardHint, formatActionHint, formatClaimHint } from '../hintText.js';
import { ACTION_TYPE, TURN_PHASE, SEAT_KIND } from '../../utils/constants.js';

/** Task 115: the keys, as listed in the Pause menu. */
const KEYBOARD_SHORTCUTS = Object.freeze([
  ['← / →', 'Choose a tile in your hand'],
  ['Enter / Space', 'Discard it'],
  ['H', 'Hint (when hints are on)'],
  ['P / Esc', 'Pause; Esc also closes a menu or passes'],
  ['M', 'Sound on / off'],
  ['F', 'Fullscreen'],
]);

/** Default pause between one AI turn finishing and the next one starting, so AI-vs-AI play is legible rather than instantaneous. */
const DEFAULT_AI_TURN_DELAY_MS = 600;

/**
 * Starts rendering and driving `gameManager` inside `container`.
 *
 * @param {Element} container
 * @param {import('../../core/GameManager.js').GameManager} gameManager
 *   An already-constructed GameManager — this module never constructs
 *   one itself, matching every other renderer's "operates on a
 *   pre-built core object" pattern.
 * @param {Object} [options]
 * @param {number} [options.humanSeatIndex] Which seat the local player
 *   controls. Defaults to whichever seat's `seatKind` is
 *   `SEAT_KIND.HUMAN` (there should be exactly one for this screen to
 *   make sense) — layout.css's own convention already documents seat 0
 *   as "the human seat in a real game," so that's what a typical
 *   caller's playerConfigs will produce anyway.
 * @param {number} [options.aiTurnDelayMs] Pause between AI turns, in ms.
 * @param {function(): void} [options.onExit] Called when the player
 *   uses the Quit control, or (when `options.onGameComplete` is not
 *   supplied) after the session completes and the round-over panel's
 *   "Return to Menu" is clicked. Not called by destroy() itself (see
 *   destroy()'s own doc).
 * @param {function(players: Object[]): void} [options.onGameComplete]
 *   Called when the whole game session ends and the final ScoreScreen's
 *   action button is pressed. Receives the players array so the router
 *   can pass them directly to EndGameScreen. When supplied, this is
 *   called instead of `onExit` for the game-complete case — `onExit`
 *   still fires for mid-game Quit and for game-complete when this is
 *   absent (backward-compatible default).
 * @param {function(gameManager: import('../../core/GameManager.js').GameManager): void} [options.onSave]
 *   Called after each human discard (when the round is still in
 *   progress) and at the start of each new hand. The caller serialises
 *   the live GameManager into a snapshot and persists it. This module
 *   never constructs or stores the snapshot itself.
 * @param {function(): void} [options.onClearSave]
 *   Called when the current save slot should be erased: on Quit and
 *   when the game session ends (game complete or return-to-menu path).
 *   Prevents a stale "Continue" offer from appearing for a game that
 *   is no longer resumable.
 * @param {function(): void} [options.onRestart]
 *   Called when the player confirms Restart from the pause menu.
 *   `destroy()` is called first, so the screen is torn down before
 *   the callback fires. When omitted the Restart button is not shown
 *   in the pause menu (useful when a restart is not supported, e.g.
 *   a restored game mid-session).
 * @param {function(): void} [options.onHandStarted]
 *   Called at the start of each hand (before the hand's first `_step()`
 *   and again at the start of each subsequent hand after `startNextHand()`).
 *   Suppressed for the very first hand when `skipFirstHandEvent` is true.
 * @param {function({winType: string, fan: number}): void} [options.onHandWon]
 *   Called when the human player wins a hand.  Receives `{ winType, fan }`
 *   where `winType` is `'tsumo'` or `'ron'` and `fan` is the fan count
 *   (0 if unavailable).  Fired before the round-over overlay is shown.
 * @param {function({won: boolean, drawn: boolean}): void} [options.onGameEnded]
 *   Called once when the whole game session ends.  Receives `{ won, drawn }`
 *   derived from the final player scores.  Fired before `onGameComplete`/
 *   `onExit`.
 * @param {boolean} [options.skipFirstHandEvent]
 *   When `true`, suppresses the very first `onHandStarted` fire.  Pass
 *   this for a restored game to avoid double-counting the hand that was
 *   already recorded before the save.
 * @returns {{ destroy(): void }} A controller for tearing the screen
 *   down (stops the loop, cancels any pending AI-turn timer, unmounts
 *   the table). Does NOT call `onExit` — that's for the caller's own
 *   navigation to trigger this, not the other way around.
 */
export function renderGameScreen(container, gameManager, options = {}) {
  _assertContainer(container);
  _assertGameManager(gameManager);
  // Task 102: ruleset-aware wording (fan / han + fu / points) for the win
  // button and the round-over panel.
  const format = scoreFormatFor(typeof gameManager.getRuleEngine === 'function' ? gameManager.getRuleEngine()?.getRulesetId?.() : undefined);

  const players = gameManager.getPlayers();
  const humanSeatIndex = options.humanSeatIndex ?? _detectHumanSeatIndex(players);
  _assertSeatIndex(humanSeatIndex, players.length);
  const aiTurnDelayMs = options.aiTurnDelayMs ?? DEFAULT_AI_TURN_DELAY_MS;
  const onExit = typeof options.onExit === 'function' ? options.onExit : () => {};
  const onGameComplete = typeof options.onGameComplete === 'function' ? options.onGameComplete : null;
  const onSave = typeof options.onSave === 'function' ? options.onSave : null;
  const onClearSave = typeof options.onClearSave === 'function' ? options.onClearSave : null;
  const onRestart = typeof options.onRestart === 'function' ? options.onRestart : null;
  const onHandStarted = typeof options.onHandStarted === 'function' ? options.onHandStarted : null;
  const onHandWon = typeof options.onHandWon === 'function' ? options.onHandWon : null;
  const onGameEnded = typeof options.onGameEnded === 'function' ? options.onGameEnded : null;
  // Task 118: this screen can ask, so the human may call Chi / Pon / Kong on others' discards.
  if (options.humanClaims !== false) gameManager.setHumanClaimPrompts?.(true);
  const callTerms = (() => { try { const t = gameManager.getRuleEngine?.()?.getTerminology?.() ?? {}; return { chi: t.chi, pon: t.pon, kong: t.kong }; } catch { return {}; } })();
  const skipFirstHandEvent = options.skipFirstHandEvent === true;
  // Task 103: optional AnimationEngine (src/ui/AnimationEngine.js). Absent → no animation.
  const animationEngine = options.animationEngine && typeof options.animationEngine.play === 'function' ? options.animationEngine : null;
  // Task 109: optional AudioManager (src/audio/AudioManager.js). Absent → silent.
  const audio = options.audio && typeof options.audio.play === 'function' ? options.audio : null;
  // Task 114: this ruleset's reference (src/rules/<ruleset>/*Reference.js, via main.js) — Pause → Rules.
  const ruleReference = options.ruleReference && options.ruleReference.rulesetId ? options.ruleReference : null;
  // Task 115: optional announcer (src/ui/Announcer.js) — screen-reader narration of the table.
  const announcer = options.announcer && typeof options.announcer.announce === 'function' ? options.announcer : null;
  // Task 116: optional hints — { isEnabled(), discard(gm, seat, context?), action(gm, seat, actions) } (main.js wraps src/ai/HintAdvisor.js).
  const hints = options.hints && typeof options.hints.discard === 'function' ? options.hints : null;
  const hintsOn = () => { try { return !!hints && (typeof hints.isEnabled !== 'function' || hints.isEnabled()); } catch { return false; } };

  container.innerHTML = '';
  container.classList.add('game-screen');

  const tableContainer = document.createElement('div');
  tableContainer.className = 'game-screen-table';
  container.appendChild(tableContainer);

  // Task 102: a one-line status (e.g. "Riichi — choose your discard").
  const statusLine = document.createElement('div');
  statusLine.className = 'game-screen-status';
  statusLine.setAttribute('role', 'status');
  container.appendChild(statusLine);

  const overlayContainer = document.createElement('div');
  overlayContainer.className = 'game-screen-overlay';
  overlayContainer.hidden = true;
  container.appendChild(overlayContainer);

  const quitButton = document.createElement('button');
  quitButton.type = 'button';
  quitButton.className = 'game-screen-quit';
  quitButton.textContent = 'Quit to Menu';
  quitButton.addEventListener('click', () => {
    onClearSave?.();
    destroy();
    onExit();
  });
  container.appendChild(quitButton);

  // Task 116: the Hint button (next to Pause) and the advice panel.
  const hintButton = document.createElement('button');
  hintButton.type = 'button';
  hintButton.className = 'game-screen-hint';
  hintButton.textContent = 'Hint';
  hintButton.title = 'Suggest a discard (H)';
  hintButton.hidden = !hintsOn();
  hintButton.addEventListener('click', () => _showHint());
  container.appendChild(hintButton);
  const hintPanel = document.createElement('section');
  hintPanel.className = 'game-screen-hint-panel';
  hintPanel.setAttribute('role', 'status');
  hintPanel.setAttribute('aria-live', 'polite');
  hintPanel.setAttribute('aria-label', 'Hint');
  hintPanel.hidden = true;
  container.appendChild(hintPanel);
  /** Task 116: the tile the current hint suggests (marked after every redraw until you discard). */
  let hintedInstanceId = null;

  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  pauseButton.className = 'game-screen-pause';
  pauseButton.textContent = 'Pause';
  pauseButton.addEventListener('click', _pauseGame);
  container.appendChild(pauseButton);

  const renderer = new Renderer(tableContainer, { playerCount: players.length });
  renderer.mount();
  // Task 102: ruleset facts under the wall counter (dora, riichi, honba, flowers).
  // It lives in the wall's cell, right under the counter; renderWallIndicator
  // clears that cell, so _renderTable re-attaches it after every redraw.
  const tableInfoContainer = document.createElement('div');
  tableInfoContainer.className = 'game-screen-table-info';
  /** Task 102: the RIICHI action the human chose; their next discard declares it. @type {Object|null} */
  let pendingRiichi = null;
  /** Task 105: flower tiles already shown (new ones pop in). */
  const seenFlowers = new Set();
  /** Task 104: the human's automatic draw is waiting for a running animation to finish. */
  let drawWaiting = false;
  /** Task 107: hovering a tile marks its other copies; a flashed status message's timer. */
  const tileHover = installTileHover(tableContainer);
  let flashTimer = null;
  /** Task 115: keyboard focus in your hand (kept across redraws), the open overlay's focus trap. */
  let keyboardInHand = false;
  let focusInstanceId = null;
  let releaseTrap = null;
  const gameAnnouncer = announcer && typeof gameManager.getEventBus === 'function' && gameManager.getEventBus()
    ? connectGameAnnouncer(gameManager.getEventBus(), announcer, {
      players, humanSeatIndex,
      drawnTile: () => gameManager.getLastDrawnTile?.() ?? null,
      terms: (() => { try { const t = gameManager.getRuleEngine?.()?.getTerminology?.() ?? {}; return { chi: t.chi, pon: t.pon, kong: t.kong }; } catch { return {}; } })(),
    })
    : null;
  /** Task 115: P / Escape pause (when nothing is open); H asks for a hint (Task 116). */
  const onScreenKey = (e) => {
    if (destroyed || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = String(e.target?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!overlayContainer.hidden) return; // overlays handle their own keys (focus trap)
    const k = String(e.key).toLowerCase();
    if (k === 'p' || k === 'escape') { e.preventDefault?.(); _pauseGame(); }
    else if (k === 'h') { e.preventDefault?.(); _showHint(); }
  };
  document.addEventListener('keydown', onScreenKey);
  /**
   * Task 119: switching away (another tab, a minimised window) pauses the
   * game, so opponents don't play on unseen and nothing runs in the
   * background; you come back to the Pause menu. A prompt or result that is
   * already waiting on you stays as it is (nothing is running then).
   */
  const onVisibility = () => {
    if (destroyed || options.pauseWhenHidden === false) return;
    if (document.hidden && overlayContainer.hidden) _pauseGame();
  };
  document.addEventListener('visibilitychange', onVisibility);
  /** Task 109: game sounds from the GameManager's event bus, landing with the animations. */
  const soundBridge = audio && typeof gameManager.getEventBus === 'function' && gameManager.getEventBus()
    ? connectGameSounds(gameManager.getEventBus(), audio, {
      humanSeatIndex,
      playerCount: players.length,
      timing: () => (animationEngine?.isActive?.() ? { drawMs: DRAW_FLY_MS, discardMs: DISCARD_FLY_MS } : null),
    })
    : null;
  players.forEach((player, seatIndex) => renderSeatLabel(renderer.getSeatLabelContainer(seatIndex), player));

  let destroyed = false;
  let timeoutId = null;
  let _paused = false;
  /** The most recent win/draw outcome, captured directly from whichever GameManager call produced it — see the module doc comment for why this is tracked locally rather than re-derived from TurnManager (which exposes an end REASON but not the winner records themselves). @type {{type: 'win', winners: Object[]}|{type: 'draw', results: Object[]}|null} */
  let lastOutcome = null;

  // Fire onHandStarted for the first hand (unless this is a restored game
  // that already counted this hand before the save was created).
  if (!skipFirstHandEvent) onHandStarted?.();
  _step();

  return { destroy };

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function _renderTable() {
    const turnManager = gameManager.getTurnManager();
    const roundOver = turnManager.isRoundOver();
    const isHumanDiscardTurn =
      !roundOver && turnManager.getCurrentPlayerIndex() === humanSeatIndex && turnManager.getPhase() === TURN_PHASE.AWAITING_DISCARD;

    // Task 115: is the keyboard user working in their hand? (A redraw removes the
    // focused tile — focus then falls to <body>, which keeps the previous answer.)
    const humanHand = renderer.getSeatHandContainer(humanSeatIndex);
    const active = document.activeElement;
    if (active && humanHand.contains(active)) keyboardInHand = true;
    else if (active && active !== document.body && !overlayContainer.contains(active)) keyboardInHand = false;

    players.forEach((player, seatIndex) => {
      const handContainer = renderer.getSeatHandContainer(seatIndex);
      if (seatIndex === humanSeatIndex) {
        // Task 105: the tile just drawn is marked (.tile--drawn) while it's your discard.
        const drawn = isHumanDiscardTurn ? gameManager.getLastDrawnTile?.() : null;
        renderLocalPlayerHand(handContainer, player.getHand(), isHumanDiscardTurn
          ? { ..._discardOptions(), ...(drawn ? { highlightInstanceId: drawn.instanceId } : {}), focusInstanceId: keyboardInHand ? focusInstanceId : (drawn?.instanceId ?? null), onFocusTile: (t) => { focusInstanceId = t.instanceId; } }
          : {});
      } else {
        renderOpponentHand(handContainer, player.getHand());
      }
      renderDiscardPile(renderer.getSeatDiscardContainer(seatIndex), player.getDiscardPile());
      _labelSeat(seatIndex, player); // Task 115
    });

    // Task 102: scores can change mid-hand (Riichi's riichi stick), so the labels are redrawn with the table.
    players.forEach((player, seatIndex) => renderSeatLabel(renderer.getSeatLabelContainer(seatIndex), player));
    renderWallIndicator(renderer.getWallContainer(), gameManager.getWall());
    renderer.getWallContainer().appendChild(tableInfoContainer);
    renderTableInfo(tableInfoContainer, tableInfoFrom(gameManager));
    _popNewFlowers();
    if (flashTimer === null) statusLine.textContent = _regularStatus(); // Task 107: a flashed message keeps its moment
    highlightCurrentPlayer(renderer, turnManager);
    tileHover.refresh(); // Task 107: re-mark the hovered tile's copies on the new elements
    // Task 116: the Hint button works on your discard turn; the suggested tile stays marked.
    hintButton.hidden = !hintsOn();
    hintButton.disabled = !isHumanDiscardTurn;
    if (!isHumanDiscardTurn && !pendingRiichi) _clearHint();
    if (hintedInstanceId) findTileByInstance(humanHand, hintedInstanceId)?.classList.add('tile--hinted');
    // Task 115: put keyboard focus back in the hand — on your drawn tile when it's your turn.
    if (keyboardInHand && overlayContainer.hidden) {
      const target = humanHand.querySelector('.hand-concealed [tabindex="0"]') ?? humanHand.querySelector('.hand-concealed');
      try { target?.focus({ preventScroll: true }); } catch { /* headless */ }
    }
  }

  /** Task 115: what a screen reader hears for a seat and its discards. */
  function _labelSeat(seatIndex, player) {
    const you = seatIndex === humanSeatIndex;
    const name = you ? 'You' : player.displayName;
    const wind = player.seatWind?.label ? `${player.seatWind.label} seat` : '';
    const hidden = you ? '' : `${player.getHand().concealedCount} hidden tiles`;
    const melds = player.getHand().melds.length ? `${player.getHand().melds.length} exposed set${player.getHand().melds.length > 1 ? 's' : ''}` : '';
    const parts = [name, wind, `${player.score} points`, hidden, melds].filter(Boolean);
    const seat = renderer.getSeatContainer(seatIndex);
    seat.setAttribute('aria-label', parts.join(', '));
    const pile = renderer.getSeatDiscardContainer(seatIndex);
    const n = player.getDiscardPile().length;
    pile.setAttribute('role', 'group');
    pile.setAttribute('aria-label', `${you ? 'Your' : `${player.displayName}\u2019s`} discards, ${n} tile${n === 1 ? '' : 's'}`);
  }

  /** Task 105: flowers that just appeared on the table pop in (Chinese Official). */
  function _popNewFlowers() {
    const tiles = [...tableInfoContainer.querySelectorAll('.table-info-flowers .tile')];
    const ids = tiles.map((t) => t.dataset.instanceId);
    if (ids.length < seenFlowers.size) seenFlowers.clear(); // a new hand
    const fresh = tiles.filter((t) => !seenFlowers.has(t.dataset.instanceId));
    for (const id of ids) seenFlowers.add(id);
    if (fresh.length && animationEngine) popNew(animationEngine, fresh);
  }

  /** Task 104: where the wall counter is on screen (draws fly from there). */
  function _wallRect() {
    const wall = renderer.getWallContainer();
    return rectOf(wall.querySelector('.wall-indicator') ?? wall);
  }

  /** Task 105: your drawn tile flies in from the wall. */
  function _animateHumanDraw(tile, from) {
    if (!animationEngine || !tile) return;
    animateDraw(animationEngine, { from, handContainer: renderer.getSeatHandContainer(humanSeatIndex), tile });
  }

  /** Task 104: your discard flies from where it sat in your hand into your pile. */
  function _animateHumanDiscard(tile, from) {
    if (!animationEngine || !tile) return;
    animateDiscard(animationEngine, { from, pileContainer: renderer.getSeatDiscardContainer(humanSeatIndex), tile });
  }

  /**
   * Task 102: the human's discard options. A rule engine may restrict the
   * discard (DISCARD.allowedTiles — Riichi's riichi lock and kuikae); a
   * pending riichi restricts it to the tiles that keep the hand tenpai.
   */
  function _discardOptions() {
    const allowed = pendingRiichi
      ? pendingRiichi.allowedTiles
      : gameManager.getSelfActions().find((a) => a.type === ACTION_TYPE.DISCARD)?.allowedTiles ?? null;
    const ids = Array.isArray(allowed) ? new Set(allowed.map((t) => t.instanceId)) : null;
    return {
      onDiscard: pendingRiichi ? _handleRiichiDiscard : _handleHumanDiscard,
      ...(ids ? { isDiscardable: (t) => ids.has(t.instanceId), onLockedAttempt: _handleLockedAttempt } : {}),
    };
  }

  /**
   * Task 116: advice for your discard — the Advanced AI's choice, explained
   * (src/ai/HintAdvisor.js via options.hints). The tile is marked; the panel
   * says why. Choosing a riichi discard limits it to the riichi tiles.
   */
  function _showHint() {
    if (!hintsOn() || destroyed || _paused) return;
    const tm = gameManager.getTurnManager();
    if (tm.isRoundOver() || tm.getCurrentPlayerIndex() !== humanSeatIndex || tm.getPhase() !== TURN_PHASE.AWAITING_DISCARD) return;
    let advice = null;
    try {
      const ctx = gameManager.getDecisionContext(humanSeatIndex);
      advice = hints.discard(gameManager, humanSeatIndex, pendingRiichi ? { ...ctx, allowedDiscards: pendingRiichi.allowedTiles } : ctx);
    } catch (e) {
      console.warn('[GameScreen] hint failed:', e);
      return;
    }
    if (!advice?.tile) return;
    const text = formatDiscardHint(advice);
    _renderHintPanel(text);
    hintedInstanceId = advice.tile.instanceId;
    const hand = renderer.getSeatHandContainer(humanSeatIndex);
    hand.querySelectorAll('.tile--hinted').forEach((t) => t.classList.remove('tile--hinted'));
    const el = findTileByInstance(hand, hintedInstanceId);
    el?.classList.add('tile--hinted');
    if (animationEngine && el) animationEngine.play(el, 'pulse');
    options.onHint?.(advice);
  }

  function _renderHintPanel({ headline, details }) {
    hintPanel.innerHTML = '';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'game-screen-hint-close';
    close.setAttribute('aria-label', 'Close hint');
    close.textContent = '×';
    close.addEventListener('click', _clearHint);
    const head = document.createElement('p');
    head.className = 'game-screen-hint-headline';
    head.textContent = headline;
    hintPanel.append(close, head);
    for (const d of details) {
      const p = document.createElement('p');
      p.className = 'game-screen-hint-detail';
      p.textContent = d;
      hintPanel.appendChild(p);
    }
    hintPanel.hidden = false;
  }

  function _clearHint() {
    hintedInstanceId = null;
    hintPanel.hidden = true;
    hintPanel.innerHTML = '';
    renderer.getSeatHandContainer(humanSeatIndex)?.querySelectorAll('.tile--hinted').forEach((t) => t.classList.remove('tile--hinted'));
  }

  /** Task 116: a Hint button inside the Kong / Win / Riichi prompt — marks the suggested choice. */
  function _addPromptHint(selfActions, {
    advise = () => hints.action(gameManager, humanSeatIndex, selfActions),
    words = (advice) => formatActionHint(advice),
    available = () => typeof hints.action === 'function',
  } = {}) {
    if (!hintsOn() || !available()) return;
    const card = overlayContainer.querySelector('.claim-prompt');
    const pass = card?.querySelector('.claim-prompt-btn--pass');
    if (!card || !pass) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claim-prompt-btn claim-prompt-btn--hint';
    btn.textContent = 'Hint';
    btn.addEventListener('click', () => {
      let advice = null;
      try { advice = advise(); } catch (e) { console.warn('[GameScreen] hint failed:', e); return; }
      if (!advice) return;
      const idx = advice.action?.type === ACTION_TYPE.PASS ? 'pass' : String(selfActions.indexOf(advice.action));
      card.querySelectorAll('.claim-prompt-btn--suggested').forEach((b) => b.classList.remove('claim-prompt-btn--suggested'));
      card.querySelector(`[data-action-index="${idx}"]`)?.classList.add('claim-prompt-btn--suggested');
      const { headline, details } = words(advice);
      let box = card.querySelector('.claim-prompt-hint');
      if (!box) { box = document.createElement('div'); box.className = 'claim-prompt-hint'; box.setAttribute('role', 'status'); card.insertBefore(box, pass); }
      box.innerHTML = '';
      for (const [cls, t] of [['claim-prompt-hint-headline', headline], ...details.map((d) => ['claim-prompt-hint-detail', d])]) {
        const p = document.createElement('p'); p.className = cls; p.textContent = t; box.appendChild(p);
      }
      if (advice.reason === 'riichi' && advice.tile) hintedInstanceId = advice.tile.instanceId; // marked once you pick the discard
      const hadFocus = document.activeElement === btn;
      btn.disabled = true;
      // A disabled button drops focus to <body> — out of the prompt's focus trap (Task 118 fix): land on the suggestion.
      if (hadFocus || !overlayContainer.contains(document.activeElement)) (card.querySelector('.claim-prompt-btn--suggested') ?? pass).focus();
      options.onHint?.(advice);
    });
    card.insertBefore(btn, pass);
  }

  /**
   * Task 118: another player's discard you may call (Chi / Pon / Kong). The
   * GameManager is paused on it until resolveHumanClaim; Escape / Pass declines.
   */
  function _promptHumanClaim(pending) {
    const claimOptions = pending.options;
    const who = gameManager.getPlayer?.(pending.seatIndex)?.displayName ?? 'A player';
    const title = `${who} discards ${pending.tile.label ?? pending.tile.id}`;
    _showOverlay((el) => renderClaimPrompt(el, claimOptions, _handleHumanClaimChoice, { format, title, terms: callTerms }), { onEscape: () => _handleHumanClaimChoice({ type: ACTION_TYPE.PASS }) });
    _addPromptHint(claimOptions, {
      advise: () => hints.claim?.(gameManager, humanSeatIndex, claimOptions) ?? null,
      words: (advice) => formatClaimHint(advice, { callName: (t) => callTerms[t] ?? { chi: 'Chi', pon: 'Pon', kong: 'Kong' }[t] }),
      available: () => typeof hints.claim === 'function',
    });
    _sound('turn');
  }

  function _handleHumanClaimChoice(action) {
    _hideOverlay();
    const result = gameManager.resolveHumanClaim(action);
    _captureOutcomeFrom(result);
    _step();
  }

  /** Task 107: a locked tile was clicked — shake it and say why. */
  function _handleLockedAttempt(tile, el) {
    if (animationEngine && el) animationEngine.play(el, 'shake');
    _sound('locked'); // Task 109
    const inRiichi = gameManager.getTurnFlow?.()?.isRiichi?.(humanSeatIndex);
    _flashStatus(pendingRiichi
      ? 'Riichi — choose a tile that keeps your hand ready'
      : inRiichi ? 'In riichi you must discard the tile you drew'
        : 'That tile can’t be discarded right now');
  }

  /** Task 107: a short-lived message in the status line; the regular status returns after. */
  function _flashStatus(text, ms = 1800) {
    statusLine.textContent = text;
    statusLine.classList.add('game-screen-status--flash');
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      statusLine.classList.remove('game-screen-status--flash');
      if (!destroyed) statusLine.textContent = _regularStatus();
    }, ms);
  }

  function _regularStatus() {
    const tm = gameManager.getTurnManager();
    const humanDiscardTurn = !tm.isRoundOver() && tm.getCurrentPlayerIndex() === humanSeatIndex && tm.getPhase() === TURN_PHASE.AWAITING_DISCARD;
    return pendingRiichi && humanDiscardTurn ? 'Riichi — choose your discard' : '';
  }

  /**
   * Task 115: `onEscape` — what Escape does on this card (Pass, Resume, Back);
   * focus is trapped in the card until it is hidden, then returns to the hand
   * (or the Pause button).
   */
  function _showOverlay(renderFn, { onEscape = null } = {}) {
    releaseTrap?.();
    releaseTrap = null;
    renderFn(overlayContainer);
    overlayContainer.hidden = false;
    releaseTrap = trapFocus(overlayContainer, {
      onEscape,
      restoreTo: () => renderer.getSeatHandContainer(humanSeatIndex).querySelector('.hand-concealed [tabindex="0"]') ?? (destroyed ? null : pauseButton),
    });
    // Task 103: overlays (action prompt, round result, pause) pop in. Purely
    // decorative — nothing waits on it, and the buttons work at once.
    const card = overlayContainer.firstElementChild;
    if (animationEngine && card) animationEngine.play(card, 'pop-in');
  }

  function _hideOverlay() {
    // Task 106: a dismissed card's staged reveal stops at once (the human's
    // next draw waits for running animations — it must not wait for these).
    animationEngine?.cancelWithin?.(overlayContainer);
    const release = releaseTrap;
    releaseTrap = null;
    overlayContainer.hidden = true;
    overlayContainer.innerHTML = '';
    // Reset to the base class so stale modifier classes (like any added by
    // previous round-over rendering) can't bleed into the next overlay use.
    overlayContainer.className = 'game-screen-overlay';
    release?.(); // Task 115: focus back to where it was
  }

  // ---------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------

  function _step() {
    if (destroyed || _paused) return;
    _renderTable();

    if (gameManager.isRoundOver()) {
      // Settle scores before showing the standings panel (Task 60) so the
      // ScoreScreen displays post-settlement totals rather than unchanged
      // starting scores. settleRound() is idempotent — safe if _step() is
      // somehow called more than once after the round ends.
      gameManager.settleRound();
      _renderRoundOver();
      return;
    }

    const turnManager = gameManager.getTurnManager();
    const seatIndex = turnManager.getCurrentPlayerIndex();

    if (seatIndex === humanSeatIndex) {
      if (turnManager.getPhase() === TURN_PHASE.AWAITING_DRAW) {
        // Task 104: let an opponent's discard land before your draw redraws the table.
        if (animationEngine && animationEngine.getActiveCount?.() > 0) {
          if (!drawWaiting) {
            drawWaiting = true;
            animationEngine.whenIdle().then(() => {
              drawWaiting = false;
              const tm = gameManager.getTurnManager();
              if (!destroyed && !_paused && !gameManager.isRoundOver() && tm.getCurrentPlayerIndex() === humanSeatIndex && tm.getPhase() === TURN_PHASE.AWAITING_DRAW) _handleHumanDraw();
            });
          }
        } else {
          _handleHumanDraw();
        }
      }
      // Otherwise AWAITING_DISCARD: _renderTable() above already wired
      // up onDiscard — nothing to do but wait for the player's click.
    } else {
      _scheduleAITurn();
    }
  }

  function _scheduleAITurn() {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (destroyed) return;

      // Tasks 104–105: where the tiles start, measured before the table redraws.
      const tm = gameManager.getTurnManager();
      const aiSeat = tm.getCurrentPlayerIndex();
      const drew = tm.getPhase() === TURN_PHASE.AWAITING_DRAW;
      const wallFrom = animationEngine ? _wallRect() : null;
      const handFrom = animationEngine ? lastTileRect(renderer.getSeatHandContainer(aiSeat)) : null;

      const result = gameManager.playAITurn();
      if (result.type === 'awaiting-claim') {
        // Task 118: the discard is yours to call — show it on the table, then ask.
        _renderTable();
        if (animationEngine) _animateAITurn({ type: 'discarded', seatIndex: result.seatIndex, tile: result.tile }, aiSeat, drew, wallFrom, handFrom);
        _promptHumanClaim(result);
        return;
      }
      if (result.type === 'not-applicable') {
        // Defensive: should be unreachable if humanSeatIndex accurately
        // reflects the table's seatKinds, but fail loudly rather than
        // silently freezing the game loop if it ever isn't.
        console.warn('[GameScreen] playAITurn() was not applicable for the current seat; stopping.', result);
        return;
      }
      _captureOutcomeFrom(result);
      _step();
      if (animationEngine) _animateAITurn(result, aiSeat, drew, wallFrom, handFrom);
    }, aiTurnDelayMs);
  }

  /**
   * Tasks 104–105: an opponent's turn — a face-down tile flies from the wall
   * to their hand (their draw), then their discard flies into their pile.
   */
  function _animateAITurn(result, seat, drew, wallFrom, handFrom) {
    if (drew && wallFrom && handFrom) animateGhost(animationEngine, { from: wallFrom, to: handFrom });
    if (result.type === 'discarded' && result.tile) {
      animateDiscard(animationEngine, { from: handFrom, pileContainer: renderer.getSeatDiscardContainer(result.seatIndex ?? seat), tile: result.tile, delay: drew ? DRAW_FLY_MS : 0 });
    }
  }

  function _handleHumanDraw() {
    const wallFrom = animationEngine ? _wallRect() : null;
    const result = gameManager.performDraw();
    if (result.type === 'exhausted') {
      lastOutcome = { type: 'draw', results: result.results };
      _step();
      return;
    }
    // Task 105: show the drawn tile now (even under a Kong / Tsumo prompt), then fly it in.
    _renderTable();
    _resolveSelfActionsThenStep(result.actions);
    _animateHumanDraw(result.tile, wallFrom);
  }

  /** Filters a draw's legal actions down to genuine self-declarations (Kong/Tsumo) — the DISCARD pseudo-action `getLegalActions()` always includes alongside them is never itself a prompt option. */
  function _resolveSelfActionsThenStep(actions) {
    const selfActions = actions.filter((a) => a.type === ACTION_TYPE.KONG || a.type === ACTION_TYPE.WIN || a.type === ACTION_TYPE.RIICHI || a.type === ACTION_TYPE.ABORTIVE_DRAW);
    if (selfActions.length === 0) {
      _step();
      return;
    }
    _showOverlay((el) => renderClaimPrompt(el, selfActions, _handleSelfActionChoice, { format, terms: callTerms }), { onEscape: () => _handleSelfActionChoice({ type: ACTION_TYPE.PASS }) });
    _addPromptHint(selfActions); // Task 116
    _sound('turn'); // Task 109: a choice is waiting for you
  }

  /** Task 109: a UI sound (game-event sounds come through the bridge). */
  function _sound(name, opts) {
    try { audio?.play(name, opts); } catch { /* never breaks the game */ }
  }

  function _handleSelfActionChoice(action) {
    _hideOverlay();

    if (action.type === ACTION_TYPE.PASS) {
      _step();
      return;
    }
    if (action.type === ACTION_TYPE.WIN) {
      const winner = gameManager.declareTsumo();
      lastOutcome = { type: 'win', winners: [winner] };
      _step();
      return;
    }
    // Task 102: Riichi — the next discard (restricted to tenpai-keeping tiles) declares it.
    if (action.type === ACTION_TYPE.RIICHI) {
      pendingRiichi = action;
      _step();
      return;
    }
    // Task 102: Riichi nine terminals — the hand ends at once.
    if (action.type === ACTION_TYPE.ABORTIVE_DRAW) {
      lastOutcome = gameManager.declareAbortiveDraw();
      _step();
      return;
    }
    // ACTION_TYPE.KONG: declaring it triggers its own replacement draw,
    // which can itself reveal a further self-Kong/Tsumo option (exactly
    // the loop playAITurn() documents for the AI path) — so recurse
    // through the same self-action check rather than assuming the next
    // step is always a discard.
    const wallFrom = animationEngine ? _wallRect() : null;
    const kong = gameManager.declareKong(action);
    // Task 104: an added Kong robbed by another player ends the hand — no replacement draw.
    if (kong.robbed || !kong.draw) {
      lastOutcome = gameManager.getLastOutcome?.() ?? lastOutcome;
      _step();
      return;
    }
    const { draw } = kong;
    if (draw.type === 'exhausted') {
      lastOutcome = { type: 'draw', results: draw.results };
      _step();
      return;
    }
    _renderTable();
    _resolveSelfActionsThenStep(draw.actions);
    _animateHumanDraw(draw.tile, wallFrom);
  }

  /** Task 102: the discard that declares riichi. */
  function _handleRiichiDiscard(tile) {
    _clearHint(); // Task 116
    pendingRiichi = null;
    const from = rectOf(findTileByInstance(renderer.getSeatHandContainer(humanSeatIndex), tile.instanceId));
    const result = gameManager.declareRiichi(tile);
    _captureOutcomeFromDiscard(result);
    if (!gameManager.isRoundOver()) onSave?.(gameManager);
    _step();
    _animateHumanDiscard(tile, from);
  }

  function _handleHumanDiscard(tile) {
    _clearHint(); // Task 116
    const from = animationEngine ? rectOf(findTileByInstance(renderer.getSeatHandContainer(humanSeatIndex), tile.instanceId)) : null;
    const result = gameManager.performDiscard(tile);
    _captureOutcomeFromDiscard(result);
    // Auto-save after every human discard, as long as the round is still
    // in progress. If the discard ended the round (a ron claim happened
    // inside performDiscard), saving is pointless — _step() will show the
    // round-over panel and onClearSave fires when the game ends.
    if (!gameManager.isRoundOver()) {
      onSave?.(gameManager);
    }
    _step();
    _animateHumanDiscard(tile, from); // Task 104
  }

  /** @param {{winners: Object[]|null}} result A performDiscard()-shaped result (human path). */
  function _captureOutcomeFromDiscard(result) {
    if (result.winners) {
      lastOutcome = { type: 'win', winners: result.winners };
    }
  }

  /** @param {Object} result A playAITurn()-shaped result (AI path) — see GameManager.js for its several possible shapes. */
  function _captureOutcomeFrom(result) {
    if (result.type === 'exhausted') {
      lastOutcome = { type: 'draw', results: result.results };
    } else if (result.type === 'tsumo') {
      lastOutcome = { type: 'win', winners: [result.winner] };
    } else if (result.type === 'discarded' && result.winners) {
      lastOutcome = { type: 'win', winners: result.winners };
    }
  }

  // ---------------------------------------------------------------------
  // Round-over panel — delegates to ScoreScreen (Task 57)
  // ---------------------------------------------------------------------

  function _renderRoundOver() {
    // Task 102: the GameManager's own record covers every way a hand ends
    // (abortive draws, a robbed Kong, Ron on a riichi discard…).
    lastOutcome = (typeof gameManager.getLastOutcome === 'function' ? gameManager.getLastOutcome() : null) ?? lastOutcome;
    pendingRiichi = null;
    const gameComplete = gameManager.isGameComplete();

    // --- Statistics hooks (Task 68) ---
    // Fire before the overlay so the stat is recorded regardless of which
    // button the player clicks on the ScoreScreen.
    if (onHandWon) {
      const handWonData = deriveHandWon(lastOutcome, humanSeatIndex);
      if (handWonData) onHandWon(handWonData);
    }
    if (gameComplete && onGameEnded) {
      onGameEnded(deriveGameResult(players, humanSeatIndex));
    }

    _showOverlay((el) => {
      renderScoreScreen(el, lastOutcome, players, {
        format,
        isGameComplete: gameComplete,
        onNextHand: gameComplete ? null : () => {
          lastOutcome = null;
          gameManager.startNextHand();
          // Task 71: onHandStarted fires BEFORE onSave so any per-session
          // hand counter the caller keeps (main.js's leaderboard
          // handsPlayed) already includes this hand when it is written into
          // the save snapshot. A restored game skips its first
          // onHandStarted, so the saved count must already cover it.
          onHandStarted?.();
          // Auto-save at the start of each new hand so a reload can
          // restore to the beginning of the current hand, not an earlier one.
          onSave?.(gameManager);
          _hideOverlay();
          players.forEach((player, seatIndex) => renderSeatLabel(renderer.getSeatLabelContainer(seatIndex), player));
          _step();
        },
        onReturnToMenu: () => {
          // The game is over (either completed or the player is quitting from
          // the round-over panel). Clear the save slot so the main menu
          // won't offer a stale "Continue" option.
          onClearSave?.();
          destroy();
          if (gameComplete && onGameComplete) {
            // Hand the players array to the router so it can show
            // EndGameScreen with final standings before going to the menu.
            onGameComplete(players);
          } else {
            onExit();
          }
        },
      });
    });
    // Task 106: stage the winning-hand reveal (confetti when the human won).
    if (animationEngine && lastOutcome?.type === 'win') {
      const humanWon = lastOutcome.winners.some((w) => w.seatIndex === humanSeatIndex);
      revealWin(animationEngine, overlayContainer.querySelector('.score-screen'), { celebrate: humanWon });
    }
  }

  // ---------------------------------------------------------------------
  // Pause / Resume
  // ---------------------------------------------------------------------

  /**
   * Freezes the game loop and shows the PauseMenu overlay.
   *
   * Safe to call at any point: if the AI-turn timer is pending it is
   * cancelled; if the round is already over or the screen is destroyed the
   * call is a no-op. Clicking Resume calls `_resumeGame()` which restarts
   * the loop via `_step()`.
   */
  function _pauseGame() {
    if (destroyed || _paused) return;
    _paused = true;

    // Cancel any pending AI-turn timer so it doesn't fire while paused.
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    _showPauseMenu();
  }

  /** The pause card (Task 66); Task 114: with a Rules button when a reference is available. */
  function _showPauseMenu() {
    _showOverlay((el) => {
      renderPauseMenu(el, {
        onResume: _resumeGame,
        onRules: ruleReference ? _showRules : null,
        shortcuts: KEYBOARD_SHORTCUTS, // Task 115
        onRestart: onRestart
          ? () => {
              // destroy() first so the router starts with a clean root.
              onClearSave?.();
              destroy();
              onRestart();
            }
          : null,
        onQuit: () => {
          onClearSave?.();
          destroy();
          onExit();
        },
      });
    }, { onEscape: _resumeGame });
  }

  /** Task 114: the rules of the game being played, inside the overlay; Back returns to the pause card. */
  function _showRules() {
    if (!ruleReference || !_paused) return;
    _showOverlay((el) => {
      el.innerHTML = '';
      renderRuleReferenceScreen(el, { references: [ruleReference], embedded: true, onBack: () => { if (_paused && !destroyed) _showPauseMenu(); } });
    }, { onEscape: () => { if (_paused && !destroyed) _showPauseMenu(); } });
    try { overlayContainer.querySelector('.rule-reference-back')?.focus(); } catch { /* headless */ }
  }

  /**
   * Hides the pause overlay and resumes the game loop.
   *
   * Calls `_step()` which re-renders the table and either schedules the
   * next AI turn or waits for the human player's input, exactly as if
   * the pause never happened.
   */
  function _resumeGame() {
    if (destroyed || !_paused) return;
    _paused = false;
    _hideOverlay();
    _step();
  }

  // ---------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (flashTimer !== null) clearTimeout(flashTimer); // Task 107
    tileHover.uninstall();
    document.removeEventListener('keydown', onScreenKey); // Task 115
    document.removeEventListener('visibilitychange', onVisibility); // Task 119
    releaseTrap?.(); releaseTrap = null;
    gameAnnouncer?.disconnect();
    announcer?.flush?.();
    soundBridge?.disconnect(); // Task 109
    animationEngine?.cancelAll(); // Task 103
    renderer.unmount();
  }
}

// ---------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------

/** @private */
function _detectHumanSeatIndex(players) {
  const humanPlayer = players.find((p) => p.seatKind === SEAT_KIND.HUMAN);
  if (!humanPlayer) {
    throw new TypeError('[GameScreen] No seat with seatKind SEAT_KIND.HUMAN was found; pass options.humanSeatIndex explicitly if this table is intentionally all-AI.');
  }
  return humanPlayer.seatIndex;
}

/** @private */
function _assertContainer(container) {
  if (!(container instanceof Element)) {
    throw new TypeError('[GameScreen] container must be a DOM Element.');
  }
}

/** @private */
function _assertGameManager(gameManager) {
  if (
    !gameManager ||
    typeof gameManager.getPlayers !== 'function' ||
    typeof gameManager.getTurnManager !== 'function' ||
    typeof gameManager.performDraw !== 'function'
  ) {
    throw new TypeError('[GameScreen] gameManager must be a GameManager instance (see src/core/GameManager.js).');
  }
}

/** @private */
function _assertSeatIndex(seatIndex, playerCount) {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= playerCount) {
    throw new RangeError(`[GameScreen] humanSeatIndex out of range: ${seatIndex}`);
  }
}

// ---------------------------------------------------------------------------
// Exported helpers for statistics derivation (Task 68)
// These are pure functions extracted for unit-testability: they derive the
// payload objects passed to `options.onHandWon` and `options.onGameEnded`.
// ---------------------------------------------------------------------------

/**
 * Derives the `{ winType, fan }` payload for `options.onHandWon` from the
 * round's `lastOutcome` and the human player's seat index.
 *
 * Returns `null` when the human player did not win this hand (a draw, or
 * an AI win), which is the signal to `_renderRoundOver()` to skip the
 * `onHandWon` call.
 *
 * Win-type mapping:
 *   `winner.winType === 'self'`    → `'tsumo'`  (drew the winning tile)
 *   `winner.winType === 'discard'` → `'ron'`    (claimed another's discard)
 *
 * @param {{type: string, winners?: Object[], results?: Object[]}|null} lastOutcome
 * @param {number} humanSeatIndex
 * @returns {{ winType: string, fan: number }|null}
 */
export function deriveHandWon(lastOutcome, humanSeatIndex) {
  if (!lastOutcome || lastOutcome.type !== 'win') return null;
  const humanWinner = lastOutcome.winners.find((w) => w.seatIndex === humanSeatIndex);
  if (!humanWinner) return null;
  const winType = humanWinner.winType === 'self' ? 'tsumo' : 'ron';
  const fan = typeof humanWinner.fan === 'number' && Number.isFinite(humanWinner.fan) && humanWinner.fan >= 0
    ? humanWinner.fan
    : 0;
  return { winType, fan };
}

/**
 * Derives the `{ won, drawn }` payload for `options.onGameEnded` from the
 * final player scores.
 *
 * Rules:
 *   - `won`   — the human player has the strict highest score (sole leader).
 *   - `drawn` — the human player ties for the highest score (not sole leader).
 *   - both false — an AI player has a strictly higher score (a loss).
 *
 * @param {Object[]} players  Array of player objects; each must have a
 *   `score` numeric property (set by `addScore()` during `settleRound()`).
 * @param {number} humanSeatIndex
 * @returns {{ won: boolean, drawn: boolean }}
 */
export function deriveGameResult(players, humanSeatIndex) {
  const scores = players.map((p) => (typeof p.score === 'number' ? p.score : 0));
  const humanScore = scores[humanSeatIndex] ?? 0;
  const maxScore = Math.max(...scores);
  const tiedCount = scores.filter((s) => s === maxScore).length;
  const won = humanScore === maxScore && tiedCount === 1;
  const drawn = !won && humanScore === maxScore;
  return { won, drawn };
}

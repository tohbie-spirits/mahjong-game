/**
 * TurnManager.js
 *
 * Turn order and the draw/discard cycle for one hand (Task 19): whose turn it
 * is, which phase they're in, and whether/why the round has ended. Claims
 * that jump the queue use forceSetTurn() (Task 28); wins and exhaustive
 * draws end the round via declareWin()/declareDraw() (Tasks 29–30).
 *
 * REBUILT (after Task 77) from the project plan and GameScreen.js /
 * TurnIndicatorRenderer usage: getCurrentPlayerIndex(), getPhase(),
 * isRoundOver(); GameSnapshot uses forceSetTurn(currentPlayerIndex, phase).
 */

import { TURN_PHASE, ROUND_END_REASON } from '../utils/constants.js';

export class TurnManager {
  /**
   * @param {Object} options
   * @param {number} options.playerCount  2–4
   * @param {number} [options.startingIndex=0]  who acts first (the dealer)
   * @param {import('./EventBus.js').EventBus} [options.eventBus]
   */
  constructor({ playerCount, startingIndex = 0, eventBus = null } = {}) {
    if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) throw new RangeError(`[TurnManager] playerCount must be 2–4; got ${playerCount}`);
    if (!Number.isInteger(startingIndex) || startingIndex < 0 || startingIndex >= playerCount) throw new RangeError(`[TurnManager] startingIndex out of range: ${startingIndex}`);
    this._playerCount = playerCount;
    this._current = startingIndex;
    this._phase = TURN_PHASE.AWAITING_DRAW;
    this._endReason = null;
    this._turnCount = 0;
    this._eventBus = eventBus;
  }

  getPlayerCount() { return this._playerCount; }
  getCurrentPlayerIndex() { return this._current; }
  getPhase() { return this._phase; }
  isRoundOver() { return this._phase === TURN_PHASE.ROUND_OVER; }
  /** ROUND_END_REASON, or null while the round is in progress. */
  getEndReason() { return this._endReason; }
  /** Completed discards so far this hand. */
  getTurnCount() { return this._turnCount; }

  /** Seat after `index` in turn order. */
  nextIndex(index = this._current) {
    return (index + 1) % this._playerCount;
  }

  /** The current player has drawn: now they must discard. */
  markDrawn() {
    this._assertPhase(TURN_PHASE.AWAITING_DRAW, 'markDrawn');
    this._phase = TURN_PHASE.AWAITING_DISCARD;
  }

  /** The current player discarded and nobody claimed: next seat draws. */
  advanceAfterDiscard() {
    this._assertPhase(TURN_PHASE.AWAITING_DISCARD, 'advanceAfterDiscard');
    this._turnCount++;
    this._current = this.nextIndex();
    this._phase = TURN_PHASE.AWAITING_DRAW;
    this._eventBus?.emit('turn:advanced', { currentPlayerIndex: this._current });
  }

  /** Records a completed discard without moving the turn (a claim follows). */
  recordDiscard() {
    this._assertPhase(TURN_PHASE.AWAITING_DISCARD, 'recordDiscard');
    this._turnCount++;
  }

  /**
   * Jumps the turn to `index` in `phase` (claims; restoring a save).
   * @param {number} index
   * @param {string} phase  TURN_PHASE.AWAITING_DRAW or AWAITING_DISCARD
   */
  forceSetTurn(index, phase) {
    if (!Number.isInteger(index) || index < 0 || index >= this._playerCount) throw new RangeError(`[TurnManager] forceSetTurn index out of range: ${index}`);
    if (phase !== TURN_PHASE.AWAITING_DRAW && phase !== TURN_PHASE.AWAITING_DISCARD) throw new TypeError(`[TurnManager] forceSetTurn phase must be awaiting-draw or awaiting-discard; got ${phase}`);
    if (this.isRoundOver()) throw new Error('[TurnManager] the round is over.');
    this._current = index;
    this._phase = phase;
  }

  /** Ends the round with a win. */
  declareWin() {
    this._end(ROUND_END_REASON.WIN);
  }

  /** Ends the round as an exhaustive draw. */
  declareDraw() {
    this._end(ROUND_END_REASON.WALL_EXHAUSTED);
  }

  /** Ends the round as an abortive draw (Task 89 — Riichi). */
  declareAbortiveDraw() {
    this._end(ROUND_END_REASON.ABORTIVE);
  }

  /** @private */
  _end(reason) {
    if (this.isRoundOver()) throw new Error('[TurnManager] the round is already over.');
    this._phase = TURN_PHASE.ROUND_OVER;
    this._endReason = reason;
    this._eventBus?.emit('turn:round-over', { reason });
  }

  /** @private */
  _assertPhase(expected, method) {
    if (this._phase !== expected) throw new Error(`[TurnManager] ${method}() needs phase ${expected}; current phase is ${this._phase}.`);
  }
}

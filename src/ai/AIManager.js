/**
 * AIManager.js
 *
 * Plug-in registry of AI strategies keyed by strategy id (= AI_DIFFICULTY),
 * with thin per-seat delegation (Task 36) and async paced variants (Task 40).
 * Holds no decision logic of its own.
 *
 *   const ai = new AIManager({ strategies: [new BasicStrategy()] });
 *   ai.chooseDiscard(player, context);
 *
 * REBUILT (after Task 77) from the project plan.
 */

import { isValidAIStrategy } from './AIStrategyInterface.js';
import { PacingController, PACING_MOMENT } from './PacingController.js';

export class AIManager {
  /**
   * @param {Object} [options]
   * @param {Object[]} [options.strategies=[]]
   * @param {PacingController} [options.pacingController]
   */
  constructor({ strategies = [], pacingController } = {}) {
    /** @private @type {Map<string, Object>} */
    this._strategies = new Map();
    for (const s of strategies) this.registerStrategy(s);
    this._pacing = pacingController ?? new PacingController();
  }

  registerStrategy(strategy) {
    if (!isValidAIStrategy(strategy)) throw new TypeError('[AIManager] not a valid AI strategy.');
    this._strategies.set(strategy.getStrategyId(), strategy);
  }

  hasStrategy(strategyId) { return this._strategies.has(strategyId); }
  getStrategy(strategyId) { return this._strategies.get(strategyId) ?? null; }
  getStrategyIds() { return [...this._strategies.keys()]; }

  /** The strategy for an AI seat (by player.aiDifficulty). */
  getStrategyForPlayer(player) {
    const strategy = this._strategies.get(player?.aiDifficulty);
    if (!strategy) throw new Error(`[AIManager] no strategy registered for difficulty "${player?.aiDifficulty}" (seat ${player?.seatIndex}).`);
    return strategy;
  }

  chooseDiscard(player, context) {
    return this.getStrategyForPlayer(player).chooseDiscard(player, context);
  }

  chooseClaim(player, actions, context) {
    return this.getStrategyForPlayer(player).chooseClaim(player, actions, context);
  }

  chooseWinDeclaration(player, winAction, context) {
    return this.getStrategyForPlayer(player).chooseWinDeclaration(player, winAction, context) === true;
  }

  /**
   * Task 90 — optional Riichi decisions. A strategy without the method never
   * declares riichi (null) or an abortive draw (false).
   */
  chooseRiichi(player, riichiAction, context) {
    const s = this.getStrategyForPlayer(player);
    return typeof s.chooseRiichi === 'function' ? s.chooseRiichi(player, riichiAction, context) ?? null : null;
  }

  chooseAbortiveDraw(player, action, context) {
    const s = this.getStrategyForPlayer(player);
    return typeof s.chooseAbortiveDraw === 'function' ? s.chooseAbortiveDraw(player, action, context) === true : false;
  }

  getPacingController() { return this._pacing; }

  setPacingController(controller) {
    if (!(controller instanceof PacingController)) throw new TypeError('[AIManager] setPacingController requires a PacingController.');
    this._pacing = controller;
  }

  async chooseDiscardPaced(player, context) {
    await this._pacing.wait(PACING_MOMENT.BEFORE_DISCARD);
    return this.chooseDiscard(player, context);
  }

  async chooseClaimPaced(player, actions, context) {
    await this._pacing.wait(PACING_MOMENT.BEFORE_CLAIM);
    return this.chooseClaim(player, actions, context);
  }

  async chooseWinDeclarationPaced(player, winAction, context) {
    await this._pacing.wait(PACING_MOMENT.BEFORE_WIN);
    return this.chooseWinDeclaration(player, winAction, context);
  }
}

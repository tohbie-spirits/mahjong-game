/**
 * AIStrategyInterface.js
 *
 * The shared AI contract (Task 35), mirroring RuleEngineInterface. Every
 * difficulty tier implements it; AIManager (Task 36) holds one strategy per
 * tier and routes each AI seat to the one matching `player.aiDifficulty`.
 *
 * REBUILT (after Task 77) from the project plan: abstract base with
 * chooseDiscard / chooseClaim / chooseWinDeclaration + getStrategyId /
 * getDisplayName; strategy ids reuse AI_DIFFICULTY; isValidAIStrategy()
 * duck-type checker.
 *
 * Method contract (`context` comes from GameManager#_aiContext):
 *   chooseDiscard(player, context)            → a Tile from player's concealed hand
 *   chooseClaim(player, actions, context)     → one of `actions`, or { type: PASS }
 *        (used for Chi/Pon/Kong on a discard AND for self-declared Kongs)
 *   chooseWinDeclaration(player, winAction, context) → boolean
 *
 *   context = { ruleEngine, seatIndex, playerCount, seatWind, roundWind,
 *               dealerIndex, wallRemaining, drawnTile, table, discard? }
 *   table   = { discards: Tile[][] per seat, melds: Meld[][] per seat, … }
 */

import { AI_DIFFICULTY, AI_DIFFICULTY_LABEL } from '../utils/constants.js';

const REQUIRED = Object.freeze(['getStrategyId', 'getDisplayName', 'chooseDiscard', 'chooseClaim', 'chooseWinDeclaration']);

export class AIStrategyInterface {
  /**
   * @param {string} strategyId  an AI_DIFFICULTY value
   */
  constructor(strategyId) {
    if (new.target === AIStrategyInterface) throw new TypeError('[AIStrategyInterface] is abstract — extend it.');
    if (!Object.values(AI_DIFFICULTY).includes(strategyId)) throw new TypeError(`[AIStrategyInterface] unknown strategy id: ${strategyId}`);
    /** @private */ this._strategyId = strategyId;
  }

  getStrategyId() { return this._strategyId; }
  getDisplayName() { return AI_DIFFICULTY_LABEL[this._strategyId]; }

  // eslint-disable-next-line no-unused-vars
  chooseDiscard(player, context) { throw new Error(`${this.constructor.name} must implement chooseDiscard()`); }
  // eslint-disable-next-line no-unused-vars
  chooseClaim(player, actions, context) { throw new Error(`${this.constructor.name} must implement chooseClaim()`); }
  // eslint-disable-next-line no-unused-vars
  chooseWinDeclaration(player, winAction, context) { throw new Error(`${this.constructor.name} must implement chooseWinDeclaration()`); }
}

/** Duck-type check for strategy objects. */
export function isValidAIStrategy(strategy) {
  return !!strategy && REQUIRED.every((m) => typeof strategy[m] === 'function') &&
    Object.values(AI_DIFFICULTY).includes(strategy.getStrategyId());
}

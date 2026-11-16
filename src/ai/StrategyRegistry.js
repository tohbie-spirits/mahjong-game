/**
 * StrategyRegistry.js — Task 79: AI difficulty selection wiring.
 *
 * The one place that knows which AI difficulty tiers have a working
 * strategy and how to build them. main.js (new games), GameSnapshot.js
 * (restored games) and the tests all go through here, so a new tier only
 * has to be added once.
 *
 *   STRATEGY_FACTORIES                       { basic: () => BasicStrategy, advanced: () => AdvancedStrategy }
 *   getAvailableDifficulties(factories?)     → ids in AI_DIFFICULTY order (what the picker enables)
 *   isAvailableDifficulty(id, factories?)    → boolean
 *   createStrategy(id, factories?)           → a fresh strategy instance (throws for an unknown id)
 *   buildPlayerConfigs({ playerCount, difficulty | seatDifficulties, humanSeatIndex, humanName })
 *                                            → GameManager playerConfigs
 *   seatDifficulties(playerConfigs)          → distinct AI difficulties used by a table, in seat order
 *   createAIManagerForSeats(playerConfigs, { factories, pacingController })
 *                                            → AIManager with exactly one strategy per difficulty the
 *                                              table's AI seats use (throws if one has no factory)
 *
 * Design notes:
 *   - One strategy instance per DIFFICULTY, shared by every seat of that
 *     difficulty. Both strategies decide from (player, context) alone; the
 *     only per-instance state is diagnostic (AdvancedStrategy's
 *     lastDiscardMode / lastValueShanten / getFallbackCount()), which is
 *     fine to share.
 *   - Per-seat difficulties are supported (a mixed table, e.g. two Basic and
 *     one Advanced opponent). The New Game wizard still offers a single tier
 *     for all opponents; the mixed path is used by restored saves, the
 *     tests and Task 80's benchmark.
 *   - Factories are injectable everywhere so tests can swap in spies.
 */

import { AI_DIFFICULTY, SEAT_KIND } from '../utils/constants.js';
import { BasicStrategy } from './basic/BasicStrategy.js';
import { AdvancedStrategy } from './advanced/AdvancedStrategy.js';
import { AIManager } from './AIManager.js';

/** AI difficulty → strategy factory, for every tier with a working strategy. */
export const STRATEGY_FACTORIES = Object.freeze({
  [AI_DIFFICULTY.BASIC]: () => new BasicStrategy(),
  [AI_DIFFICULTY.ADVANCED]: () => new AdvancedStrategy(),
});

const TIER_ORDER = Object.freeze(Object.values(AI_DIFFICULTY));

function assertFactories(factories) {
  if (!factories || typeof factories !== 'object') throw new TypeError('[StrategyRegistry] factories must be an object of id → factory.');
}

/**
 * Difficulty ids that can be played, in AI_DIFFICULTY order (Basic first).
 * @param {Object<string, Function>} [factories=STRATEGY_FACTORIES]
 * @returns {string[]}
 */
export function getAvailableDifficulties(factories = STRATEGY_FACTORIES) {
  assertFactories(factories);
  return TIER_ORDER.filter((id) => typeof factories[id] === 'function');
}

/**
 * @param {string} id
 * @param {Object<string, Function>} [factories=STRATEGY_FACTORIES]
 */
export function isAvailableDifficulty(id, factories = STRATEGY_FACTORIES) {
  return getAvailableDifficulties(factories).includes(id);
}

/**
 * Builds a fresh strategy for a difficulty and checks it reports that id.
 * @param {string} id
 * @param {Object<string, Function>} [factories=STRATEGY_FACTORIES]
 */
export function createStrategy(id, factories = STRATEGY_FACTORIES) {
  assertFactories(factories);
  const make = factories[id];
  if (typeof make !== 'function') throw new Error(`[StrategyRegistry] no AI strategy available for difficulty "${id}".`);
  const strategy = make();
  const reported = typeof strategy?.getStrategyId === 'function' ? strategy.getStrategyId() : undefined;
  if (reported !== id) throw new Error(`[StrategyRegistry] factory for "${id}" built a strategy reporting "${reported}".`);
  return strategy;
}

/**
 * GameManager playerConfigs for a table with one human seat.
 *
 * @param {Object} options
 * @param {number} options.playerCount              3 or 4
 * @param {string} [options.difficulty]             one tier for every AI seat …
 * @param {(string|null)[]} [options.seatDifficulties]  … or one per seat (the human's entry is ignored)
 * @param {number} [options.humanSeatIndex=0]       pass -1 for an all-AI table
 * @param {string} [options.humanName='You']
 * @returns {{seatIndex:number, displayName:string, seatKind:string, aiDifficulty:string|null}[]}
 */
export function buildPlayerConfigs({ playerCount, difficulty, seatDifficulties, humanSeatIndex = 0, humanName = 'You' } = {}) {
  if (playerCount !== 3 && playerCount !== 4) throw new RangeError('[StrategyRegistry] playerCount must be 3 or 4.');
  if (!Number.isInteger(humanSeatIndex) || humanSeatIndex < -1 || humanSeatIndex >= playerCount) {
    throw new RangeError('[StrategyRegistry] humanSeatIndex must be a seat index, or -1 for no human.');
  }
  if ((difficulty === undefined) === (seatDifficulties === undefined)) {
    throw new TypeError('[StrategyRegistry] give exactly one of difficulty or seatDifficulties.');
  }
  if (seatDifficulties !== undefined && (!Array.isArray(seatDifficulties) || seatDifficulties.length !== playerCount)) {
    throw new RangeError('[StrategyRegistry] seatDifficulties must list one entry per seat.');
  }
  return Array.from({ length: playerCount }, (_, seatIndex) => {
    const human = seatIndex === humanSeatIndex;
    const tier = human ? null : (seatDifficulties ? seatDifficulties[seatIndex] : difficulty);
    if (!human && !TIER_ORDER.includes(tier)) throw new TypeError(`[StrategyRegistry] seat ${seatIndex}: unknown AI difficulty "${tier}".`);
    return {
      seatIndex,
      displayName: human ? humanName : `AI ${seatIndex}`,
      seatKind: human ? SEAT_KIND.HUMAN : SEAT_KIND.AI,
      aiDifficulty: tier,
    };
  });
}

/**
 * Distinct AI difficulties used by a table's AI seats, in seat order.
 * @param {{seatKind:string, aiDifficulty:string|null}[]} playerConfigs
 */
export function seatDifficulties(playerConfigs) {
  if (!Array.isArray(playerConfigs)) throw new TypeError('[StrategyRegistry] playerConfigs must be an array.');
  const out = [];
  for (const c of playerConfigs) {
    if (c?.seatKind === SEAT_KIND.AI && !out.includes(c.aiDifficulty)) out.push(c.aiDifficulty);
  }
  return out;
}

/**
 * An AIManager holding exactly the strategies the table's AI seats need.
 * Throws when an AI seat's difficulty has no factory, so a bad table fails
 * when it is set up rather than freezing on that seat's first turn.
 *
 * @param {Object[]} playerConfigs   GameManager playerConfigs (or PlayerManager-like objects)
 * @param {Object} [options]
 * @param {Object<string, Function>} [options.factories=STRATEGY_FACTORIES]
 * @param {import('./PacingController.js').PacingController} [options.pacingController]
 * @returns {AIManager}
 */
export function createAIManagerForSeats(playerConfigs, { factories = STRATEGY_FACTORIES, pacingController } = {}) {
  const tiers = seatDifficulties(playerConfigs);
  const strategies = tiers.map((id) => createStrategy(id, factories));
  return new AIManager({ strategies, ...(pacingController ? { pacingController } : {}) });
}

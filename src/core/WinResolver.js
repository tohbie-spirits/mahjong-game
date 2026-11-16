/**
 * WinResolver.js
 *
 * Builds winner records for Tsumo and Ron (Task 29), always scoring the
 * COMPLETE hand — for Ron via createHandViewWithExtraTile(), the Task 42 fix
 * for scoring a hand one tile short.
 *
 * Winner record:
 *   { seatIndex, displayName, winType: 'self'|'discard', winningTile,
 *     calledFrom (seat|null), fan, points, meetsMinimum, isLimit, structure,
 *     breakdown: [{id, name, fan}], hand (complete Hand view),
 *     score (the rule engine's full scoreHand result — Task 85) }
 *
 * REBUILT (after Task 77).
 */

import { createHandViewWithExtraTile } from './Hand.js';
import { WIN_SOURCE } from '../utils/constants.js';

function _record(player, winType, winningTile, calledFrom, score, hand) {
  return {
    seatIndex: player.seatIndex,
    displayName: player.displayName,
    winType,
    winningTile,
    calledFrom,
    fan: score.fan,
    points: score.points,
    meetsMinimum: score.meetsMinimum,
    isLimit: score.isLimit,
    structure: score.structure,
    breakdown: score.breakdown,
    hand,
    // Task 85: the rule engine's full score (Riichi adds han, fu, payments, …).
    score,
  };
}

/**
 * @param {Object} params
 * @param {import('./PlayerManager.js').PlayerManager} params.player  (hand already includes the drawn tile)
 * @param {import('./Tile.js').Tile} params.winningTile
 * @param {Object} params.ruleEngine
 * @param {Object} params.context  scoring context minus winType
 */
export function resolveTsumoWin({ player, winningTile, ruleEngine, context = {} }) {
  const hand = player.getHand().clone();
  const score = ruleEngine.scoreHand(hand, { ...context, winType: WIN_SOURCE.SELF, winningTile });
  return _record(player, WIN_SOURCE.SELF, winningTile, null, score, hand);
}

/**
 * @param {Object} params
 * @param {import('./PlayerManager.js').PlayerManager} params.player  (hand WITHOUT the claimed tile)
 * @param {import('./Tile.js').Tile} params.winningTile
 * @param {number} params.fromSeat
 * @param {Object} params.ruleEngine
 * @param {Object} params.context
 */
export function resolveRonWin({ player, winningTile, fromSeat, ruleEngine, context = {} }) {
  const hand = createHandViewWithExtraTile(player.getHand(), winningTile);
  const score = ruleEngine.scoreHand(hand, { ...context, winType: WIN_SOURCE.DISCARD, winningTile });
  return _record(player, WIN_SOURCE.DISCARD, winningTile, fromSeat, score, hand);
}

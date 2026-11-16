/**
 * DealingService.js
 *
 * Pure initial-hand dealing (Task 15): draws 13 tiles per seat from a wall,
 * in blocks of four starting with the dealer (three rounds of four, then one
 * each), the way tiles are dealt at a real table. The dealer's 14th tile is
 * NOT dealt here — the dealer simply draws first when play starts.
 *
 * REBUILT (after Task 77) from the project plan.
 */

import { HAND_SIZE } from '../utils/constants.js';

/**
 * @param {import('./WallManager.js').WallManager} wall
 * @param {number} playerCount  2–4
 * @param {Object} [options]
 * @param {number} [options.dealerIndex=0]
 * @param {number} [options.handSize=13]
 * @returns {import('./Tile.js').Tile[][]} one array per seat index
 */
export function dealInitialHands(wall, playerCount, options = {}) {
  const { dealerIndex = 0, handSize = HAND_SIZE } = options;
  if (!wall || typeof wall.draw !== 'function') throw new TypeError('[DealingService] wall must be a WallManager.');
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) {
    throw new RangeError(`[DealingService] playerCount must be 2–4; got ${playerCount}`);
  }
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= playerCount) {
    throw new RangeError(`[DealingService] dealerIndex out of range: ${dealerIndex}`);
  }
  if (!Number.isInteger(handSize) || handSize < 1) throw new RangeError('[DealingService] handSize must be a positive integer.');
  if (wall.remainingCount < handSize * playerCount) {
    throw new RangeError(`[DealingService] wall has ${wall.remainingCount} tiles; need ${handSize * playerCount} to deal.`);
  }

  const hands = Array.from({ length: playerCount }, () => []);
  const order = Array.from({ length: playerCount }, (_, i) => (dealerIndex + i) % playerCount);
  while (hands[order[0]].length < handSize) {
    for (const seat of order) {
      const block = Math.min(4, handSize - hands[seat].length);
      for (let k = 0; k < block; k++) hands[seat].push(wall.draw());
    }
  }
  return hands;
}

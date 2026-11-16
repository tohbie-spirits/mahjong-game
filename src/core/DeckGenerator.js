/**
 * DeckGenerator.js
 *
 * Assembles a shuffled deck for one hand from a ruleset's tile options:
 * generate the set (TileSetGenerator) → shuffle (ShuffleService).
 *
 * REBUILT (after Task 77) from the project plan.
 */

import { generateTileSet } from './TileSetGenerator.js';
import { shuffle, createSeededRandom } from './ShuffleService.js';

/**
 * @param {Object} [options]
 * @param {boolean} [options.includeBonus=false]
 * @param {string[]} [options.excludedFaceIds=[]]
 * @param {number} [options.seed]  when given, the shuffle is reproducible
 * @param {function(): number} [options.random]  explicit random source (wins over seed)
 * @returns {import('./Tile.js').Tile[]}
 */
export function createDeck(options = {}) {
  const { includeBonus = false, excludedFaceIds = [], seed, random } = options;
  const rng = typeof random === 'function'
    ? random
    : seed !== undefined ? createSeededRandom(seed) : Math.random;
  return shuffle(generateTileSet({ includeBonus, excludedFaceIds }), rng);
}

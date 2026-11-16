/**
 * TileSetGenerator.js
 *
 * Generates raw tile sets: the 34 standard faces × 4 copies (136 tiles),
 * plus optionally the 8 bonus tiles (4 flowers + 4 seasons, one copy each →
 * 144). Split out from DeckGenerator at Task 10 so set generation (pure,
 * ruleset-agnostic) and deck assembly (ruleset options) stay separate.
 *
 * REBUILT (after Task 77) from the project plan.
 */

import { Tile } from './Tile.js';
import { SUIT, NUMBERED_SUITS, WIND_ORDER, DRAGON_ORDER, COPIES_PER_TILE } from '../utils/constants.js';

/** The 34 standard face ids in conventional order. */
export const STANDARD_FACE_IDS = Object.freeze([
  ...NUMBERED_SUITS.flatMap((suit) => Array.from({ length: 9 }, (_, i) => `${suit}-${i + 1}`)),
  ...WIND_ORDER.map((w) => `${SUIT.WIND}-${w.id}`),
  ...DRAGON_ORDER.map((d) => `${SUIT.DRAGON}-${d}`),
]);

/** The 8 bonus face ids. */
export const BONUS_FACE_IDS = Object.freeze([
  ...[1, 2, 3, 4].map((n) => `${SUIT.FLOWER}-${n}`),
  ...[1, 2, 3, 4].map((n) => `${SUIT.SEASON}-${n}`),
]);

/**
 * @param {Object} [options]
 * @param {boolean} [options.includeBonus=false]  add flowers and seasons (one copy each)
 * @param {string[]} [options.excludedFaceIds=[]]  standard faces to leave out entirely
 *        (for variants that strip tiles, e.g. some 3-player rules)
 * @returns {Tile[]} a fresh, ordered (unshuffled) array
 */
export function generateTileSet(options = {}) {
  const { includeBonus = false, excludedFaceIds = [] } = options;
  if (!Array.isArray(excludedFaceIds)) throw new TypeError('[TileSetGenerator] excludedFaceIds must be an array.');
  for (const id of excludedFaceIds) {
    if (!STANDARD_FACE_IDS.includes(id)) throw new TypeError(`[TileSetGenerator] unknown face id to exclude: ${id}`);
  }
  const excluded = new Set(excludedFaceIds);
  const tiles = [];
  for (const faceId of STANDARD_FACE_IDS) {
    if (excluded.has(faceId)) continue;
    for (let copy = 1; copy <= COPIES_PER_TILE; copy++) {
      tiles.push(Tile.fromId(faceId, `${faceId}#${copy}`));
    }
  }
  if (includeBonus) {
    for (const faceId of BONUS_FACE_IDS) tiles.push(Tile.fromId(faceId, `${faceId}#1`));
  }
  return tiles;
}

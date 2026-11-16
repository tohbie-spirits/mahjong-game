/**
 * DrawResolver.js
 *
 * Exhaustive-draw resolution (Task 30): when the wall runs out, report which
 * players were tenpai (one tile from a structurally complete hand) and their
 * waits. Ruleset-agnostic — it only asks the rule engine's checkWin().
 * Tenpai payments are ruleset-specific and not applied here (Task 60).
 *
 * REBUILT (after Task 77).
 */

import { createHandViewWithExtraTile } from './Hand.js';
import { STANDARD_FACE_IDS } from './TileSetGenerator.js';
import { Tile } from './Tile.js';

/**
 * Faces that would complete `hand` (structurally).
 * @returns {string[]} face ids
 */
export function findWaits(hand, ruleEngine) {
  const waits = [];
  for (const faceId of STANDARD_FACE_IDS) {
    const probe = Tile.fromId(faceId, `${faceId}#probe`);
    if (ruleEngine.checkWin(createHandViewWithExtraTile(hand, probe)).isWin) waits.push(faceId);
  }
  return waits;
}

/**
 * @param {import('./PlayerManager.js').PlayerManager[]} players
 * @param {Object} ruleEngine
 * @returns {{ seatIndex: number, displayName: string, tenpai: boolean, waits: string[] }[]}
 */
export function resolveExhaustiveDraw(players, ruleEngine) {
  return players.map((p) => {
    const waits = findWaits(p.getHand(), ruleEngine);
    return { seatIndex: p.seatIndex, displayName: p.displayName, tenpai: waits.length > 0, waits };
  });
}

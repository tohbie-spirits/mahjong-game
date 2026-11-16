/**
 * RiichiDora.js — dora indicators and the dead wall (Task 88).
 *
 * DEAD WALL LAYOUT (14 tiles, WallManager#getReservedDeadWallTiles order):
 *   [0–3]   Kan replacement tiles (WallManager#drawReplacement takes them in order)
 *   [4–8]   dora indicators — the first is revealed at the start of the hand,
 *           one more after each Kan (kan dora)
 *   [9–13]  ura-dora indicators — under each revealed dora indicator, read
 *           only for a riichi winner
 * DORA = the tile after the indicator: 1→2 … 9→1 in each suit; winds
 * East → South → West → North → East; dragons White → Green → Red → White.
 * In three-player (characters 2–8 removed) a 1-characters indicator points
 * at 9-characters (option sanmaCharacterWrap).
 * RED FIVES (option redFives: 0 | 3): copy #1 of the 5 of each suit
 * (instance id "…-5#1") is a red five worth one extra dora.
 * Every copy of a dora tile in the whole hand (melds included) counts once
 * per indicator that points at it.
 */

import { kindOfFaceId, faceIdOfKind, HONOR_START } from './RiichiHandAnalysis.js';

export const DEAD_WALL_SIZE = 14;
export const MAX_DORA_INDICATORS = 5;
const DRAGON_NEXT = Object.freeze({ 33: 32, 32: 31, 31: 33 }); // white → green → red → white

/**
 * The dora face pointed at by an indicator face.
 * @param {string} indicatorFaceId
 * @param {{ sanma?: boolean }} [opts]  three-player: 1-characters → 9-characters
 * @returns {string}
 */
export function doraFromIndicator(indicatorFaceId, { sanma = false } = {}) {
  const k = kindOfFaceId(indicatorFaceId);
  if (k < HONOR_START) {
    const suitStart = k - (k % 9);
    if (sanma && suitStart === 18 && k === 18) return faceIdOfKind(26);
    return faceIdOfKind(suitStart + ((k % 9) + 1) % 9);
  }
  if (k < HONOR_START + 4) return faceIdOfKind(HONOR_START + ((k - HONOR_START + 1) % 4));
  return faceIdOfKind(DRAGON_NEXT[k]);
}

/** True for a red five under `redFives` (0 = none, 3 = one per suit). */
export function isRedFive(tile, redFives = 0) {
  return redFives > 0 && tile?.isSuited === true && tile.value === 5 && tile.instanceId === `${tile.id}#1`;
}

/**
 * Splits a reserved dead wall into its parts.
 * @param {Object[]} deadWallTiles  14 tiles in WallManager order
 */
export function deadWallLayout(deadWallTiles) {
  if (!Array.isArray(deadWallTiles) || deadWallTiles.length !== DEAD_WALL_SIZE) {
    throw new RangeError(`[RiichiDora] the dead wall must hold ${DEAD_WALL_SIZE} tiles.`);
  }
  return {
    replacements: deadWallTiles.slice(0, 4),
    doraIndicators: deadWallTiles.slice(4, 9),
    uraIndicators: deadWallTiles.slice(9, 14),
  };
}

/**
 * How many dora a set of tiles holds for some indicators.
 * @param {Object[]} tiles             all the hand's tiles (concealed + melds)
 * @param {Object[]} indicators        indicator tiles
 * @param {{ sanma?: boolean }} [opts]
 */
export function countDora(tiles, indicators, opts = {}) {
  let n = 0;
  for (const ind of indicators) {
    const dora = doraFromIndicator(ind.id, opts);
    for (const t of tiles) if (t.id === dora) n++;
  }
  return n;
}

/**
 * Per-hand dora state: which indicators are revealed.
 *   new RiichiDoraState(wall.getReservedDeadWallTiles(), { sanma, kanDora, uraDora, kanUraDora, redFives })
 *   .revealKanDora() · .getDoraIndicators() · .getUraIndicators() · .doraContext(hand, { isRiichi })
 */
export class RiichiDoraState {
  constructor(deadWallTiles, { sanma = false, kanDora = true, uraDora = true, kanUraDora = true, redFives = 0 } = {}) {
    this._layout = deadWallLayout(deadWallTiles);
    this._opts = Object.freeze({ sanma, kanDora, uraDora, kanUraDora, redFives });
    this._revealed = 1;
  }

  /** Number of dora indicators showing (1 + one per Kan, at most 5). */
  get revealedCount() { return this._revealed; }

  /** Reveals the next indicator after a Kan (no-op when kanDora is off or all 5 show). */
  revealKanDora() {
    if (this._opts.kanDora && this._revealed < MAX_DORA_INDICATORS) this._revealed++;
    return this._revealed;
  }

  getDoraIndicators() { return this._layout.doraIndicators.slice(0, this._revealed); }

  /** Ura indicators under the revealed ones (only the first when kanUraDora is off). */
  getUraIndicators() {
    if (!this._opts.uraDora) return [];
    return this._layout.uraIndicators.slice(0, this._opts.kanUraDora ? this._revealed : 1);
  }

  /** Faces that are currently dora. */
  getDoraFaces() { return this.getDoraIndicators().map((t) => doraFromIndicator(t.id, this._opts)); }

  /**
   * The scoring context's `dora` field for a complete hand (Task 85).
   * @param {import('../../core/Hand.js').Hand} hand  complete hand (winning tile included)
   * @param {{ isRiichi?: boolean }} [opts]  ura dora count only for a riichi winner
   * @returns {{ dora: number, uraDora: number, akaDora: number }}
   */
  doraContext(hand, { isRiichi = false } = {}) {
    const tiles = [...hand.concealedTiles, ...hand.melds.flatMap((m) => m.tiles)];
    return {
      dora: countDora(tiles, this.getDoraIndicators(), this._opts),
      uraDora: isRiichi ? countDora(tiles, this.getUraIndicators(), this._opts) : 0,
      akaDora: tiles.filter((t) => isRedFive(t, this._opts.redFives)).length,
    };
  }

  toJSON() { return { revealed: this._revealed }; }
  restoreState({ revealed }) {
    if (!Number.isInteger(revealed) || revealed < 1 || revealed > MAX_DORA_INDICATORS) throw new RangeError('[RiichiDora] revealed must be 1–5.');
    this._revealed = revealed;
  }
}

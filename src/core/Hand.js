/**
 * Hand.js
 *
 * A player's hand: concealed tiles plus declared melds (Chi / Pon / Kong).
 *
 * REBUILT (after Task 77) from the project plan: Task 17 (concealed/melded
 * structure); HandRenderer's use of `concealedTiles`, `concealedCount`,
 * `melds` (type, tiles, concealed, calledTile) and `sortConcealed()`;
 * GameSnapshot's meld form {type, tiles, concealed, calledFrom, calledTile};
 * and Task 42's canonical `createHandViewWithExtraTile()` export (a temporary
 * complete-hand view for scoring a Ron without mutating the real hand).
 *
 * Accessors return COPIES — callers can't reorder or mutate the real state.
 */

import { Tile } from './Tile.js';
import { MELD_TYPE, KONG_TYPE } from '../utils/constants.js';

// ---------------------------------------------------------------------------
// Meld
// ---------------------------------------------------------------------------

export class Meld {
  /**
   * @param {Object} spec
   * @param {string} spec.type          MELD_TYPE
   * @param {Tile[]} spec.tiles         3 tiles (Chi/Pon) or 4 (Kong)
   * @param {boolean} [spec.concealed=false]  only a concealed Kong is concealed
   * @param {number|null} [spec.calledFrom=null]  seat index the claimed tile came from
   * @param {Tile|null} [spec.calledTile=null]    the claimed tile (one of `tiles`)
   * @param {string|null} [spec.kongType=null]    KONG_TYPE for Kongs (inferred when omitted)
   */
  constructor({ type, tiles, concealed = false, calledFrom = null, calledTile = null, kongType = null } = {}) {
    if (!Object.values(MELD_TYPE).includes(type)) throw new TypeError(`[Meld] unknown meld type: ${type}`);
    if (!Array.isArray(tiles) || !tiles.every((t) => t instanceof Tile)) throw new TypeError('[Meld] tiles must be an array of Tile.');
    const size = type === MELD_TYPE.KONG ? 4 : 3;
    if (tiles.length !== size) throw new TypeError(`[Meld] a ${type} needs ${size} tiles; got ${tiles.length}.`);

    if (type === MELD_TYPE.CHI) {
      const sorted = tiles.slice().sort(Tile.compare);
      const ok = sorted.every((t) => t.isSuited && t.suit === sorted[0].suit) &&
        sorted[1].value === sorted[0].value + 1 && sorted[2].value === sorted[0].value + 2;
      if (!ok) throw new TypeError('[Meld] a chi must be three consecutive tiles of one suit.');
      if (concealed) throw new TypeError('[Meld] a chi is always an exposed meld.');
    } else if (!tiles.every((t) => t.id === tiles[0].id)) {
      throw new TypeError(`[Meld] a ${type} must be identical tiles.`);
    }
    if (type === MELD_TYPE.PON && concealed) throw new TypeError('[Meld] a declared pon is always exposed.');
    if (calledTile !== null && !tiles.includes(calledTile)) throw new TypeError('[Meld] calledTile must be one of the meld tiles.');
    if (calledFrom !== null && (!Number.isInteger(calledFrom) || calledFrom < 0)) throw new TypeError('[Meld] calledFrom must be a seat index or null.');

    this.type = type;
    this.tiles = Object.freeze(type === MELD_TYPE.CHI ? tiles.slice().sort(Tile.compare) : tiles.slice());
    this.concealed = concealed === true;
    this.calledFrom = calledFrom;
    this.calledTile = calledTile;
    this.kongType = type === MELD_TYPE.KONG
      ? (kongType ?? (concealed ? KONG_TYPE.CONCEALED : KONG_TYPE.EXPOSED))
      : null;
    if (this.kongType !== null && !Object.values(KONG_TYPE).includes(this.kongType)) throw new TypeError(`[Meld] unknown kongType: ${kongType}`);
    Object.freeze(this);
  }

  get isKong() { return this.type === MELD_TYPE.KONG; }
  get isChi() { return this.type === MELD_TYPE.CHI; }
  get isPon() { return this.type === MELD_TYPE.PON; }

  /** Face id for Pon/Kong (all tiles identical); the lowest tile's face for Chi. */
  get faceId() { return this.tiles[0].id; }

  /** A new added-Kong meld from this Pon plus the fourth tile. */
  upgradeToKong(tile) {
    if (!this.isPon) throw new Error('[Meld] only a pon can be upgraded to a kong.');
    if (!(tile instanceof Tile) || tile.id !== this.faceId) throw new TypeError('[Meld] upgrade tile must match the pon.');
    return new Meld({
      type: MELD_TYPE.KONG,
      tiles: [...this.tiles, tile],
      concealed: false,
      calledFrom: this.calledFrom,
      calledTile: this.calledTile,
      kongType: KONG_TYPE.ADDED,
    });
  }

  toJSON() {
    return {
      type: this.type,
      tiles: this.tiles.map((t) => t.toJSON()),
      concealed: this.concealed,
      calledFrom: this.calledFrom,
      calledTile: this.calledTile ? this.calledTile.toJSON() : null,
      kongType: this.kongType,
    };
  }

  /** Rebuilds a meld from toJSON() data; calledTile resolved by instanceId. */
  static fromJSON(json) {
    const tiles = json.tiles.map((t) => Tile.fromJSON(t));
    const calledTile = json.calledTile ? tiles.find((t) => t.instanceId === json.calledTile.instanceId) ?? null : null;
    return new Meld({
      type: json.type,
      tiles,
      concealed: json.concealed === true,
      calledFrom: json.calledFrom ?? null,
      calledTile,
      kongType: json.kongType ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------

export class Hand {
  /**
   * @param {Tile[]} [concealedTiles=[]]
   * @param {Meld[]} [melds=[]]
   */
  constructor(concealedTiles = [], melds = []) {
    /** @private */ this._concealed = [];
    /** @private */ this._melds = [];
    for (const t of concealedTiles) this.addConcealedTile(t);
    for (const m of melds) this.addMeld(m);
  }

  /** Copy of the concealed tiles, in current (unsorted unless sorted) order. */
  get concealedTiles() { return this._concealed.slice(); }

  /** Number of concealed tiles — all an opponent view may read. */
  get concealedCount() { return this._concealed.length; }

  /** Copy of the melds. */
  get melds() { return this._melds.slice(); }

  get meldCount() { return this._melds.length; }

  /** True when no exposed meld has been declared (a concealed Kong keeps the hand concealed). */
  get isConcealed() { return this._melds.every((m) => m.concealed); }

  /** Concealed tiles plus every meld tile. */
  get allTiles() { return [...this._concealed, ...this._melds.flatMap((m) => m.tiles)]; }

  /** Total tiles counting a Kong as 3 (the size the 3n+1 / 3n+2 rule uses). */
  get effectiveSize() { return this._concealed.length + this._melds.length * 3; }

  /** @param {Tile} tile */
  addConcealedTile(tile) {
    if (!(tile instanceof Tile)) throw new TypeError('[Hand] addConcealedTile requires a Tile.');
    if (this._concealed.some((t) => t.instanceId === tile.instanceId)) {
      throw new Error(`[Hand] tile ${tile.instanceId} is already in the hand.`);
    }
    this._concealed.push(tile);
  }

  /**
   * Removes one specific concealed tile.
   * @param {Tile|string} tileOrInstanceId
   * @returns {Tile} the removed tile
   */
  removeConcealedTile(tileOrInstanceId) {
    const instanceId = typeof tileOrInstanceId === 'string' ? tileOrInstanceId : tileOrInstanceId?.instanceId;
    const i = this._concealed.findIndex((t) => t.instanceId === instanceId);
    if (i < 0) throw new Error(`[Hand] tile ${instanceId} is not in the concealed hand.`);
    return this._concealed.splice(i, 1)[0];
  }

  /**
   * Removes `count` concealed tiles of a face (any copies).
   * @param {string} faceId
   * @param {number} [count=1]
   * @returns {Tile[]}
   */
  removeConcealedByFace(faceId, count = 1) {
    if (this.countFace(faceId) < count) throw new Error(`[Hand] need ${count} × ${faceId}; have ${this.countFace(faceId)}.`);
    const removed = [];
    for (let k = 0; k < count; k++) {
      const i = this._concealed.findIndex((t) => t.id === faceId);
      removed.push(this._concealed.splice(i, 1)[0]);
    }
    return removed;
  }

  /** Concealed copies of a face. */
  countFace(faceId) {
    let n = 0;
    for (const t of this._concealed) if (t.id === faceId) n++;
    return n;
  }

  hasFace(faceId) { return this.countFace(faceId) > 0; }

  /** First concealed tile of a face, or null. */
  findByFace(faceId) { return this._concealed.find((t) => t.id === faceId) ?? null; }

  /** @param {Meld} meld */
  addMeld(meld) {
    if (!(meld instanceof Meld)) throw new TypeError('[Hand] addMeld requires a Meld.');
    if (this._melds.length >= 4) throw new Error('[Hand] a hand cannot have more than four melds.');
    this._melds.push(meld);
  }

  /** Replaces the meld at `index` (used when a Pon becomes an added Kong). */
  replaceMeld(index, meld) {
    if (!(meld instanceof Meld)) throw new TypeError('[Hand] replaceMeld requires a Meld.');
    if (!Number.isInteger(index) || index < 0 || index >= this._melds.length) throw new RangeError(`[Hand] no meld at index ${index}.`);
    this._melds[index] = meld;
  }

  /** Sorts the concealed tiles in place (Tile.compare). */
  sortConcealed() {
    this._concealed.sort(Tile.compare);
  }

  /** Independent copy (same Tile objects, new arrays). */
  clone() {
    return new Hand(this._concealed, this._melds);
  }

  toJSON() {
    return {
      concealedTiles: this._concealed.map((t) => t.toJSON()),
      melds: this._melds.map((m) => m.toJSON()),
    };
  }
}

/**
 * Task 42's canonical helper: a temporary view of `hand` with `tile` added to
 * the concealed tiles — for scoring a Ron (or testing a draw) WITHOUT
 * mutating the real hand. Returns a new Hand.
 * @param {Hand} hand
 * @param {Tile} tile
 * @returns {Hand}
 */
export function createHandViewWithExtraTile(hand, tile) {
  if (!(hand instanceof Hand)) throw new TypeError('[Hand] createHandViewWithExtraTile requires a Hand.');
  const view = hand.clone();
  view.addConcealedTile(tile);
  return view;
}

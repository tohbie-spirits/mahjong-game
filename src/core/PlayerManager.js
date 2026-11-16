/**
 * PlayerManager.js
 *
 * One seat's state: identity (seat index, display name, human/AI, AI
 * difficulty), seat wind, running score, and the current hand + discard pile.
 *
 * REBUILT (after Task 77) from the project plan: Task 16 (player state
 * model), playerConfigs {seatIndex, displayName, seatKind, aiDifficulty},
 * Task 49 (seatWind null before winds are dealt), Task 60 (addScore),
 * Task 65 (addTileToHand / addMeld / getDiscardPile used by hydration).
 */

import { Hand, Meld } from './Hand.js';
import { DiscardPile } from './DiscardPile.js';
import { Tile } from './Tile.js';
import { SEAT_KIND, AI_DIFFICULTY, WIND_ORDER, STARTING_SCORE } from '../utils/constants.js';

export class PlayerManager {
  /**
   * @param {Object} config
   * @param {number} config.seatIndex
   * @param {string} [config.displayName]
   * @param {string} [config.seatKind=SEAT_KIND.AI]
   * @param {string|null} [config.aiDifficulty=null]  required for AI seats
   * @param {number} [config.score=STARTING_SCORE]
   */
  constructor({ seatIndex, displayName, seatKind = SEAT_KIND.AI, aiDifficulty = null, score = STARTING_SCORE } = {}) {
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 3) throw new RangeError(`[PlayerManager] seatIndex must be 0–3; got ${seatIndex}`);
    if (!Object.values(SEAT_KIND).includes(seatKind)) throw new TypeError(`[PlayerManager] unknown seatKind: ${seatKind}`);
    if (seatKind === SEAT_KIND.AI && !Object.values(AI_DIFFICULTY).includes(aiDifficulty)) {
      throw new TypeError(`[PlayerManager] AI seats need an aiDifficulty; got ${aiDifficulty}`);
    }
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new TypeError('[PlayerManager] score must be a finite number.');

    this.seatIndex = seatIndex;
    this.displayName = typeof displayName === 'string' && displayName !== '' ? displayName : `Player ${seatIndex + 1}`;
    this.seatKind = seatKind;
    this.aiDifficulty = seatKind === SEAT_KIND.AI ? aiDifficulty : null;
    /** @private */ this._score = score;
    /** @private */ this._seatWind = null;
    /** @private */ this._hand = new Hand();
    /** @private */ this._discards = new DiscardPile();
  }

  get isHuman() { return this.seatKind === SEAT_KIND.HUMAN; }
  get isAI() { return this.seatKind === SEAT_KIND.AI; }

  /** Running session score. */
  get score() { return this._score; }

  /**
   * Adds (or with a negative delta, subtracts) points.
   * @param {number} delta
   * @returns {number} the new score
   */
  addScore(delta) {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) throw new TypeError('[PlayerManager] addScore requires a finite number.');
    this._score += delta;
    return this._score;
  }

  /** The seat's WIND object, or null before winds are assigned. */
  get seatWind() { return this._seatWind; }

  set seatWind(wind) {
    if (wind !== null && !WIND_ORDER.includes(wind)) throw new TypeError('[PlayerManager] seatWind must be a WIND value or null.');
    this._seatWind = wind;
  }

  /** @returns {Hand} the live hand (mutate through this manager's methods). */
  getHand() { return this._hand; }

  /** @returns {DiscardPile} */
  getDiscardPile() { return this._discards; }

  /** @param {Tile} tile */
  addTileToHand(tile) {
    this._hand.addConcealedTile(tile);
  }

  /** @param {Tile|string} tileOrInstanceId @returns {Tile} */
  removeTileFromHand(tileOrInstanceId) {
    return this._hand.removeConcealedTile(tileOrInstanceId);
  }

  /**
   * Moves a concealed tile to the discard pile.
   * @param {Tile|string} tileOrInstanceId
   * @returns {import('./DiscardPile.js').DiscardEntry}
   */
  discardTile(tileOrInstanceId) {
    const tile = this._hand.removeConcealedTile(tileOrInstanceId);
    return this._discards.discard(tile);
  }

  /** @param {Meld} meld */
  addMeld(meld) {
    this._hand.addMeld(meld);
  }

  /** Fresh hand and discard pile for the next deal (score and seat kept). */
  resetForNewHand() {
    this._hand = new Hand();
    this._discards = new DiscardPile();
  }

  /** The config this player was built from (for restarts/snapshots). */
  toConfig() {
    return { seatIndex: this.seatIndex, displayName: this.displayName, seatKind: this.seatKind, aiDifficulty: this.aiDifficulty };
  }
}

export { Tile, Meld };

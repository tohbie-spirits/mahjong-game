/**
 * Tile.js
 *
 * One physical tile. Two identities:
 *   - `id`         — the FACE, shared by all four copies: 'dots-5', 'wind-east',
 *                    'dragon-red', 'flower-2'. Rules compare faces.
 *   - `instanceId` — unique per physical tile in a set: 'dots-5#2'. Used to
 *                    move one specific tile between wall, hand, melds and
 *                    discards, and stored in save snapshots as {id, instanceId}.
 *
 * REBUILT (after Task 77) from the project plan (Task 9; Tile.compare used by
 * HandRenderer; "Discard 5 of Dots" aria labels; snapshots storing
 * {id, instanceId}; Tile.fromId-style hydration in GameSnapshot).
 *
 * Tiles are immutable after construction.
 */

import { SUIT, SUIT_LABEL, NUMBERED_SUITS, WIND, WIND_ORDER, DRAGON, DRAGON_ORDER, DRAGON_LABEL } from '../utils/constants.js';

const SUIT_SORT = Object.freeze({
  [SUIT.DOTS]: 0,
  [SUIT.BAMBOO]: 1,
  [SUIT.CHARACTERS]: 2,
  [SUIT.WIND]: 3,
  [SUIT.DRAGON]: 4,
  [SUIT.FLOWER]: 5,
  [SUIT.SEASON]: 6,
});

const WIND_IDS = WIND_ORDER.map((w) => w.id);

export class Tile {
  /**
   * @param {Object} spec
   * @param {string} spec.suit   one of SUIT
   * @param {number|string} spec.value  rank 1–9 (numbered suits), wind id
   *        ('east'…), dragon id ('red'…), or 1–4 (flower/season)
   * @param {number} [spec.copy=1]  which physical copy (1–4); forms instanceId
   * @param {string} [spec.instanceId]  explicit instance id (overrides copy)
   */
  constructor({ suit, value, copy = 1, instanceId } = {}) {
    if (!Object.values(SUIT).includes(suit)) {
      throw new TypeError(`[Tile] unknown suit: ${JSON.stringify(suit)}`);
    }
    if (NUMBERED_SUITS.includes(suit)) {
      if (!Number.isInteger(value) || value < 1 || value > 9) throw new TypeError(`[Tile] ${suit} rank must be 1–9; got ${value}`);
    } else if (suit === SUIT.WIND) {
      if (!WIND_IDS.includes(value)) throw new TypeError(`[Tile] wind must be one of ${WIND_IDS.join(', ')}; got ${value}`);
    } else if (suit === SUIT.DRAGON) {
      if (!DRAGON_ORDER.includes(value)) throw new TypeError(`[Tile] dragon must be one of ${DRAGON_ORDER.join(', ')}; got ${value}`);
    } else if (!Number.isInteger(value) || value < 1 || value > 4) {
      throw new TypeError(`[Tile] ${suit} number must be 1–4; got ${value}`);
    }

    /** @type {string} */ this.suit = suit;
    /** @type {number|string} */ this.value = value;
    /** Face id shared by all copies. @type {string} */ this.id = `${suit}-${value}`;
    /** Unique per physical tile. @type {string} */
    this.instanceId = typeof instanceId === 'string' && instanceId !== '' ? instanceId : `${this.id}#${copy}`;
    Object.freeze(this);
  }

  /** Numbered suit rank 1–9, or null. */
  get rank() {
    return this.isSuited ? this.value : null;
  }

  /** Dots / Bamboo / Characters. */
  get isSuited() {
    return NUMBERED_SUITS.includes(this.suit);
  }

  /** Wind or Dragon. */
  get isHonor() {
    return this.suit === SUIT.WIND || this.suit === SUIT.DRAGON;
  }

  /** Flower or Season. */
  get isBonus() {
    return this.suit === SUIT.FLOWER || this.suit === SUIT.SEASON;
  }

  /** Suited 1 or 9. */
  get isTerminal() {
    return this.isSuited && (this.value === 1 || this.value === 9);
  }

  /** Terminal or honour. */
  get isTerminalOrHonor() {
    return this.isTerminal || this.isHonor;
  }

  /** Suited 2–8. */
  get isSimple() {
    return this.isSuited && this.value >= 2 && this.value <= 8;
  }

  /** The WIND object for a wind tile, else null. */
  get wind() {
    return this.suit === SUIT.WIND ? WIND_ORDER.find((w) => w.id === this.value) : null;
  }

  /** Human-readable name: "5 of Dots", "East Wind", "Red Dragon", "Flower 2". */
  get label() {
    if (this.isSuited) return `${this.value} of ${SUIT_LABEL[this.suit]}`;
    if (this.suit === SUIT.WIND) return `${this.wind.label} Wind`;
    if (this.suit === SUIT.DRAGON) return DRAGON_LABEL[this.value];
    return `${SUIT_LABEL[this.suit]} ${this.value}`;
  }

  /** Same face (any copy). */
  sameFace(other) {
    return other instanceof Tile && other.id === this.id;
  }

  /** Next rank in the same suit (for sequences), or null. */
  nextInSuit(step = 1) {
    if (!this.isSuited) return null;
    const r = this.value + step;
    return r >= 1 && r <= 9 ? `${this.suit}-${r}` : null;
  }

  /** {id, instanceId} — the snapshot form. */
  toJSON() {
    return { id: this.id, instanceId: this.instanceId };
  }

  toString() {
    return this.label;
  }

  /**
   * Conventional ordering: Dots, Bamboo, Characters (by rank), then winds
   * (E S W N), dragons (R G W), flowers, seasons. Ties by instanceId so
   * sorting is fully deterministic.
   */
  static compare(a, b) {
    const s = SUIT_SORT[a.suit] - SUIT_SORT[b.suit];
    if (s !== 0) return s;
    const v = Tile._valueOrder(a) - Tile._valueOrder(b);
    if (v !== 0) return v;
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
  }

  /** @private */
  static _valueOrder(t) {
    if (t.suit === SUIT.WIND) return WIND_IDS.indexOf(t.value);
    if (t.suit === SUIT.DRAGON) return DRAGON_ORDER.indexOf(t.value);
    return t.value;
  }

  /**
   * Parses a face id ('dots-5', 'wind-east') back into a Tile.
   * @param {string} id
   * @param {string} [instanceId]
   * @returns {Tile}
   */
  static fromId(id, instanceId) {
    if (typeof id !== 'string') throw new TypeError(`[Tile] fromId requires a string; got ${id}`);
    const dash = id.indexOf('-');
    if (dash <= 0) throw new TypeError(`[Tile] malformed tile id: ${id}`);
    const suit = id.slice(0, dash);
    const raw = id.slice(dash + 1);
    const numeric = suit !== SUIT.WIND && suit !== SUIT.DRAGON;
    const value = numeric ? Number(raw) : raw;
    return new Tile({ suit, value, instanceId });
  }

  /** Rebuilds a Tile from its snapshot form {id, instanceId}. */
  static fromJSON(json) {
    if (!json || typeof json !== 'object') throw new TypeError('[Tile] fromJSON requires {id, instanceId}.');
    return Tile.fromId(json.id, json.instanceId);
  }
}

/** Convenience: face ids of every wind and dragon, for rules code. */
export const HONOR_FACE_IDS = Object.freeze([
  ...WIND_ORDER.map((w) => `${SUIT.WIND}-${w.id}`),
  ...DRAGON_ORDER.map((d) => `${SUIT.DRAGON}-${d}`),
]);

/** Face id of a wind object, e.g. windFaceId(WIND.EAST) → 'wind-east'. */
export function windFaceId(wind) {
  return `${SUIT.WIND}-${wind.id}`;
}

/** Face id of a dragon value, e.g. dragonFaceId(DRAGON.RED) → 'dragon-red'. */
export function dragonFaceId(dragon) {
  return `${SUIT.DRAGON}-${dragon}`;
}

export { WIND, DRAGON };

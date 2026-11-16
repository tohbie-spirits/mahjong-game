/**
 * DiscardPile.js
 *
 * One player's discards, oldest first (Task 18). Each entry records whether
 * another player claimed it (Chi/Pon/Kong/Ron) — renderers mark claimed
 * discards with `tile--claimed`, snapshots store {id, instanceId, claimed,
 * claimedBy, claimedAction}.
 *
 * REBUILT (after Task 77) from the project plan.
 */

import { Tile } from './Tile.js';

export class DiscardEntry {
  /** @param {Tile} tile */
  constructor(tile) {
    if (!(tile instanceof Tile)) throw new TypeError('[DiscardEntry] requires a Tile.');
    this.tile = tile;
    this.claimed = false;
    this.claimedBy = null;
    this.claimedAction = null;
    /** Ruleset-specific flags (e.g. Riichi's sideways riichi tile). Not serialised. */
    this._tags = new Set();
  }

  /**
   * @param {number|null} [claimedBy=null]  seat index of the claimer
   * @param {string|null} [claimedAction=null]  ACTION_TYPE of the claim
   */
  markClaimed(claimedBy = null, claimedAction = null) {
    this.claimed = true;
    this.claimedBy = claimedBy;
    this.claimedAction = claimedAction;
  }

  addTag(tag) { this._tags.add(tag); }
  hasTag(tag) { return this._tags.has(tag); }

  toJSON() {
    return { ...this.tile.toJSON(), claimed: this.claimed, claimedBy: this.claimedBy, claimedAction: this.claimedAction };
  }
}

export class DiscardPile {
  constructor() {
    /** @private @type {DiscardEntry[]} */
    this._entries = [];
  }

  /**
   * Adds a discard.
   * @param {Tile} tile
   * @returns {DiscardEntry}
   */
  discard(tile) {
    const entry = new DiscardEntry(tile);
    this._entries.push(entry);
    return entry;
  }

  /** Copy of the entries, oldest first. */
  get entries() { return this._entries.slice(); }

  /** Discarded tiles, oldest first (claimed ones included). */
  get tiles() { return this._entries.map((e) => e.tile); }

  get length() { return this._entries.length; }

  /** The most recent entry, or null. */
  get last() { return this._entries.length ? this._entries[this._entries.length - 1] : null; }

  /** Marks the most recent discard as claimed. */
  markLastClaimed(claimedBy, claimedAction) {
    const last = this.last;
    if (!last) throw new Error('[DiscardPile] nothing to claim.');
    if (last.claimed) throw new Error('[DiscardPile] the last discard is already claimed.');
    last.markClaimed(claimedBy, claimedAction);
    return last;
  }

  /** True if this player has discarded a tile of `faceId` (genbutsu checks). */
  containsFace(faceId) {
    return this._entries.some((e) => e.tile.id === faceId);
  }
}

/**
 * WallManager.js
 *
 * The wall: the shuffled tiles left to draw. Owns the draw cursor, the end of
 * the live wall, and an optional dead wall (Riichi reserves 14 tiles that are
 * never drawn normally; Hong Kong reserves none).
 *
 * REBUILT (after Task 77) from the project plan: Task 13 (wall building),
 * Task 14 (dead-wall hook), Task 48 (`remainingCount` excludes the dead wall;
 * `peekUpcoming()` is engine-only), Task 65 (`getWallStateSnapshot()` returns
 * all six private fields; `static restore()` rebuilds a wall mid-hand with
 * the cursor preserved exactly).
 *
 * Layout of `_tiles` (indices):
 *
 *   [0 ……… _drawIndex) drawn · [_drawIndex ……… _liveWallEnd) live ·
 *   [_deadWallStart ……… length) dead wall (when reserved)
 *
 * Replacement draws (after a Kong):
 *   - with a dead wall: taken from the dead wall (`_deadWallDrawIndex` moves
 *     forward) and the live wall shrinks by one so the dead wall keeps its size;
 *   - without one (Hong Kong): taken from the far end of the live wall.
 */

export class WallManager {
  /**
   * @param {import('./Tile.js').Tile[]} tiles  already shuffled
   */
  constructor(tiles) {
    if (!Array.isArray(tiles)) throw new TypeError('[WallManager] constructor requires an array of tiles.');
    /** @private */ this._tiles = tiles.slice();
    /** @private */ this._drawIndex = 0;
    /** @private */ this._liveWallEnd = this._tiles.length;
    /** @private */ this._deadWallReserved = 0;
    /** @private */ this._deadWallStart = this._tiles.length;
    /** @private */ this._deadWallDrawIndex = this._tiles.length;
  }

  /**
   * Reserves the last `size` tiles as a dead wall. Must happen before any draw.
   * @param {number} size
   */
  reserveDeadWall(size) {
    if (!Number.isInteger(size) || size < 0) throw new TypeError('[WallManager] dead wall size must be a non-negative integer.');
    if (this._drawIndex !== 0 || this._liveWallEnd !== this._tiles.length) {
      throw new Error('[WallManager] the dead wall must be reserved before any tile is drawn.');
    }
    if (size > this._tiles.length) throw new RangeError('[WallManager] dead wall larger than the wall.');
    this._deadWallReserved = size;
    this._deadWallStart = this._tiles.length - size;
    this._liveWallEnd = this._deadWallStart;
    this._deadWallDrawIndex = this._deadWallStart;
  }

  /** Normal draws left before an exhaustive draw (dead wall excluded). */
  get remainingCount() {
    return Math.max(0, this._liveWallEnd - this._drawIndex);
  }

  /** Tiles in the whole wall at the start of the hand. */
  get totalCount() {
    return this._tiles.length;
  }

  /** Size of the reserved dead wall (0 when none). */
  get deadWallSize() {
    return this._deadWallReserved;
  }

  /** True when no normal draw is left. */
  isExhausted() {
    return this.remainingCount === 0;
  }

  /**
   * Draws the next tile from the live wall.
   * @returns {import('./Tile.js').Tile|null} null when exhausted
   */
  draw() {
    if (this._drawIndex >= this._liveWallEnd) return null;
    return this._tiles[this._drawIndex++];
  }

  /**
   * Draws a Kong replacement tile (see header for where it comes from).
   * @returns {import('./Tile.js').Tile|null} null when none is available
   */
  drawReplacement() {
    if (this._deadWallReserved > 0) {
      if (this._deadWallDrawIndex >= this._tiles.length) return null;
      const tile = this._tiles[this._deadWallDrawIndex++];
      if (this._liveWallEnd > this._drawIndex) this._liveWallEnd -= 1;
      return tile;
    }
    if (this._liveWallEnd <= this._drawIndex) return null;
    this._liveWallEnd -= 1;
    return this._tiles[this._liveWallEnd];
  }

  /**
   * Engine/test use only — never shown to players.
   * @param {number} [count=1]
   * @returns {import('./Tile.js').Tile[]}
   */
  peekUpcoming(count = 1) {
    if (!Number.isInteger(count) || count < 0) throw new TypeError('[WallManager] peekUpcoming count must be a non-negative integer.');
    return this._tiles.slice(this._drawIndex, Math.min(this._drawIndex + count, this._liveWallEnd));
  }

  /**
   * The dead wall's tiles that have not been drawn as replacements (Riichi
   * dora indicators are read from here later — Task 88).
   * @returns {import('./Tile.js').Tile[]}
   */
  getDeadWallTiles() {
    return this._tiles.slice(Math.max(this._deadWallStart, this._deadWallDrawIndex));
  }

  /**
   * Every tile reserved as the dead wall at the start of the hand, in a FIXED
   * order — replacement tiles already drawn included (Task 88: Riichi reads
   * dora indicators from fixed positions in it). Empty without a dead wall.
   * @returns {import('./Tile.js').Tile[]}
   */
  getReservedDeadWallTiles() {
    return this._deadWallReserved > 0 ? this._tiles.slice(this._deadWallStart) : [];
  }

  /**
   * All six private fields as a plain object (tiles copied). GameSnapshot
   * converts the tiles to {id, instanceId}.
   */
  getWallStateSnapshot() {
    return {
      tiles: this._tiles.slice(),
      drawIndex: this._drawIndex,
      liveWallEnd: this._liveWallEnd,
      deadWallReserved: this._deadWallReserved,
      deadWallStart: this._deadWallStart,
      deadWallDrawIndex: this._deadWallDrawIndex,
    };
  }

  /**
   * Rebuilds a wall mid-hand from getWallStateSnapshot() data, cursor intact.
   * @param {{tiles: Tile[], drawIndex: number, liveWallEnd: number, deadWallReserved: number, deadWallStart: number, deadWallDrawIndex: number}} state
   * @returns {WallManager}
   */
  static restore(state) {
    if (!state || typeof state !== 'object') throw new TypeError('[WallManager] restore requires a state object.');
    const { tiles, drawIndex, liveWallEnd, deadWallReserved, deadWallStart, deadWallDrawIndex } = state;
    const wall = new WallManager(tiles);
    const n = wall._tiles.length;
    const ints = { drawIndex, liveWallEnd, deadWallReserved, deadWallStart, deadWallDrawIndex };
    for (const [k, v] of Object.entries(ints)) {
      if (!Number.isInteger(v) || v < 0 || v > n) throw new RangeError(`[WallManager] restore: ${k} must be an integer 0–${n}; got ${v}`);
    }
    if (drawIndex > liveWallEnd) throw new RangeError('[WallManager] restore: drawIndex past liveWallEnd.');
    if (deadWallStart !== n - deadWallReserved) throw new RangeError('[WallManager] restore: deadWallStart inconsistent with deadWallReserved.');
    if (liveWallEnd > deadWallStart) throw new RangeError('[WallManager] restore: live wall overlaps the dead wall.');
    wall._drawIndex = drawIndex;
    wall._liveWallEnd = liveWallEnd;
    wall._deadWallReserved = deadWallReserved;
    wall._deadWallStart = deadWallStart;
    wall._deadWallDrawIndex = deadWallDrawIndex;
    return wall;
  }
}

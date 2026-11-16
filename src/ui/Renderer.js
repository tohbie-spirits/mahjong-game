/**
 * Renderer.js
 *
 * The table layout skeleton (Task 43, extended at Task 47): a CSS-grid felt
 * table with up to four addressable seats and a shared centre holding one
 * discard area per seat (each pre-rotated to face its seat) plus a wall slot.
 * Renders no game content itself.
 *
 *   seat 0 → bottom (the human, nearest the viewer)
 *   seat 1 → right · seat 2 → top · seat 3 → left
 *   (3 players: bottom, right, left — turn order runs to your right.)
 *
 * REBUILT (after Task 77) from the plan's Task 43/47 descriptions.
 */

const POSITIONS = {
  4: ['bottom', 'right', 'top', 'left'],
  3: ['bottom', 'right', 'left'],
  2: ['bottom', 'top'],
};

export class Renderer {
  /**
   * @param {Element} container
   * @param {{ playerCount?: number }} [options]
   */
  constructor(container, { playerCount = 4 } = {}) {
    if (!(container instanceof Element)) throw new TypeError('[Renderer] container must be a DOM Element.');
    if (!POSITIONS[playerCount]) throw new RangeError(`[Renderer] playerCount must be 2–4; got ${playerCount}`);
    this._container = container;
    this._playerCount = playerCount;
    this._root = null;
    this._seats = [];
    this._discards = [];
    this._wall = null;
    this._center = null;
  }

  isMounted() { return this._root !== null; }
  getPlayerCount() { return this._playerCount; }
  getRoot() { return this._root; }

  /** Seat position name ('bottom' | 'right' | 'top' | 'left'). */
  getSeatPosition(seatIndex) {
    this._assertSeat(seatIndex);
    return POSITIONS[this._playerCount][seatIndex];
  }

  mount() {
    if (this._root) return this._root;
    const table = document.createElement('div');
    table.className = `table table--${this._playerCount}p`;
    table.setAttribute('role', 'region');
    table.setAttribute('aria-label', 'Mahjong table');

    const center = document.createElement('div');
    center.className = 'table-center';
    const grid = document.createElement('div');
    grid.className = 'table-center-grid';
    center.appendChild(grid);

    this._seats = [];
    this._discards = [];
    POSITIONS[this._playerCount].forEach((pos, seatIndex) => {
      const seat = document.createElement('section');
      seat.className = `table-seat table-seat--${pos}`;
      seat.dataset.seatIndex = String(seatIndex);
      const label = document.createElement('div');
      label.className = 'table-seat-label';
      const hand = document.createElement('div');
      hand.className = 'table-seat-hand';
      seat.append(label, hand);
      table.appendChild(seat);
      this._seats.push({ seat, label, hand });

      const discard = document.createElement('div');
      discard.className = `table-center-discard table-center-discard--${pos}`;
      discard.dataset.seatIndex = String(seatIndex);
      grid.appendChild(discard);
      this._discards.push(discard);
    });

    const wall = document.createElement('div');
    wall.className = 'table-center-wall';
    grid.appendChild(wall);
    table.appendChild(center);

    this._container.appendChild(table);
    this._root = table;
    this._center = center;
    this._wall = wall;
    return table;
  }

  unmount() {
    if (!this._root) return;
    this._root.remove();
    this._root = null;
    this._seats = [];
    this._discards = [];
    this._wall = null;
    this._center = null;
  }

  getSeatContainer(seatIndex) { this._assertMountedSeat(seatIndex); return this._seats[seatIndex].seat; }
  getSeatLabelContainer(seatIndex) { this._assertMountedSeat(seatIndex); return this._seats[seatIndex].label; }
  getSeatHandContainer(seatIndex) { this._assertMountedSeat(seatIndex); return this._seats[seatIndex].hand; }
  getSeatDiscardContainer(seatIndex) { this._assertMountedSeat(seatIndex); return this._discards[seatIndex]; }
  getWallContainer() { this._assertMounted(); return this._wall; }
  getCenterContainer() { this._assertMounted(); return this._center; }

  _assertMounted() { if (!this._root) throw new Error('[Renderer] not mounted.'); }
  _assertSeat(i) { if (!Number.isInteger(i) || i < 0 || i >= this._playerCount) throw new RangeError(`[Renderer] seat index out of range: ${i}`); }
  _assertMountedSeat(i) { this._assertMounted(); this._assertSeat(i); }
}

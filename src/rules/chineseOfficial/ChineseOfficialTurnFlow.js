/**
 * ChineseOfficialTurnFlow.js — Chinese Official (MCR) turn flow (Task 97).
 *
 * Plugs into GameManager's turn-flow hooks (Task 89; see GameManager's
 * header) exactly like RiichiTurnFlow, so GameManager stays ruleset-agnostic.
 * Hong Kong has no flow and is unaffected.
 *
 *   FLOWERS        every flower / season drawn — in the deal or later — is set
 *                  aside face up (onBonusTile) and replaced from the END of the
 *                  wall; GameManager does the drawing (generic bonus-tile hook),
 *                  dealer first after the deal. Flowers set aside are counted
 *                  for each seat (flowerCount → legal actions + scoring: 1 point
 *                  each, after the 8-point minimum). A win on a flower's
 *                  replacement is an ordinary self-draw (Out with Replacement
 *                  Tile is for Kongs only).
 *   LAST COPY      isLastCopy for scoring (Last Tile, 和绝张): the other three
 *                  copies of the winning tile are visible — unclaimed discards
 *                  and exposed melds (concealed Kongs are not visible).
 *   ROBBING        an ADDED Kong can be robbed (GameManager offers its tile to
 *                  the others first); a concealed Kong never.
 *   ONE WINNER     MCR has no multiple Ron: the first claimant in turn order
 *                  after the discarder wins (maxWinnersPerDiscard() → 1, option
 *                  `multipleWinners`).
 *   SETTLEMENT     settle(outcome) → transfers (ChineseOfficialScoring#
 *                  settleChineseOfficialHand): a discard win — the discarder
 *                  pays base 8 + the hand's points (flowers included), every
 *                  other player the base 8; a self-drawn win — every other
 *                  player pays 8 + points; a draw — nothing.
 *   SESSION        everyone starts at `startingScore` (0 — MCR is zero-sum);
 *                  the deal passes after EVERY hand (dealerKeeps → false: four
 *                  hands per prevailing wind); nobody busts.
 *   SAVES          toJSON() / restoreState(state) — the flowers set aside.
 *
 * Hooks with nothing to do in MCR (riichi, dora, abortive draws, furiten) are
 * implemented as no-ops so GameManager can call any flow the same way.
 */

import { Tile } from '../../core/Tile.js';
import { KONG_TYPE } from '../../utils/constants.js';
import { settleChineseOfficialHand } from './ChineseOfficialScoring.js';

export class ChineseOfficialTurnFlow {
  /**
   * @param {import('./ChineseOfficialRules.js').ChineseOfficialRules} rules
   * @param {import('../../core/GameManager.js').GameManager} gameManager
   */
  constructor(rules, gameManager) {
    this._rules = rules;
    this._gm = gameManager;
    this._bonus = [];
    this.lastSettlement = null;
  }

  // ── Session / hand ───────────────────────────────────────────────────────
  onSessionStart() {
    const start = this._rules.getOptions().startingScore;
    for (const p of this._gm.getPlayers()) p.addScore(start - p.score);
  }

  onHandStart() {
    this._bonus = this._gm.getPlayers().map(() => []);
  }

  // ── Bonus tiles (GameManager's generic hook) ─────────────────────────────
  /** True for a tile this ruleset sets aside (flowers / seasons). */
  isBonusTile(tile) {
    return !!tile && tile.isBonus === true;
  }

  /** Records a flower set aside by `seat` (GameManager draws the replacement). */
  onBonusTile(seat, tile) {
    if (!this.isBonusTile(tile)) throw new TypeError('[ChineseOfficialTurnFlow] onBonusTile needs a bonus tile.');
    this._bonus[seat].push(tile);
  }

  /** The flowers `seat` has set aside this hand (copies). */
  getBonusTiles(seat) { return this._bonus[seat].slice(); }
  getFlowerCount(seat) { return this._bonus[seat].length; }
  /** Every tile set aside this hand (tile-conservation checks). */
  getSetAsideTiles() { return this._bonus.flat(); }

  // ── State extras ─────────────────────────────────────────────────────────
  selfStateExtras(seat) { return { flowerCount: this.getFlowerCount(seat) }; }
  discardStateExtras(seat) { return { flowerCount: this.getFlowerCount(seat) }; }
  tableViewExtras() { return { bonusTiles: this._bonus.map((b) => b.slice()) }; }

  /**
   * Scoring context additions: flowers, the last-copy flag, robbing the Kong.
   * @param {Object} player
   * @param {{ winningTile?: Tile, isChankan?: boolean }} extra
   */
  scoringContext(player, { winningTile = null, isChankan = false } = {}) {
    return {
      flowerCount: this.getFlowerCount(player.seatIndex),
      isLastCopy: winningTile ? this.visibleCopies(winningTile) === 3 : false,
      isRobbingKong: isChankan,
      ...(isChankan ? { robbedKongType: KONG_TYPE.ADDED } : {}),
    };
  }

  /**
   * Copies of `tile`'s face visible to everyone, the tile itself excluded:
   * unclaimed discards + tiles of exposed melds.
   */
  visibleCopies(tile) {
    let n = 0;
    for (const p of this._gm.getPlayers()) {
      for (const e of p.getDiscardPile().entries) if (!e.claimed && e.tile.id === tile.id && e.tile.instanceId !== tile.instanceId) n++;
      for (const m of p.getHand().melds) {
        if (m.concealed) continue;
        for (const t of m.tiles) if (t.id === tile.id && t.instanceId !== tile.instanceId) n++;
      }
    }
    return n;
  }

  // ── Kongs / discards ─────────────────────────────────────────────────────
  /** Only an added Kong can be robbed in MCR. */
  robbableKong(action) {
    if (action.kongType !== KONG_TYPE.ADDED || !action.tile) return null;
    return { tile: action.tile, robbedKong: KONG_TYPE.ADDED };
  }

  setChankan() {}
  onSelfKong() {}
  onDiscardPlaced() {}
  afterDiscardResolved() { return null; }
  isTripleRonAbort() { return false; }
  /** MCR: one winner per discard (the first in turn order). */
  maxWinnersPerDiscard() { return this._rules.getOptions().multipleWinners ? Infinity : 1; }

  // ── No riichi / dora in MCR ──────────────────────────────────────────────
  isRiichi() { return false; }
  getRiichiSeats() { return []; }
  getDoraIndicators() { return []; }
  onRiichiDeclared() { throw new Error('[ChineseOfficialTurnFlow] MCR has no riichi.'); }

  // ── Settlement / session ─────────────────────────────────────────────────
  dealerKeeps() { return false; }

  settle(outcome) {
    const o = this._rules.getOptions();
    const transfers = settleChineseOfficialHand({ outcome, playerCount: this._gm.getPlayerCount(), basePayment: o.basePayment });
    this.lastSettlement = { outcome: outcome?.type ?? null, transfers };
    return transfers;
  }

  isBust() { return false; }
  leftoverSticksTransfer() { return null; }

  // ── Saves ────────────────────────────────────────────────────────────────
  toJSON() {
    return { bonus: this._bonus.map((b) => b.map((t) => ({ id: t.id, instanceId: t.instanceId }))) };
  }

  /** Restores toJSON() output (after onHandStart()). */
  restoreState(state) {
    if (!state || typeof state !== 'object') throw new TypeError('[ChineseOfficialTurnFlow] restoreState needs a state object.');
    const n = this._gm.getPlayerCount();
    if (!Array.isArray(state.bonus) || state.bonus.length !== n) throw new TypeError('[ChineseOfficialTurnFlow] restoreState: bonus must list every seat.');
    this._bonus = state.bonus.map((list, i) => {
      if (!Array.isArray(list)) throw new TypeError(`[ChineseOfficialTurnFlow] restoreState: bonus[${i}] must be an array.`);
      return list.map((r) => {
        const t = Tile.fromId(r.id, r.instanceId);
        if (!t.isBonus) throw new TypeError(`[ChineseOfficialTurnFlow] restoreState: ${r.id} is not a bonus tile.`);
        return t;
      });
    });
  }
}

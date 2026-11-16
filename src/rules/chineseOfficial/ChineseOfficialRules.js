/**
 * ChineseOfficialRules.js — the Chinese Official (Mahjong Competition Rules,
 * "MCR" / Guobiao) rule engine.
 *
 * Task 93: legal actions + win validation (this file) and hand-shape
 * analysis (ChineseOfficialHandAnalysis.js), with a STARTER fan provider
 * (ChineseOfficialScoring.js). Later Phase 9 tasks add the full point
 * combinations (94–95), terminology (96), flower handling in the turn flow
 * (97), AI (98) and GameManager wiring (99); since Task 102 main.js registers
 * it, so it is selectable (3 or 4 players).
 *
 * RULES AS IMPLEMENTED (MCR):
 *   - 144 tiles: the 136 standard tiles + 8 flowers / seasons (`flowers`
 *     option); no dead wall — replacements come off the end of the live wall.
 *     Flowers are never part of a hand shape and are never discarded (the
 *     DISCARD action lists only standard tiles); setting them aside and
 *     drawing replacements is Task 97. Each flower is 1 point, added AFTER
 *     the minimum check.
 *   - SELF TURN after a draw: discard; CONCEALED KONG (four in hand); ADDED
 *     KONG (fourth tile onto your own Pung); TSUMO when the win is valid. A
 *     Kong needs a replacement draw, so none is offered with the wall empty.
 *   - ON ANOTHER PLAYER'S DISCARD: Pung and exposed Kong from anyone; Chow
 *     only from the player on your left (the discarder's next seat). On the
 *     final discard (wall empty) only a win can be claimed. No claims once
 *     the hand has four melds (only the win).
 *   - ROBBING THE KONG: a discard state with discard.robbedKong 'added'
 *     offers the win only (the tile can't be melded). A concealed Kong can
 *     never be robbed in MCR — not even for Thirteen Orphans.
 *   - WINS: Tsumo and Ron are offered only when validateWin() says the win is
 *     VALID — a complete hand in any MCR shape (standard, Seven Pairs incl. a
 *     doubled pair, Thirteen Orphans, Lesser / Greater Honors and Knitted
 *     Tiles, Knitted Straight) worth at least `minimumPoints` (8) WITHOUT
 *     flowers, the best arrangement counting. There is no furiten in MCR: a
 *     player may Ron any discard, including after passing one.
 *   - THREE PLAYERS (a house variant — MCR is a four-player game): the same
 *     tiles and rules; Chow from the player on your left unless
 *     `threePlayerChow: false`.
 *
 * ACTIONS (see RuleEngineInterface.js for the shapes):
 *   { type: DISCARD, seatIndex, allowedTiles: Tile[] }       (always listed)
 *   { type: WIN, seatIndex, winType, tile, fromSeat?, validation, score }
 *   standard KONG / PON / CHI shapes.
 *
 * STATE FIELDS read by this engine (optional): flowerCount (the player's
 * flowers set aside — default 0), discard.robbedKong ('added'|'concealed').
 *
 * Task 97: createTurnFlow(gm) → ChineseOfficialTurnFlow (flowers set aside and
 * replaced, last copy, robbing an added Kong, one winner per discard, MCR
 * settlement — base 8 — and the deal passing every hand). Options
 * startingScore (0), basePayment (8), multipleWinners (false).
 */

import { RuleEngineInterface } from '../RuleEngineInterface.js';
import {
  countsFromTiles, analyzeComplete, interpretWin, kindOfFaceId, standardTiles, isPhysicallyPossible, KIND_COUNT,
} from './ChineseOfficialHandAnalysis.js';
import { detectFans, FLOWER_POINTS } from './ChineseOfficialScoring.js';
import { CHINESE_OFFICIAL_TERMINOLOGY } from './ChineseOfficialTerminology.js';
import { ChineseOfficialTurnFlow } from './ChineseOfficialTurnFlow.js';
import { createHandViewWithExtraTile } from '../../core/Hand.js';
import { ACTION_TYPE, KONG_TYPE, MELD_TYPE, RULESET_ID, RULESET_LABEL, WIN_SOURCE } from '../../utils/constants.js';

/** Defaults for the ChineseOfficialRules constructor. */
export const DEFAULT_CHINESE_OFFICIAL_OPTIONS = Object.freeze({
  playerCount: 4,
  minimumPoints: 8,
  flowers: true,
  fanProvider: detectFans,     // see ChineseOfficialScoring.js for the contract
  threePlayerChow: true,
  startingScore: 0,            // Task 97 — MCR is zero-sum from 0
  basePayment: 8,              // Task 97 — every loser pays the winner 8 (+ points for the discarder / on Tsumo)
  multipleWinners: false,      // Task 97 — MCR: one winner per discard (first in turn order)
});

/** Why validateWin() refused a win. */
export const CO_WIN_REFUSAL = Object.freeze({
  INCOMPLETE: 'incomplete',
  BELOW_MINIMUM: 'below-minimum',
  CANNOT_ROB: 'cannot-rob-concealed-kong',
});

export class ChineseOfficialRules extends RuleEngineInterface {
  /**
   * @param {Object} [options]
   * @param {3|4} [options.playerCount=4]
   * @param {number} [options.minimumPoints=8]   points needed to win, flowers excluded
   * @param {boolean} [options.flowers=true]     play with the 8 flowers / seasons
   * @param {Function} [options.fanProvider=detectFans]
   * @param {boolean} [options.threePlayerChow=true]
   */
  constructor(options = {}) {
    super();
    if (options === null || typeof options !== 'object') throw new TypeError('[ChineseOfficialRules] options must be an object.');
    for (const k of Object.keys(options)) {
      if (!(k in DEFAULT_CHINESE_OFFICIAL_OPTIONS)) throw new TypeError(`[ChineseOfficialRules] unknown option "${k}".`);
    }
    const o = { ...DEFAULT_CHINESE_OFFICIAL_OPTIONS, ...options };
    if (o.playerCount !== 3 && o.playerCount !== 4) throw new RangeError('[ChineseOfficialRules] playerCount must be 3 or 4.');
    if (!Number.isInteger(o.minimumPoints) || o.minimumPoints < 0) throw new TypeError('[ChineseOfficialRules] minimumPoints must be a non-negative integer.');
    if (typeof o.flowers !== 'boolean' || typeof o.threePlayerChow !== 'boolean') throw new TypeError('[ChineseOfficialRules] flowers / threePlayerChow must be booleans.');
    if (typeof o.fanProvider !== 'function') throw new TypeError('[ChineseOfficialRules] fanProvider must be a function.');
    if (!Number.isInteger(o.startingScore)) throw new TypeError('[ChineseOfficialRules] startingScore must be an integer.');
    if (!Number.isInteger(o.basePayment) || o.basePayment < 0) throw new TypeError('[ChineseOfficialRules] basePayment must be a non-negative integer.');
    if (typeof o.multipleWinners !== 'boolean') throw new TypeError('[ChineseOfficialRules] multipleWinners must be a boolean.');
    /** @private */ this._options = Object.freeze(o);
  }

  getRulesetId() { return RULESET_ID.CHINESE_OFFICIAL; }
  getDisplayName() { return RULESET_LABEL[RULESET_ID.CHINESE_OFFICIAL]; }
  getTerminology() { return CHINESE_OFFICIAL_TERMINOLOGY; }
  getOptions() { return this._options; }
  getMinimumPoints() { return this._options.minimumPoints; }

  getTileSetOptions() {
    return { includeBonus: this._options.flowers, excludedFaceIds: [], deadWallSize: 0 };
  }

  /**
   * Task 97: GameManager's turn-flow hook — flowers, last copy, robbing an
   * added Kong, one winner per discard, MCR settlement, the deal passing
   * every hand. See ChineseOfficialTurnFlow.js.
   */
  createTurnFlow(gameManager) {
    return new ChineseOfficialTurnFlow(this, gameManager);
  }

  // -------------------------------------------------------------------------
  // Win checks
  // -------------------------------------------------------------------------

  /**
   * Structural check of a COMPLETE hand (any MCR shape; no point minimum).
   * Flowers in the concealed tiles are ignored.
   * @returns {{ isWin: boolean, structure: string|null }}
   */
  checkWin(hand, context = {}) { // eslint-disable-line no-unused-vars
    if (!hand || !Array.isArray(hand.concealedTiles)) throw new TypeError('[ChineseOfficialRules] checkWin requires a hand.');
    const a = this._analyze(hand);
    if (!a) return { isWin: false, structure: null };
    const structure = a.thirteenOrphans ? 'thirteen-orphans'
      : a.honorsKnitted ? 'honors-knitted'
        : a.standard.length ? 'standard'
          : a.knittedStraight.length ? 'knitted-straight'
            : a.sevenPairs ? 'seven-pairs' : null;
    return { isWin: a.isComplete, structure };
  }

  /** @private — counts + analysis of the concealed standard tiles, or null when the size is wrong. */
  _analyze(hand) {
    const m = hand.meldCount;
    const tiles = standardTiles(hand.concealedTiles);
    if (tiles.length !== 14 - 3 * m) return null;
    const counts = this._counts(tiles);
    if (!counts) return null;
    return { ...analyzeComplete(counts, m), counts };
  }

  /** @private — counts, or null for a physically impossible probe (a 5th copy). */
  _counts(tiles) {
    const counts = new Array(KIND_COUNT).fill(0);
    for (const t of tiles) counts[kindOfFaceId(t.id)]++;
    return isPhysicallyPossible(counts) ? countsFromTiles(tiles) : null;
  }

  /**
   * Is this a VALID win? A complete hand in some MCR shape whose best
   * arrangement is worth ≥ minimumPoints without flowers.
   *
   * @param {import('../../core/Hand.js').Hand} hand  the COMPLETE hand, winning tile included
   * @param {Object} context
   *   winType 'self'|'discard', winningTile (required); seatWind, roundWind,
   *   isLastTile, isKongReplacement, isRobbingKong + robbedKongType
   *   'added'|'concealed', flowerCount (default 0) — passed to the fan provider.
   * @returns {{ valid: boolean, reason: string|null, structure: string|null,
   *             interpretation: Object|null, interpretations: Object[],
   *             fans: Object[], points: number, flowerPoints: number, total: number,
   *             minimumPoints: number }}
   */
  validateWin(hand, context = {}) {
    if (!hand || !Array.isArray(hand.concealedTiles)) throw new TypeError('[ChineseOfficialRules] validateWin requires a hand.');
    const tile = context.winningTile;
    if (!tile || typeof tile.id !== 'string') throw new TypeError('[ChineseOfficialRules] validateWin requires context.winningTile.');
    const o = this._options;
    const flowerCount = Number.isInteger(context.flowerCount) && context.flowerCount > 0 ? context.flowerCount : 0;
    const flowerPoints = flowerCount * FLOWER_POINTS;
    const refuse = (reason, extra = {}) => ({
      valid: false, reason, structure: null, interpretation: null, interpretations: [], fans: [], points: 0,
      flowerPoints, total: 0, minimumPoints: o.minimumPoints, ...extra,
    });

    if (context.isRobbingKong && context.robbedKongType === KONG_TYPE.CONCEALED) return refuse(CO_WIN_REFUSAL.CANNOT_ROB);
    const a = this._analyze(hand);
    if (!a || !a.isComplete || tile.isBonus) return refuse(CO_WIN_REFUSAL.INCOMPLETE);

    const m = hand.meldCount;
    const interpretations = interpretWin(a.counts, m, kindOfFaceId(tile.id));
    let best = null;
    for (const interpretation of interpretations) {
      const fans = o.fanProvider({ interpretation, hand, counts: a.counts, melds: hand.melds, kindOf: kindOfFaceId, context: { ...context, flowerCount } });
      if (!Array.isArray(fans)) throw new TypeError('[ChineseOfficialRules] the fan provider must return an array.');
      const points = fans.reduce((s, f) => s + f.points, 0);
      if (!best || points > best.points) best = { interpretation, fans, points };
    }
    const result = {
      structure: best.interpretation.structure, interpretation: best.interpretation, interpretations,
      fans: best.fans, points: best.points, flowerPoints, total: best.points + flowerPoints, minimumPoints: o.minimumPoints,
    };
    if (best.points < o.minimumPoints) return { valid: false, reason: CO_WIN_REFUSAL.BELOW_MINIMUM, ...result };
    return { valid: true, reason: null, ...result };
  }

  /**
   * Scores a complete hand (HK-compatible shape: fan = points without
   * flowers, points = total with flowers, meetsMinimum, breakdown). Payments
   * between players come with the full scoring (Tasks 94–95 / 99).
   */
  scoreHand(hand, context = {}) {
    const winningTile = context.winningTile ?? standardTiles(hand.concealedTiles).slice(-1)[0];
    if (!winningTile) return this._emptyScore();
    const v = this.validateWin(hand, { ...context, winningTile });
    const breakdown = v.fans.map((f) => ({ id: f.id, name: f.name, fan: f.points, points: f.points }));
    if (v.flowerPoints) breakdown.push({ id: 'flower-tiles', name: 'Flower Tiles', fan: v.flowerPoints, points: v.flowerPoints, isFlower: true });
    return {
      fan: v.points, points: v.total, meetsMinimum: v.valid, minimumFan: v.minimumPoints, isLimit: false,
      structure: v.structure, breakdown, flowerPoints: v.flowerPoints, validation: v,
    };
  }

  /** @private */
  _emptyScore() {
    return { fan: 0, points: 0, meetsMinimum: false, minimumFan: this._options.minimumPoints, isLimit: false, structure: null, breakdown: [], flowerPoints: 0, validation: null };
  }

  // -------------------------------------------------------------------------
  // Legal actions
  // -------------------------------------------------------------------------

  /**
   * Legal actions for `player` in `state` (see RuleEngineInterface header).
   * @returns {Object[]}
   */
  getLegalActions(state, player) {
    if (!state || typeof state !== 'object') throw new TypeError('[ChineseOfficialRules] getLegalActions requires a state object.');
    if (!player || typeof player.getHand !== 'function') throw new TypeError('[ChineseOfficialRules] getLegalActions requires a player.');
    if (state.kind === 'self') return this._selfActions(state, player);
    if (state.kind === 'discard') return this._discardActions(state, player);
    throw new TypeError(`[ChineseOfficialRules] unknown state.kind: ${state.kind}`);
  }

  /** @private */
  _context(state, player, extra) {
    return {
      seatWind: state.seatWind ?? player.seatWind,
      roundWind: state.roundWind,
      isLastTile: state.wallRemaining === 0,
      flowerCount: state.flowerCount ?? 0,
      ...extra,
    };
  }

  /** @private — after drawing (or after a Chow / Pung, with no drawnTile): Tsumo, Kongs, discard. */
  _selfActions(state, player) {
    const hand = player.getHand();
    const seatIndex = player.seatIndex;
    const actions = [];
    const concealed = standardTiles(hand.concealedTiles);

    if (state.drawnTile && !state.drawnTile.isBonus) {
      const context = this._context(state, player, { winType: WIN_SOURCE.SELF, winningTile: state.drawnTile, isKongReplacement: state.isReplacementDraw === true });
      const validation = this.validateWin(hand, context);
      if (validation.valid) {
        actions.push({ type: ACTION_TYPE.WIN, seatIndex, winType: WIN_SOURCE.SELF, tile: state.drawnTile, validation, score: this.scoreHand(hand, context) });
      }
    }

    if ((state.wallRemaining ?? 1) > 0) {
      const byFace = new Map();
      for (const t of concealed) byFace.set(t.id, [...(byFace.get(t.id) ?? []), t]);
      for (const [faceId, group] of byFace) {
        if (group.length === 4) actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.CONCEALED, faceId, tiles: group });
      }
      hand.melds.forEach((meld, meldIndex) => {
        if (meld.type !== MELD_TYPE.PON) return;
        const tile = concealed.find((t) => t.id === meld.faceId);
        if (tile) actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.ADDED, faceId: meld.faceId, tile, meldIndex });
      });
    }

    actions.push({ type: ACTION_TYPE.DISCARD, seatIndex, allowedTiles: concealed });
    return actions;
  }

  /** @private — reacting to another player's discard. */
  _discardActions(state, player) {
    const { discard } = state;
    if (!discard || !discard.tile || !Number.isInteger(discard.fromSeat)) {
      throw new TypeError('[ChineseOfficialRules] discard state needs { tile, fromSeat }.');
    }
    const seatIndex = player.seatIndex;
    const { tile, fromSeat } = discard;
    if (seatIndex === fromSeat || tile.isBonus) return [];
    const hand = player.getHand();
    const actions = [];
    const robbed = discard.robbedKong ?? null;

    const context = this._context(state, player, {
      winType: WIN_SOURCE.DISCARD, winningTile: tile, isKongReplacement: false,
      isRobbingKong: robbed !== null, robbedKongType: robbed,
    });
    const view = createHandViewWithExtraTile(hand, tile);
    const validation = this.validateWin(view, context);
    if (validation.valid) {
      actions.push({ type: ACTION_TYPE.WIN, seatIndex, winType: WIN_SOURCE.DISCARD, tile, fromSeat, validation, score: this.scoreHand(view, context) });
    }

    // A robbed Kong tile, the final discard and a four-meld hand: only the win.
    if (robbed !== null || state.wallRemaining === 0 || hand.meldCount >= 4) return actions;

    const same = standardTiles(hand.concealedTiles).filter((t) => t.id === tile.id);
    if (same.length >= 3) {
      actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.EXPOSED, faceId: tile.id, tile, handTiles: same.slice(0, 3), fromSeat });
    }
    if (same.length >= 2) {
      actions.push({ type: ACTION_TYPE.PON, seatIndex, faceId: tile.id, tile, handTiles: same.slice(0, 2), fromSeat });
    }

    const playerCount = state.playerCount ?? this._options.playerCount;
    const chowAllowed = playerCount === 4 || this._options.threePlayerChow;
    if (chowAllowed && seatIndex === (fromSeat + 1) % playerCount && tile.isSuited) {
      const concealed = hand.concealedTiles;
      const find = (faceId) => concealed.find((t) => t.id === faceId);
      for (const offsets of [[-2, -1], [-1, 1], [1, 2]]) {
        const ids = offsets.map((off) => tile.nextInSuit(off));
        if (ids.some((id) => id === null)) continue;
        const handTiles = ids.map(find);
        if (handTiles.some((t) => !t)) continue;
        const sequence = [...ids, tile.id].sort((x, y) => Number(x.split('-')[1]) - Number(y.split('-')[1]));
        actions.push({ type: ACTION_TYPE.CHI, seatIndex, tile, handTiles, sequence, fromSeat });
      }
    }
    return actions;
  }
}

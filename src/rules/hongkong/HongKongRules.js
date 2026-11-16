/**
 * HongKongRules.js
 *
 * The Hong Kong Mahjong rule engine: legal actions (Task 22), win validation
 * (Task 23), scoring via HongKongScoring (Tasks 24–25) and terminology
 * (Task 26), behind RuleEngineInterface (Task 21).
 *
 * REBUILT (after Task 77). Rules as implemented:
 *   - 136 tiles, no flowers/seasons, no dead wall (Kong replacements come off
 *     the end of the live wall).
 *   - Chi only from the player immediately before you (the discarder's next
 *     seat); Pon / exposed Kong / Ron from anyone.
 *   - Concealed Kong (four in hand) and added Kong (fourth tile onto your own
 *     Pon) on your own turn after drawing; a Kong needs a replacement tile, so
 *     none is offered when the wall is empty.
 *   - A win is offered only when the hand is complete AND meets the minimum
 *     fan (no false Mahjong). Thirteen Orphans is always valid; Seven Pairs
 *     only when `allowSevenPairs` is set.
 *
 * See RuleEngineInterface.js for the state / action / context shapes.
 */

import { RuleEngineInterface } from '../RuleEngineInterface.js';
import { analyzeHand } from './HongKongHandAnalysis.js';
import { scoreHongKongHand, DEFAULT_HONG_KONG_SCORING_OPTIONS } from './HongKongScoring.js';
import { HONG_KONG_TERMINOLOGY } from './HongKongTerminology.js';
import { createHandViewWithExtraTile } from '../../core/Hand.js';
import { ACTION_TYPE, KONG_TYPE, MELD_TYPE, RULESET_ID, RULESET_LABEL, WIN_SOURCE } from '../../utils/constants.js';

export class HongKongRules extends RuleEngineInterface {
  /**
   * @param {Object} [options]
   * @param {number} [options.minimumFan=3]
   * @param {number} [options.limitFan=13]
   * @param {boolean} [options.allowSevenPairs=false]
   */
  constructor(options = {}) {
    super();
    const opts = { ...DEFAULT_HONG_KONG_SCORING_OPTIONS, ...options };
    if (!Number.isInteger(opts.minimumFan) || opts.minimumFan < 0) throw new TypeError('[HongKongRules] minimumFan must be a non-negative integer.');
    if (!Number.isInteger(opts.limitFan) || opts.limitFan < opts.minimumFan) throw new TypeError('[HongKongRules] limitFan must be an integer ≥ minimumFan.');
    /** @private */ this._options = Object.freeze({
      minimumFan: opts.minimumFan,
      limitFan: opts.limitFan,
      allowSevenPairs: opts.allowSevenPairs === true,
    });
  }

  getRulesetId() { return RULESET_ID.HONG_KONG; }
  getDisplayName() { return RULESET_LABEL[RULESET_ID.HONG_KONG]; }
  getTerminology() { return HONG_KONG_TERMINOLOGY; }
  getMinimumFan() { return this._options.minimumFan; }
  getOptions() { return this._options; }

  getTileSetOptions() {
    return { includeBonus: false, excludedFaceIds: [], deadWallSize: 0 };
  }

  /**
   * Structural win check for a COMPLETE hand (no fan requirement).
   * @returns {{ isWin: boolean, structure: string|null }}
   */
  checkWin(hand, context = {}) { // eslint-disable-line no-unused-vars
    const a = analyzeHand(hand, { allowSevenPairs: this._options.allowSevenPairs });
    const structure = a.thirteenOrphans ? 'thirteen-orphans' : a.standard.length ? 'standard' : a.sevenPairs ? 'seven-pairs' : null;
    return { isWin: a.isComplete, structure };
  }

  /** Scores a complete hand (see HongKongScoring). */
  scoreHand(hand, context = {}) {
    return scoreHongKongHand(hand, context, this._options);
  }

  /**
   * Legal actions for `player` in `state` (see RuleEngineInterface header).
   * @param {Object} state
   * @param {import('../../core/PlayerManager.js').PlayerManager} player
   * @returns {Object[]}
   */
  getLegalActions(state, player) {
    if (!state || typeof state !== 'object') throw new TypeError('[HongKongRules] getLegalActions requires a state object.');
    if (!player || typeof player.getHand !== 'function') throw new TypeError('[HongKongRules] getLegalActions requires a player.');
    if (state.kind === 'self') return this._selfActions(state, player);
    if (state.kind === 'discard') return this._discardActions(state, player);
    throw new TypeError(`[HongKongRules] unknown state.kind: ${state.kind}`);
  }

  // -------------------------------------------------------------------------

  /** @private — after drawing: Tsumo, concealed/added Kongs, discard. */
  _selfActions(state, player) {
    const hand = player.getHand();
    const seatIndex = player.seatIndex;
    const actions = [];

    if (state.drawnTile) {
      const context = {
        winType: WIN_SOURCE.SELF,
        winningTile: state.drawnTile,
        seatWind: state.seatWind ?? player.seatWind,
        roundWind: state.roundWind,
        isLastTile: state.wallRemaining === 0,
        isKongReplacement: state.isReplacementDraw === true,
      };
      const score = this.scoreHand(hand, context);
      if (score.meetsMinimum && score.structure !== null) {
        actions.push({ type: ACTION_TYPE.WIN, seatIndex, winType: WIN_SOURCE.SELF, tile: state.drawnTile, score });
      }
    }

    if ((state.wallRemaining ?? 1) > 0) {
      const tiles = hand.concealedTiles;
      const byFace = new Map();
      for (const t of tiles) byFace.set(t.id, [...(byFace.get(t.id) ?? []), t]);
      for (const [faceId, group] of byFace) {
        if (group.length === 4) {
          actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.CONCEALED, faceId, tiles: group });
        }
      }
      hand.melds.forEach((meld, meldIndex) => {
        if (meld.type !== MELD_TYPE.PON) return;
        const tile = tiles.find((t) => t.id === meld.faceId);
        if (tile) actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.ADDED, faceId: meld.faceId, tile, meldIndex });
      });
    }

    actions.push({ type: ACTION_TYPE.DISCARD, seatIndex });
    return actions;
  }

  /** @private — reacting to another player's discard. */
  _discardActions(state, player) {
    const { discard } = state;
    if (!discard || !discard.tile || !Number.isInteger(discard.fromSeat)) {
      throw new TypeError('[HongKongRules] discard state needs { tile, fromSeat }.');
    }
    const seatIndex = player.seatIndex;
    if (seatIndex === discard.fromSeat) return [];
    const hand = player.getHand();
    const tile = discard.tile;
    const fromSeat = discard.fromSeat;
    const actions = [];

    // Ron.
    const view = createHandViewWithExtraTile(hand, tile);
    const score = this.scoreHand(view, {
      winType: WIN_SOURCE.DISCARD,
      winningTile: tile,
      seatWind: state.seatWind ?? player.seatWind,
      roundWind: state.roundWind,
      isLastTile: state.wallRemaining === 0,
      isKongReplacement: false,
    });
    if (score.meetsMinimum && score.structure !== null) {
      actions.push({ type: ACTION_TYPE.WIN, seatIndex, winType: WIN_SOURCE.DISCARD, tile, fromSeat, score });
    }

    if (hand.meldCount >= 4) return actions;

    const same = hand.concealedTiles.filter((t) => t.id === tile.id);
    if (same.length >= 3 && (state.wallRemaining ?? 1) > 0) {
      actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.EXPOSED, faceId: tile.id, tile, handTiles: same.slice(0, 3), fromSeat });
    }
    if (same.length >= 2) {
      actions.push({ type: ACTION_TYPE.PON, seatIndex, faceId: tile.id, tile, handTiles: same.slice(0, 2), fromSeat });
    }

    const playerCount = state.playerCount ?? 4;
    const isNextSeat = seatIndex === (fromSeat + 1) % playerCount;
    if (isNextSeat && tile.isSuited) {
      const concealed = hand.concealedTiles;
      const find = (faceId) => concealed.find((t) => t.id === faceId);
      for (const offsets of [[-2, -1], [-1, 1], [1, 2]]) {
        const ids = offsets.map((o) => tile.nextInSuit(o));
        if (ids.some((id) => id === null)) continue;
        const handTiles = ids.map(find);
        if (handTiles.some((t) => !t)) continue;
        const sequence = [...ids, tile.id].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
        actions.push({ type: ACTION_TYPE.CHI, seatIndex, tile, handTiles, sequence, fromSeat });
      }
    }
    return actions;
  }
}

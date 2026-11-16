/**
 * RiichiRules.js — the Riichi (Japanese) Mahjong rule engine.
 *
 * Task 81: legal actions and special calls (this file) + hand-shape analysis
 * (RiichiHandAnalysis.js). Task 82: win validation (validateWin, WIN actions,
 * furiten, chankan) with the first yaku in RiichiYaku.js. Later Phase 8 tasks
 * add the remaining yaku (83–84), scoring (85–86), terminology (87), dora / dead wall (88), furiten
 * / ippatsu / turn flow (89), AI (90) and GameManager wiring (91); since
 * Task 102 main.js registers it, so it is selectable (4 players, or 3 — sanma).
 *
 * RULES AS IMPLEMENTED (common modern Japanese / Tenhou-style rules):
 *   - 136 tiles, no flowers; a 14-tile dead wall (`deadWallSize: 14`, the
 *     Task 14 hook). Three-player (sanma) removes characters 2–8 (manzu).
 *   - SELF TURN after a draw: discard any tile; CLOSED KAN (four in hand);
 *     ADDED KAN (fourth tile onto your own Pon); RIICHI when the hand is
 *     closed (closed Kans allowed), you hold ≥ riichiMinimumScore (1000),
 *     the live wall still has ≥ one tile per player, and some discard leaves
 *     the hand tenpai; NINE TERMINALS abortive draw on an uninterrupted
 *     first turn with ≥ 9 different terminal/honour kinds.
 *   - AFTER RIICHI: the drawn tile must be discarded; a closed Kan is allowed
 *     only with the drawn tile (no "okurikan") and only if it changes
 *     neither the waits nor the hand's reading (the Kan kind is a triplet in
 *     every decomposition of every winning hand). No other calls.
 *   - ON ANOTHER PLAYER'S DISCARD: Pon; open Kan; Chi only from the player
 *     on your left (the discarder's next seat) and never in three-player.
 *     Nothing but Ron while in riichi or on the final discard (wall empty).
 *   - KANS: at most `maxKongs` (4) per hand across the table, and never when
 *     the live wall is empty (a Kan needs a replacement draw).
 *   - SWAP-CALLING BAN (kuikae): right after a Chi / Pon you may not discard
 *     the called kind, nor — after a Chi completed at one end (e.g. calling
 *     3 for 3-4-5) — the tile beyond the other end (6). A call that would
 *     leave no legal discard is not offered. `kuikae: false` turns this off.
 *   - WINS (Task 82): Tsumo after a draw and Ron on another player's
 *     discard are offered only when validateWin() says the win is LEGAL — a
 *     complete hand, at least one yaku (RiichiYaku provider; dora never
 *     count), and for Ron no furiten: no wait of the hand in the player's
 *     own discards (claimed ones included), no temporary furiten (passed a
 *     win since their last discard) and no riichi furiten (passed a win after
 *     declaring) — the last two come in as state flags (Task 89 maintains
 *     them). Furiten never blocks Tsumo. Ron is also offered in riichi and
 *     on the final discard. ROBBING A KAN (chankan): a discard state with
 *     discard.robbedKong 'added' offers Ron only (the tile can't be called);
 *     'concealed' only for Thirteen Orphans (kokushiRobsConcealedKong).
 *     checkWin() stays the structural check, like HongKongRules#checkWin.
 *
 * RIICHI-ONLY STATE FIELDS (optional; GameManager supplies them from Task 89/91):
 *   isRiichi                  this player has declared riichi
 *   score                     the player's points (default player.score)
 *   kongCount                 Kans declared by anyone this hand (default 0)
 *   lastCall                  { type: 'chi'|'pon', tile, sequence? } — set when
 *                             this self turn follows the player's own Chi/Pon
 *                             (no draw): only a kuikae-filtered DISCARD is legal
 *   isFirstUninterruptedTurn  first draw of the hand with no call made yet
 *   ownDiscards               (Task 82) tiles / face ids the player discarded;
 *                             default: player.getDiscardPile().tiles
 *   isTemporaryFuriten, isRiichiFuriten, isIppatsu, isDoubleRiichi (Task 82/89)
 *   discard.robbedKong        (Task 82) 'added' | 'concealed' — chankan
 *
 * ACTIONS ADDED BY THIS RULESET (see RuleEngineInterface.js for the rest):
 *   { type: DISCARD, seatIndex, allowedTiles: Tile[] }       (always listed)
 *   { type: RIICHI, seatIndex, options: [{ faceId, tiles: Tile[], waits: faceId[] }],
 *     allowedTiles: Tile[] }      — discard one of allowedTiles to declare
 *   { type: ABORTIVE_DRAW, seatIndex, reason: 'nine-terminals', faceIds: string[] }
 *   { type: WIN, seatIndex, winType: 'self'|'discard', tile, fromSeat?, validation }
 *     (Task 82) — validation is the validateWin() result (yaku, interpretations, …)
 * Kan actions use the standard KONG shapes (concealed / added / exposed).
 */

import { RuleEngineInterface } from '../RuleEngineInterface.js';
import {
  countsFromTiles, analyzeComplete, findWaits, decomposeStandard, kindOfFaceId, faceIdOfKind, isTerminalOrHonorKind, interpretWin,
} from './RiichiHandAnalysis.js';
import { detectYaku } from './RiichiYaku.js';
import { scoreValidatedWin } from './RiichiScoring.js';
import { RIICHI_TERMINOLOGY } from './RiichiTerminology.js';
import { RiichiDoraState } from './RiichiDora.js';
import { RiichiTurnFlow } from './RiichiTurnFlow.js';
import { createHandViewWithExtraTile } from '../../core/Hand.js';
import { ACTION_TYPE, KONG_TYPE, MELD_TYPE, RULESET_ID, RULESET_LABEL, WIN_SOURCE } from '../../utils/constants.js';

/** Defaults for the RiichiRules constructor. */
export const DEFAULT_RIICHI_OPTIONS = Object.freeze({
  playerCount: 4,
  kuikae: true,
  nineTerminalsDraw: true,
  riichiMinimumScore: 1000,
  maxKongs: 4,
  // Task 82
  yakuProvider: detectYaku,          // see RiichiYaku.js for the contract
  kokushiRobsConcealedKong: true,    // Thirteen Orphans may rob a closed Kan
  // Task 83
  openTanyao: true,                  // "kuitan": All Simples also counts for an open hand
  // Task 84
  doubleYakuman: true,               // 13-sided Kokushi, Suuankou tanki, Pure Nine Gates, Daisuushii count double
  // Task 85
  kazoeYakuman: true,                // 13+ han from ordinary yaku + dora counts as a yakuman
  kiriageMangan: false,              // round 4 han 30 fu / 3 han 60 fu up to Mangan
  doubleWindPairFu: 4,               // fu for a pair of the seat AND round wind (2 or 4)
  // Task 88
  redFives: 0,                       // 0 or 3: copy #1 of each suit's 5 is a red five (extra dora)
  kanDora: true,                     // each Kan reveals another dora indicator
  uraDora: true,                     // a riichi winner also counts the ura indicators
  kanUraDora: true,                  // …including those under kan-dora indicators
  // Task 89
  startingScore: null,               // null → 25000 (4P) / 35000 (3P)
  riichiStickValue: 1000,
  tripleRonAbort: true,              // three Ron on one discard → abortive draw (4P)
  // Task 91
  nagashiMangan: true,               // an all-terminal/honour, unclaimed discard pile pays a Mangan at a draw
  bustEndsGame: true,                // the session ends when a player drops below 0 ("tobi")
  leftoverSticksToTop: true,         // riichi sticks still on the table at the end go to the top player
});

/** Why validateWin() refused a win (Task 82). */
export const WIN_REFUSAL = Object.freeze({
  INCOMPLETE: 'incomplete',
  FURITEN: 'furiten',
  NO_YAKU: 'no-yaku',
  CANNOT_ROB: 'cannot-rob-concealed-kong',
});

/** Characters 2–8 — removed in three-player Riichi (sanma). */
export const SANMA_EXCLUDED_FACE_IDS = Object.freeze([2, 3, 4, 5, 6, 7, 8].map((n) => `characters-${n}`));



export class RiichiRules extends RuleEngineInterface {
  /**
   * @param {Object} [options]
   * @param {3|4} [options.playerCount=4]
   * @param {boolean} [options.kuikae=true]            swap-calling ban
   * @param {boolean} [options.nineTerminalsDraw=true] offer the nine-terminals abortive draw
   * @param {number} [options.riichiMinimumScore=1000] points needed to declare riichi
   * @param {number} [options.maxKongs=4]              Kans allowed per hand across the table
   * @param {Function} [options.yakuProvider=detectYaku] Task 82 — yaku detection (RiichiYaku.js contract)
   * @param {boolean} [options.kokushiRobsConcealedKong=true] Task 82 — Thirteen Orphans may Ron a closed Kan
   * @param {boolean} [options.openTanyao=true] Task 83 — All Simples counts for open hands ("kuitan")
   * @param {boolean} [options.doubleYakuman=true] Task 84 — some yakuman count double
   * @param {boolean} [options.kazoeYakuman=true]  Task 85
   * @param {boolean} [options.kiriageMangan=false] Task 85
   * @param {2|4} [options.doubleWindPairFu=4]     Task 85
   * @param {0|3} [options.redFives=0]             Task 88
   * @param {boolean} [options.kanDora=true]       Task 88
   * @param {boolean} [options.uraDora=true]       Task 88
   * @param {boolean} [options.kanUraDora=true]    Task 88
   */
  constructor(options = {}) {
    super();
    if (options === null || typeof options !== 'object') throw new TypeError('[RiichiRules] options must be an object.');
    for (const k of Object.keys(options)) {
      if (!(k in DEFAULT_RIICHI_OPTIONS)) throw new TypeError(`[RiichiRules] unknown option "${k}".`);
    }
    const o = { ...DEFAULT_RIICHI_OPTIONS, ...options };
    if (o.playerCount !== 3 && o.playerCount !== 4) throw new RangeError('[RiichiRules] playerCount must be 3 or 4.');
    if (typeof o.kuikae !== 'boolean' || typeof o.nineTerminalsDraw !== 'boolean') throw new TypeError('[RiichiRules] kuikae / nineTerminalsDraw must be booleans.');
    if (!Number.isInteger(o.riichiMinimumScore) || o.riichiMinimumScore < 0) throw new TypeError('[RiichiRules] riichiMinimumScore must be a non-negative integer.');
    if (!Number.isInteger(o.maxKongs) || o.maxKongs < 0 || o.maxKongs > 4) throw new RangeError('[RiichiRules] maxKongs must be 0–4.');
    if (typeof o.yakuProvider !== 'function') throw new TypeError('[RiichiRules] yakuProvider must be a function.');
    if (typeof o.kokushiRobsConcealedKong !== 'boolean') throw new TypeError('[RiichiRules] kokushiRobsConcealedKong must be a boolean.');
    if (typeof o.openTanyao !== 'boolean') throw new TypeError('[RiichiRules] openTanyao must be a boolean.');
    if (typeof o.doubleYakuman !== 'boolean') throw new TypeError('[RiichiRules] doubleYakuman must be a boolean.');
    if (typeof o.kazoeYakuman !== 'boolean' || typeof o.kiriageMangan !== 'boolean') throw new TypeError('[RiichiRules] kazoeYakuman / kiriageMangan must be booleans.');
    if (o.doubleWindPairFu !== 2 && o.doubleWindPairFu !== 4) throw new RangeError('[RiichiRules] doubleWindPairFu must be 2 or 4.');
    if (o.redFives !== 0 && o.redFives !== 3) throw new RangeError('[RiichiRules] redFives must be 0 or 3.');
    for (const k of ['kanDora', 'uraDora', 'kanUraDora', 'tripleRonAbort']) if (typeof o[k] !== 'boolean') throw new TypeError(`[RiichiRules] ${k} must be a boolean.`);
    if (o.startingScore !== null && (!Number.isInteger(o.startingScore) || o.startingScore < 0)) throw new TypeError('[RiichiRules] startingScore must be null or a non-negative integer.');
    if (!Number.isInteger(o.riichiStickValue) || o.riichiStickValue <= 0) throw new TypeError('[RiichiRules] riichiStickValue must be a positive integer.');
    for (const k of ['nagashiMangan', 'bustEndsGame', 'leftoverSticksToTop']) if (typeof o[k] !== 'boolean') throw new TypeError(`[RiichiRules] ${k} must be a boolean.`);
    /** @private */ this._options = Object.freeze(o);
  }

  getRulesetId() { return RULESET_ID.RIICHI; }
  getDisplayName() { return RULESET_LABEL[RULESET_ID.RIICHI]; }
  getOptions() { return this._options; }
  getTerminology() { return RIICHI_TERMINOLOGY; }

  /**
   * Task 89 — the Riichi turn flow GameManager drives (see RiichiTurnFlow.js).
   * @param {import('../../core/GameManager.js').GameManager} gameManager
   */
  createTurnFlow(gameManager) {
    return new RiichiTurnFlow(this, gameManager);
  }

  /**
   * Task 88 — the dora state for a hand dealt from `wall` (a WallManager with
   * the 14-tile dead wall reserved). See RiichiDora.js.
   * @returns {RiichiDoraState}
   */
  createDoraState(wall) {
    if (!wall || typeof wall.getReservedDeadWallTiles !== 'function') throw new TypeError('[RiichiRules] createDoraState requires a WallManager.');
    const o = this._options;
    return new RiichiDoraState(wall.getReservedDeadWallTiles(), {
      sanma: o.playerCount === 3, kanDora: o.kanDora, uraDora: o.uraDora, kanUraDora: o.kanUraDora, redFives: o.redFives,
    });
  }

  getTileSetOptions() {
    return {
      includeBonus: false,
      excludedFaceIds: this._options.playerCount === 3 ? SANMA_EXCLUDED_FACE_IDS.slice() : [],
      deadWallSize: 14,
    };
  }

  /**
   * Structural check of a COMPLETE hand: four sets + a pair, Seven Pairs
   * (seven different pairs) or Thirteen Orphans. No yaku requirement — that
   * is win validation (Task 82).
   * @returns {{ isWin: boolean, structure: 'standard'|'seven-pairs'|'thirteen-orphans'|null }}
   */
  checkWin(hand, context = {}) { // eslint-disable-line no-unused-vars
    if (!hand || !Array.isArray(hand.concealedTiles)) throw new TypeError('[RiichiRules] checkWin requires a hand.');
    const m = hand.meldCount;
    if (hand.concealedTiles.length !== 14 - 3 * m) return { isWin: false, structure: null };
    // Task 92: a probe for a 5th copy (DrawResolver#findWaits tries every face
    // at an exhaustive draw) is simply not a win — waiting on a tile whose four
    // copies you already hold is not tenpai.
    const kinds = new Map();
    for (const t of hand.concealedTiles) if (kinds.set(t.id, (kinds.get(t.id) ?? 0) + 1).get(t.id) > 4) return { isWin: false, structure: null };
    const a = analyzeComplete(countsFromTiles(hand.concealedTiles), m);
    const structure = a.thirteenOrphans ? 'thirteen-orphans' : a.standard.length ? 'standard' : a.sevenPairs ? 'seven-pairs' : null;
    return { isWin: a.isComplete, structure };
  }

  /**
   * Task 82 — is this a LEGAL win? A complete hand (any interpretation),
   * not in furiten when winning off a discard, with at least one yaku from
   * the yaku provider (dora never count — Task 88). Robbing a closed Kan is
   * only allowed for Thirteen Orphans.
   *
   * @param {import('../../core/Hand.js').Hand} hand  the COMPLETE hand, winning tile included
   * @param {Object} context
   *   winType 'self'|'discard', winningTile (required);
   *   isRiichi, seatWind, roundWind, isLastTile, isKongReplacement, isIppatsu,
   *   isDoubleRiichi (passed to the yaku provider);
   *   furiten inputs (Ron only): ownDiscards (tiles or face ids — every tile the
   *   player ever discarded, claimed ones included), isTemporaryFuriten,
   *   isRiichiFuriten; isChankan + robbedKongType 'added'|'concealed'.
   * @returns {{ valid: boolean, reason: string|null, structure: string|null,
   *   interpretations: Object[], waits: string[], furiten: { discard, temporary, riichi },
   *   isClosed: boolean, melds: Object[], yaku: Object[] }}
   */
  validateWin(hand, context = {}) {
    if (!hand || !Array.isArray(hand.concealedTiles) || !Array.isArray(hand.melds)) throw new TypeError('[RiichiRules] validateWin requires a hand.');
    if (!context || typeof context !== 'object') throw new TypeError('[RiichiRules] validateWin requires a context object.');
    const { winType, winningTile } = context;
    if (winType !== WIN_SOURCE.SELF && winType !== WIN_SOURCE.DISCARD) throw new TypeError(`[RiichiRules] validateWin: winType must be '${WIN_SOURCE.SELF}' or '${WIN_SOURCE.DISCARD}'.`);
    if (!winningTile || typeof winningTile.id !== 'string') throw new TypeError('[RiichiRules] validateWin: winningTile is required.');

    const m = hand.meldCount;
    const tiles = hand.concealedTiles;
    const isClosed = hand.melds.every((x) => x.concealed === true);
    const melds = hand.melds.map((x) => ({
      type: x.type, kind: Math.min(...x.tiles.map((t) => kindOfFaceId(t.id))), open: x.concealed !== true, kongType: x.kongType ?? null,
    }));
    const result = {
      valid: false, reason: null, structure: null, interpretations: [], waits: [],
      furiten: { discard: false, temporary: false, riichi: false }, isClosed, melds, yaku: [],
    };
    const fail = (reason) => { result.reason = reason; return result; };

    if (tiles.length !== 14 - 3 * m || !tiles.some((t) => t.id === winningTile.id)) return fail(WIN_REFUSAL.INCOMPLETE);
    const counts = countsFromTiles(tiles);
    const k = kindOfFaceId(winningTile.id);
    const interpretations = interpretWin(counts, m, k);
    if (!interpretations.length) return fail(WIN_REFUSAL.INCOMPLETE);
    result.interpretations = interpretations;
    const has = (st) => interpretations.some((i) => i.structure === st);
    result.structure = has('thirteen-orphans') ? 'thirteen-orphans' : has('standard') ? 'standard' : 'seven-pairs';
    const waiting = counts.slice(); waiting[k]--;
    result.waits = findWaits(waiting, m).map(faceIdOfKind);

    if (winType === WIN_SOURCE.DISCARD) {
      const own = (context.ownDiscards ?? []).map((d) => (typeof d === 'string' ? d : d?.id));
      result.furiten.discard = result.waits.some((w) => own.includes(w));
      result.furiten.temporary = context.isTemporaryFuriten === true;
      result.furiten.riichi = context.isRiichiFuriten === true;
    }
    result.yaku = this._detectYaku({ hand, interpretations, melds, isClosed, winType, winningTile, context, options: { openTanyao: this._options.openTanyao, doubleYakuman: this._options.doubleYakuman } });

    if (context.isChankan === true && context.robbedKongType === KONG_TYPE.CONCEALED
      && !(this._options.kokushiRobsConcealedKong && result.structure === 'thirteen-orphans')) return fail(WIN_REFUSAL.CANNOT_ROB);
    if (result.furiten.discard || result.furiten.temporary || result.furiten.riichi) return fail(WIN_REFUSAL.FURITEN);
    if (!result.yaku.length) return fail(WIN_REFUSAL.NO_YAKU);
    result.valid = true;
    return result;
  }

  /** @private — runs the yaku provider and checks what it returns. */
  _detectYaku(input) {
    const yaku = this._options.yakuProvider(input);
    if (!Array.isArray(yaku) || yaku.some((y) => !y || typeof y.id !== 'string' || typeof y.name !== 'string' || !Number.isInteger(y.han) || y.han < 1)) {
      throw new TypeError('[RiichiRules] yakuProvider must return [{ id, name, han ≥ 1 }].');
    }
    return yaku;
  }

  /**
   * Task 85 — scores a COMPLETE hand (HK-compatible result shape: `fan` = han,
   * `points` = what the winner collects before honba / riichi sticks,
   * `meetsMinimum` = the win is legal). Extra Riichi fields: han, fu,
   * yakuman, basePoints, limit, isDealer, payments, breakdown (yaku + dora),
   * fuBreakdown, interpretation, reason, validation. Context as validateWin
   * plus dora: { dora, uraDora, akaDora } (Task 88), isDealer, playerCount.
   */
  scoreHand(hand, context = {}) {
    const validation = this.validateWin(hand, context);
    const shell = {
      fan: 0, han: 0, fu: 0, yakuman: 0, basePoints: 0, limit: null, points: 0, payments: null,
      meetsMinimum: false, minimumFan: 1, isLimit: false, structure: validation.structure,
      breakdown: [], fuBreakdown: [], interpretation: null, reason: validation.reason, validation,
    };
    if (!validation.valid) return shell;
    const scored = scoreValidatedWin(validation, {
      hand, winType: context.winType, winningTile: context.winningTile, context,
      yakuOptions: { openTanyao: this._options.openTanyao, doubleYakuman: this._options.doubleYakuman },
      yakuProvider: this._options.yakuProvider === detectYaku ? null : this._options.yakuProvider,
    }, {
      kazoeYakuman: this._options.kazoeYakuman, kiriageMangan: this._options.kiriageMangan,
      doubleWindPairFu: this._options.doubleWindPairFu, playerCount: this._options.playerCount,
    });
    if (!scored) return shell;
    return { ...shell, ...scored, fan: scored.han, meetsMinimum: true, isLimit: scored.limit !== null };
  }

  /**
   * Legal actions for `player` in `state` (see the header and RuleEngineInterface).
   * @returns {Object[]}
   */
  getLegalActions(state, player) {
    if (!state || typeof state !== 'object') throw new TypeError('[RiichiRules] getLegalActions requires a state object.');
    if (!player || typeof player.getHand !== 'function') throw new TypeError('[RiichiRules] getLegalActions requires a player.');
    if (state.kind === 'self') return this._selfActions(state, player);
    if (state.kind === 'discard') return this._discardActions(state, player);
    throw new TypeError(`[RiichiRules] unknown state.kind: ${state.kind}`);
  }

  /**
   * Faces that may NOT be discarded right after `lastCall` (kuikae).
   * @param {{ type: 'chi'|'pon', tile: Object, sequence?: string[] }} lastCall
   * @returns {Set<string>}
   */
  kuikaeForbiddenFaces(lastCall) {
    _validateLastCall(lastCall);
    if (!this._options.kuikae) return new Set();
    const t = lastCall.tile;
    const out = new Set([t.id]);
    if (lastCall.type === 'chi') {
      const seq = lastCall.sequence;
      const beyond = t.id === seq[0] ? t.nextInSuit(3) : t.id === seq[2] ? t.nextInSuit(-3) : null;
      if (beyond) out.add(beyond);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Self turn
  // -------------------------------------------------------------------------

  /** @private */
  _selfActions(state, player) {
    const hand = player.getHand();
    const seatIndex = player.seatIndex;
    const tiles = hand.concealedTiles;

    if (state.lastCall !== undefined && state.lastCall !== null) {
      const forbidden = this.kuikaeForbiddenFaces(state.lastCall);
      const allowed = tiles.filter((t) => !forbidden.has(t.id));
      // Calls that would leave no legal discard are never offered; if a
      // caller still gets here, fall back to every tile rather than deadlock.
      return [{ type: ACTION_TYPE.DISCARD, seatIndex, allowedTiles: allowed.length ? allowed : tiles.slice() }];
    }

    const drawn = state.drawnTile ?? null;
    const canKong = this._canDeclareKong(state);
    const actions = [];

    // Task 82: Tsumo after a draw (riichi or not).
    if (drawn) {
      const validation = this.validateWin(hand, this._winContext(state, player, WIN_SOURCE.SELF, drawn));
      if (validation.valid) actions.push({ type: ACTION_TYPE.WIN, seatIndex, winType: WIN_SOURCE.SELF, tile: drawn, validation });
    }

    if (state.isRiichi === true) {
      if (!drawn) throw new TypeError('[RiichiRules] a riichi self turn needs state.drawnTile.');
      if (canKong) {
        const kan = this._riichiConcealedKong(hand, drawn, seatIndex);
        if (kan) actions.push(kan);
      }
      actions.push({ type: ACTION_TYPE.DISCARD, seatIndex, allowedTiles: [drawn] });
      return actions;
    }

    if (canKong) {
      const byFace = _groupByFace(tiles);
      for (const [faceId, group] of byFace) {
        if (group.length === 4) actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.CONCEALED, faceId, tiles: group });
      }
      hand.melds.forEach((meld, meldIndex) => {
        if (meld.type !== MELD_TYPE.PON) return;
        const tile = tiles.find((t) => t.id === meld.faceId);
        if (tile) actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.ADDED, faceId: meld.faceId, tile, meldIndex });
      });
    }

    const riichi = this._riichiAction(state, player);
    if (riichi) actions.push(riichi);

    const nine = this._nineTerminalsAction(state, hand, seatIndex);
    if (nine) actions.push(nine);

    actions.push({ type: ACTION_TYPE.DISCARD, seatIndex, allowedTiles: tiles.slice() });
    return actions;
  }

  /** @private — the validateWin() context for a state (Task 82). */
  _winContext(state, player, winType, winningTile) {
    const ctx = {
      winType,
      winningTile,
      seatWind: state.seatWind ?? player.seatWind,
      roundWind: state.roundWind,
      isRiichi: state.isRiichi === true,
      isLastTile: state.wallRemaining === 0,
      isKongReplacement: winType === WIN_SOURCE.SELF && state.isReplacementDraw === true,
    };
    for (const f of ['isIppatsu', 'isDoubleRiichi', 'isFirstUninterruptedTurn']) if (state[f] !== undefined) ctx[f] = state[f];
    if (winType === WIN_SOURCE.DISCARD) {
      ctx.ownDiscards = state.ownDiscards ?? (typeof player.getDiscardPile === 'function' ? player.getDiscardPile().tiles : []);
      ctx.isTemporaryFuriten = state.isTemporaryFuriten === true;
      ctx.isRiichiFuriten = state.isRiichiFuriten === true;
    }
    return ctx;
  }

  /** @private */
  _canDeclareKong(state) {
    const kongCount = state.kongCount ?? 0;
    if (!Number.isInteger(kongCount) || kongCount < 0) throw new TypeError('[RiichiRules] state.kongCount must be a non-negative integer.');
    return (state.wallRemaining ?? 1) > 0 && kongCount < this._options.maxKongs;
  }

  /** @private — RIICHI when eligible (see header). */
  _riichiAction(state, player) {
    const hand = player.getHand();
    if (!state.drawnTile) return null;
    if (!hand.melds.every((m) => m.concealed === true)) return null; // an open hand can't riichi
    const score = state.score ?? player.score ?? 0;
    if (score < this._options.riichiMinimumScore) return null;
    const playerCount = state.playerCount ?? this._options.playerCount;
    if ((state.wallRemaining ?? Infinity) < playerCount) return null;
    const m = hand.meldCount;
    const tiles = hand.concealedTiles;
    if (tiles.length !== 14 - 3 * m) return null;
    const counts = countsFromTiles(tiles);
    const inMelds = _meldKindCounts(hand);
    const options = [];
    for (const [faceId, group] of _groupByFace(tiles)) {
      const c = counts.slice(); c[kindOfFaceId(faceId)]--;
      // A wait on a kind whose four copies are all the player's own (e.g. in
      // a closed Kan) can never arrive, so it does not count.
      const waits = findWaits(c, m).filter((w) => c[w] + inMelds[w] < 4);
      if (waits.length) options.push({ faceId, tiles: group, waits: waits.map(faceIdOfKind) });
    }
    if (!options.length) return null;
    options.sort((a, b) => kindOfFaceId(a.faceId) - kindOfFaceId(b.faceId));
    return { type: ACTION_TYPE.RIICHI, seatIndex: player.seatIndex, options, allowedTiles: options.flatMap((o) => o.tiles) };
  }

  /** @private — closed Kan after riichi: drawn tile only, waits and reading unchanged. */
  _riichiConcealedKong(hand, drawn, seatIndex) {
    const tiles = hand.concealedTiles;
    const group = tiles.filter((t) => t.id === drawn.id);
    if (group.length !== 4) return null;
    const m = hand.meldCount;
    if (tiles.length !== 14 - 3 * m) return null;
    const k = kindOfFaceId(drawn.id);
    const waiting = countsFromTiles(tiles); waiting[k]--;
    const before = findWaits(waiting, m);
    if (!before.length) return null;
    const after = countsFromTiles(tiles); after[k] -= 4;
    const afterWaits = findWaits(after, m + 1).filter((w) => w !== k); // all four k are in the Kan
    if (afterWaits.join() !== before.join()) return null;
    for (const w of before) {
      const c = waiting.slice(); c[w]++;
      const decomps = decomposeStandard(c, m);
      if (!decomps.length || !decomps.every((d) => d.sets.some((s) => s.type === 'triplet' && s.kind === k))) return null;
    }
    return { type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.CONCEALED, faceId: drawn.id, tiles: group };
  }

  /** @private */
  _nineTerminalsAction(state, hand, seatIndex) {
    if (!this._options.nineTerminalsDraw || state.isFirstUninterruptedTurn !== true || !state.drawnTile) return null;
    if (hand.meldCount !== 0) return null;
    const kinds = [...new Set(hand.concealedTiles.map((t) => kindOfFaceId(t.id)))].filter(isTerminalOrHonorKind);
    if (kinds.length < 9) return null;
    return { type: ACTION_TYPE.ABORTIVE_DRAW, seatIndex, reason: 'nine-terminals', faceIds: kinds.sort((a, b) => a - b).map(faceIdOfKind) };
  }

  // -------------------------------------------------------------------------
  // Another player's discard
  // -------------------------------------------------------------------------

  /** @private */
  _discardActions(state, player) {
    const { discard } = state;
    if (!discard || !discard.tile || !Number.isInteger(discard.fromSeat)) {
      throw new TypeError('[RiichiRules] discard state needs { tile, fromSeat }.');
    }
    const seatIndex = player.seatIndex;
    if (seatIndex === discard.fromSeat) return [];
    const hand = player.getHand();
    const tile = discard.tile;
    const fromSeat = discard.fromSeat;
    const actions = [];

    // Task 82: Ron — also in riichi, on the final discard, and on a tile being
    // added to / declared as a Kan (chankan: discard.robbedKong).
    const robbed = discard.robbedKong;
    if (robbed !== undefined && robbed !== KONG_TYPE.ADDED && robbed !== KONG_TYPE.CONCEALED) {
      throw new TypeError("[RiichiRules] discard.robbedKong must be 'added' or 'concealed'.");
    }
    const ctx = { ...this._winContext(state, player, WIN_SOURCE.DISCARD, tile), ...(robbed ? { isChankan: true, robbedKongType: robbed } : {}) };
    const validation = this.validateWin(createHandViewWithExtraTile(hand, tile), ctx);
    if (validation.valid) actions.push({ type: ACTION_TYPE.WIN, seatIndex, winType: WIN_SOURCE.DISCARD, tile, fromSeat, validation });

    if (robbed) return actions;                           // a Kan tile can only be robbed, never called
    if (state.isRiichi === true) return actions;          // riichi: Ron only
    if ((state.wallRemaining ?? 1) === 0) return actions; // final discard: Ron only
    if (hand.meldCount >= 4) return actions;

    const concealed = hand.concealedTiles;
    const leavesDiscard = (used, lastCall) => {
      const ids = new Set(used.map((t) => t.instanceId));
      const forbidden = this.kuikaeForbiddenFaces(lastCall);
      return concealed.some((t) => !ids.has(t.instanceId) && !forbidden.has(t.id));
    };

    const same = concealed.filter((t) => t.id === tile.id);
    if (same.length >= 3 && this._canDeclareKong(state)) {
      actions.push({ type: ACTION_TYPE.KONG, seatIndex, kongType: KONG_TYPE.EXPOSED, faceId: tile.id, tile, handTiles: same.slice(0, 3), fromSeat });
    }
    if (same.length >= 2 && leavesDiscard(same.slice(0, 2), { type: 'pon', tile })) {
      actions.push({ type: ACTION_TYPE.PON, seatIndex, faceId: tile.id, tile, handTiles: same.slice(0, 2), fromSeat });
    }

    const playerCount = state.playerCount ?? this._options.playerCount;
    const isNextSeat = seatIndex === (fromSeat + 1) % playerCount;
    if (playerCount === 4 && isNextSeat && tile.isSuited) {
      const find = (faceId) => concealed.find((t) => t.id === faceId);
      for (const offsets of [[-2, -1], [-1, 1], [1, 2]]) {
        const ids = offsets.map((o) => tile.nextInSuit(o));
        if (ids.some((id) => id === null)) continue;
        const handTiles = ids.map(find);
        if (handTiles.some((t) => !t)) continue;
        const sequence = [...ids, tile.id].sort((a, b) => kindOfFaceId(a) - kindOfFaceId(b));
        if (!leavesDiscard(handTiles, { type: 'chi', tile, sequence })) continue;
        actions.push({ type: ACTION_TYPE.CHI, seatIndex, tile, handTiles, sequence, fromSeat });
      }
    }
    return actions;
  }
}

// ---------------------------------------------------------------------------

/** Copies of each kind inside the player's own melds. */
function _meldKindCounts(hand) {
  const c = new Array(34).fill(0);
  for (const meld of hand.melds) for (const t of meld.tiles) c[kindOfFaceId(t.id)]++;
  return c;
}

function _groupByFace(tiles) {
  const byFace = new Map();
  for (const t of tiles) byFace.set(t.id, [...(byFace.get(t.id) ?? []), t]);
  return byFace;
}

function _validateLastCall(lastCall) {
  if (!lastCall || typeof lastCall !== 'object' || (lastCall.type !== 'chi' && lastCall.type !== 'pon')) {
    throw new TypeError('[RiichiRules] lastCall must be { type: "chi"|"pon", tile, sequence? }.');
  }
  if (!lastCall.tile || typeof lastCall.tile.id !== 'string') throw new TypeError('[RiichiRules] lastCall.tile must be a tile.');
  if (lastCall.type === 'chi') {
    const seq = lastCall.sequence;
    if (!Array.isArray(seq) || seq.length !== 3 || !seq.includes(lastCall.tile.id)) {
      throw new TypeError('[RiichiRules] a chi lastCall needs sequence: three face ids including the called tile.');
    }
  }
}

/**
 * RuleEngineInterface.js
 *
 * The contract every ruleset module implements (Task 21). Core code only ever
 * talks to a ruleset through these methods, so Hong Kong, Riichi and Chinese
 * Official stay fully isolated from each other.
 *
 * REBUILT (after Task 77) from the plan's architecture section
 * ("RuleEngine: getLegalActions(state, player), checkWin(hand, context),
 * scoreHand(hand, context), getTerminology()") plus what later tasks rely on
 * (tile-set options for the deck; `meetsMinimum` on score results).
 *
 * ── Legal-action STATE (passed to getLegalActions) ──────────────────────
 *   { kind: 'self',    seatIndex, playerCount, drawnTile, isReplacementDraw,
 *                      wallRemaining, seatWind, roundWind }
 *   { kind: 'discard', seatIndex, playerCount, discard: { tile, fromSeat },
 *                      wallRemaining, seatWind, roundWind }
 *
 * ── Action objects (ACTION_TYPE) ────────────────────────────────────────
 *   { type: DISCARD, seatIndex }                                  (self only)
 *   { type: WIN,  seatIndex, winType: 'self'|'discard', tile, fromSeat? }
 *   { type: KONG, seatIndex, kongType: 'concealed', faceId, tiles[4] }
 *   { type: KONG, seatIndex, kongType: 'added', faceId, tile, meldIndex }
 *   { type: KONG, seatIndex, kongType: 'exposed', faceId, tile, handTiles[3], fromSeat }
 *   { type: PON,  seatIndex, faceId, tile, handTiles[2], fromSeat }
 *   { type: CHI,  seatIndex, tile, handTiles[2], sequence[3 faceIds], fromSeat }
 *   { type: PASS }                                    (always allowed; not listed)
 *
 *   Ruleset-specific additions (Task 81, Riichi — see RiichiRules.js):
 *   DISCARD may carry allowedTiles: Tile[] (riichi lock, swap-calling ban);
 *   { type: RIICHI, seatIndex, options: [{ faceId, tiles, waits }], allowedTiles }
 *   { type: ABORTIVE_DRAW, seatIndex, reason, faceIds }
 *   Riichi state may also carry isRiichi, score, kongCount, lastCall,
 *   isFirstUninterruptedTurn, ownDiscards, isTemporaryFuriten,
 *   isRiichiFuriten, isIppatsu, isDoubleRiichi and discard.robbedKong
 *   (Task 82). Riichi WIN actions carry `validation` instead of `score`
 *   until Riichi scoring exists (Tasks 85–86). Engines that don't use these
 *   fields ignore them.
 *
 * ── Score result (scoreHand) ────────────────────────────────────────────
 *   { fan, points, meetsMinimum, minimumFan, isLimit, structure,
 *     breakdown: [{ id, name, fan }] }
 *
 * ── Scoring CONTEXT (checkWin / scoreHand) ──────────────────────────────
 *   { winType: 'self'|'discard', winningTile, seatWind, roundWind,
 *     isLastTile, isKongReplacement }
 */

const REQUIRED_METHODS = Object.freeze([
  'getRulesetId',
  'getDisplayName',
  'getTileSetOptions',
  'getLegalActions',
  'checkWin',
  'scoreHand',
  'getTerminology',
]);

export class RuleEngineInterface {
  constructor() {
    if (new.target === RuleEngineInterface) {
      throw new TypeError('[RuleEngineInterface] is abstract — extend it.');
    }
  }

  /** @returns {string} RULESET_ID value */
  getRulesetId() { throw new Error(`${this.constructor.name} must implement getRulesetId()`); }

  /** @returns {string} */
  getDisplayName() { throw new Error(`${this.constructor.name} must implement getDisplayName()`); }

  /** @returns {{ includeBonus: boolean, excludedFaceIds: string[], deadWallSize: number }} */
  getTileSetOptions() { throw new Error(`${this.constructor.name} must implement getTileSetOptions()`); }

  /** @returns {Object[]} legal action objects (see header) */
  // eslint-disable-next-line no-unused-vars
  getLegalActions(state, player) { throw new Error(`${this.constructor.name} must implement getLegalActions()`); }

  /** @returns {{ isWin: boolean, structure: string|null }} */
  // eslint-disable-next-line no-unused-vars
  checkWin(hand, context) { throw new Error(`${this.constructor.name} must implement checkWin()`); }

  /** @returns {Object} score result (see header) */
  // eslint-disable-next-line no-unused-vars
  scoreHand(hand, context) { throw new Error(`${this.constructor.name} must implement scoreHand()`); }

  /** @returns {Object<string,string>} */
  getTerminology() { throw new Error(`${this.constructor.name} must implement getTerminology()`); }
}

/** Methods every rule engine must provide. */
export const RULE_ENGINE_METHODS = REQUIRED_METHODS;

/**
 * Duck-type check (works for subclasses and plain objects).
 * @param {*} engine
 * @returns {boolean}
 */
export function isValidRuleEngine(engine) {
  return !!engine && REQUIRED_METHODS.every((m) => typeof engine[m] === 'function');
}

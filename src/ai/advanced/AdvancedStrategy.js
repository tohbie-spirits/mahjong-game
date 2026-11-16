/**
 * AdvancedStrategy.js
 *
 * Task 74: efficient-discard selection using HandEfficiencyEvaluator (Task 73).
 *
 * WHAT THIS FILE CONTAINS (as of Task 74): the Advanced AI's discard DECISION
 * LOGIC, as pure functions:
 *
 *   chooseEfficientDiscard(counts, options)
 *     → { discardIndex, shanten, ukeire, keepValue, candidates }
 *   selectDiscardTile(tiles, tileToIndex, options)
 *     → { tile, ...chooseEfficientDiscard result }
 *   tileKeepValue(index, counts, options) → number
 *
 * Task 78 added the `AdvancedStrategy` CLASS (extends AIStrategyInterface,
 * strategyId AI_DIFFICULTY.ADVANCED) that plugs all of this into AIManager /
 * GameManager on the rebuilt engine — see the "AdvancedStrategy class"
 * section at the end — plus the real adapters it needs:
 *
 *   tileToKindIndex(tile)        Tile → 0–33 (bonus tiles → null)
 *   readTable(player, context)   GameManager AI context → visibleCounts,
 *                                opponents, valuableHonorIndices
 *
 * Task 75 added the CLAIM decision logic (Chi / Pon / Kong on another
 * player's discard), also as pure functions — see the "Claim evaluation"
 * section below:
 *
 *   CLAIM_KIND, CLAIM_REASON
 *   evaluateClaim(counts, claim, options)   → { accept, reason, before, after }
 *   chooseBestClaim(counts, claims, options) → { claim, evaluation } | null (pass)
 *
 * Claims are described with this module's own plain shape
 * (`{ kind: 'chi'|'pon'|'kong', tileIndex, sequence? }`) rather than the
 * engine's ACTION_TYPE action objects, for the same reason as the Tile
 * adapter: the real action shape (HongKongRules.js, Task 22) wasn't
 * available. The class wrapper (Task 78 at the latest) maps each legal
 * action → claim, calls chooseBestClaim(), and returns the matching action
 * object (or PASS). Ron/win claims are NOT handled here — winning is
 * chooseWinDeclaration's job (BasicStrategy already implements it, Task 39).
 *
 * Task 77 added the DEFENSIVE OVERRIDE — push / balance / fold, combining
 * the efficiency ranking above with DefensivePlayEvaluator's danger (Task 76):
 *
 *   DISCARD_MODE, DEFAULT_DEFENSE_SETTINGS
 *   chooseDefensiveDiscard(counts, table, options)
 *     → { discardIndex, mode, shanten, ukeire, danger, threat, candidates }
 *   selectDefensiveDiscardTile(tiles, tileToIndex, table, options)
 *     → { tile, ...chooseDefensiveDiscard result }
 *
 * Task 79 makes "Advanced" selectable in the New Game wizard; until then
 * nothing in main.js registers this strategy, so the running game is
 * unaffected (tests and simulations use it directly).
 *
 * DECISION ORDER (strict, lexicographic):
 *   1. Lowest shanten after the discard        — never step backwards.
 *   2. Most ukeire (live copies that improve)  — fastest expected progress.
 *   3. Lowest keep-value of the discarded tile — among genuinely equal
 *      efficiency choices, throw the least useful tile: isolated honours
 *      first (unless marked valuable), then terminals, then edge ranks,
 *      then middle ranks; tiles with neighbours / copies are kept longest.
 *   4. Lowest tile index                      — fully deterministic.
 *
 * Steps 1–2 come straight from HandEfficiencyEvaluator.evaluateDiscards().
 * Step 3 is the "advanced" tie-break that the raw evaluator deliberately
 * doesn't have. Defensive overrides (danger-tile avoidance) arrive in
 * Tasks 76–77 on top of this, as a separate layer.
 *
 * `valuableHonorIndices` exists because in Hong Kong scoring a triplet of
 * dragons or of the seat/round wind earns fan — so a lone Red Dragon is worth
 * more than a lone off-wind. Which indices those are depends on the seat and
 * round, so the caller supplies them; this module never guesses.
 */

import {
  TILE_KIND_COUNT,
  HONOR_START,
  SUIT_SIZE,
  countsFromTiles,
  evaluateDiscards,
  calculateUkeire,
} from './HandEfficiencyEvaluator.js';
import { assessDanger } from './DefensivePlayEvaluator.js';
import { AIStrategyInterface } from '../AIStrategyInterface.js';
import { BasicStrategy } from '../basic/BasicStrategy.js';
import { calculateShanten as _calculateShanten } from './HandEfficiencyEvaluator.js';
import { ACTION_TYPE, AI_DIFFICULTY, KONG_TYPE, MELD_TYPE, SUIT, WIND_ORDER, DRAGON_ORDER, WIN_SOURCE } from '../../utils/constants.js';
import { analyzeValueRoutes, honorPungFan } from './HandValuePlanner.js';
import { Tile } from '../../core/Tile.js';
import { Meld } from '../../core/Hand.js';
import { STANDARD_FACE_IDS } from '../../core/TileSetGenerator.js';
import { isRiichiContext, chooseRiichiDeclaration, distinctTerminalHonorKinds } from '../RiichiAIHelpers.js';
import { isChineseOfficialContext, analyzeMcrRoutes, mcrWaitKinds } from '../ChineseOfficialAIHelpers.js';

// ---------------------------------------------------------------------------
// Keep-value heuristic
// ---------------------------------------------------------------------------

/** Base value by position, before connectivity. Higher = keep longer. */
const BASE_VALUE = Object.freeze({
  HONOR: 1,
  VALUABLE_HONOR: 3,
  TERMINAL: 2,      // ranks 1, 9
  EDGE: 3,          // ranks 2, 8
  MIDDLE: 4,        // ranks 3–7
});

/** Bonus per extra copy held (pairs/triplets are building blocks). */
const COPY_BONUS = 3;
/** Bonus per held tile one rank away (same suit). */
const ADJACENT_BONUS = 2;
/** Bonus per held tile two ranks away (same suit). */
const GAP_BONUS = 1;

/**
 * How much a single tile of kind `index` contributes to this hand — the
 * tie-break used when two discards are equally efficient. Higher means
 * "keep it"; the lowest-valued candidate gets discarded.
 *
 * @param {number} index  tile-kind index 0–33
 * @param {number[]} counts  the hand's 34-slot count array (including this tile)
 * @param {{ valuableHonorIndices?: number[] }} [options]
 * @returns {number}
 */
export function tileKeepValue(index, counts, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= TILE_KIND_COUNT) {
    throw new TypeError(`[AdvancedStrategy] tileKeepValue: invalid tile-kind index ${index}.`);
  }
  if (!Array.isArray(counts) || counts.length !== TILE_KIND_COUNT) {
    throw new TypeError('[AdvancedStrategy] tileKeepValue requires a 34-slot count array.');
  }
  const valuable = _valuableSet(options.valuableHonorIndices, 'tileKeepValue');
  const copies = Math.max(0, counts[index] - 1);

  if (index >= HONOR_START) {
    const base = valuable.has(index) ? BASE_VALUE.VALUABLE_HONOR : BASE_VALUE.HONOR;
    return base + copies * COPY_BONUS;
  }

  const rank = (index % SUIT_SIZE) + 1;
  const suitStart = index - (index % SUIT_SIZE);
  let base;
  if (rank === 1 || rank === 9) base = BASE_VALUE.TERMINAL;
  else if (rank === 2 || rank === 8) base = BASE_VALUE.EDGE;
  else base = BASE_VALUE.MIDDLE;

  let neighbours = 0;
  for (const [offset, bonus] of [[-2, GAP_BONUS], [-1, ADJACENT_BONUS], [1, ADJACENT_BONUS], [2, GAP_BONUS]]) {
    const j = index + offset;
    if (j >= suitStart && j < suitStart + SUIT_SIZE && counts[j] > 0) neighbours += bonus;
  }
  return base + copies * COPY_BONUS + neighbours;
}

/** @private */
function _valuableSet(valuableHonorIndices, fnName) {
  if (valuableHonorIndices === undefined) return new Set();
  if (!Array.isArray(valuableHonorIndices)) {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: valuableHonorIndices must be an array of honour indices.`);
  }
  for (const i of valuableHonorIndices) {
    if (!Number.isInteger(i) || i < HONOR_START || i >= TILE_KIND_COUNT) {
      throw new TypeError(`[AdvancedStrategy] ${fnName}: valuableHonorIndices may only contain honour indices ${HONOR_START}–${TILE_KIND_COUNT - 1}; got ${i}.`);
    }
  }
  return new Set(valuableHonorIndices);
}

// ---------------------------------------------------------------------------
// Discard choice
// ---------------------------------------------------------------------------

/**
 * Chooses the most efficient discard for a hand that has just drawn
 * (14 − 3·meldCount concealed tiles).
 *
 * @param {number[]} counts  34-slot count array
 * @param {Object}  [options]
 * @param {number}  [options.meldCount=0]
 * @param {boolean} [options.allowSevenPairs=false]
 * @param {boolean} [options.allowThirteenOrphans=false]
 * @param {number[]} [options.visibleCounts]  other copies the player can see
 * @param {number[]} [options.valuableHonorIndices]  honours worth keeping (dragons, seat/round wind)
 * @returns {{
 *   discardIndex: number, shanten: number, ukeire: number, keepValue: number,
 *   candidates: { discardIndex: number, shanten: number, ukeire: number, ukeireTiles: Object[], keepValue: number }[]
 * }}
 *   `candidates` is every distinct discard in final decision order (best first).
 */
export function chooseEfficientDiscard(counts, options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('[AdvancedStrategy] chooseEfficientDiscard options must be an object.');
  }
  const { valuableHonorIndices, valueShanten, valueUkeire, ...evaluatorOptions } = options;
  _valuableSet(valuableHonorIndices, 'chooseEfficientDiscard'); // validate early
  for (const [name, arr] of [['valueShanten', valueShanten], ['valueUkeire', valueUkeire]]) {
    if (arr !== undefined && (!Array.isArray(arr) || arr.length !== TILE_KIND_COUNT)) {
      throw new TypeError(`[AdvancedStrategy] chooseEfficientDiscard: ${name} must be a ${TILE_KIND_COUNT}-slot array when supplied.`);
    }
  }

  // evaluateDiscards validates counts/hand size/meldCount/visibleCounts.
  const evaluated = evaluateDiscards(counts, evaluatorOptions);

  // Task 78b: a value layer may replace each candidate's shanten with its
  // VALUE shanten (distance to a hand that can actually be declared) and the
  // ukeire with the number of tiles that improve it. The plain numbers are
  // kept as plainShanten / plainUkeire.
  const candidates = evaluated.map((r) => {
    const vs = valueShanten?.[r.discardIndex];
    const vu = valueUkeire?.[r.discardIndex];
    return {
      ...r,
      plainShanten: r.shanten,
      plainUkeire: r.ukeire,
      shanten: typeof vs === 'number' && Number.isFinite(vs) ? Math.max(vs, r.shanten) : r.shanten,
      ukeire: typeof vu === 'number' && Number.isFinite(vu) ? vu : r.ukeire,
      keepValue: tileKeepValue(r.discardIndex, counts, { valuableHonorIndices }),
    };
  });
  candidates.sort(
    (a, b) =>
      a.shanten - b.shanten ||
      b.ukeire - a.ukeire ||
      a.keepValue - b.keepValue ||
      a.discardIndex - b.discardIndex
  );

  const best = candidates[0];
  return {
    discardIndex: best.discardIndex,
    shanten: best.shanten,
    ukeire: best.ukeire,
    keepValue: best.keepValue,
    candidates,
  };
}

/**
 * Picks the actual tile object to discard from a list of concealed tiles,
 * using an injected `tileToIndex(tile)` mapping (null/undefined → bonus tile,
 * ignored and never chosen).
 *
 * When several tiles share the chosen kind, the LAST one in `tiles` is
 * returned — conventionally the most recently drawn, so a just-drawn useless
 * tile goes straight back out ("tsumogiri") and the hand's existing
 * instances stay put. Callers that don't order tiles by draw time lose
 * nothing: any copy of a kind is equivalent for the decision.
 *
 * @param {Array<*>} tiles  concealed tiles (any objects)
 * @param {function(*): (number|null|undefined)} tileToIndex
 * @param {Object} [options]  same as chooseEfficientDiscard
 * @returns {{ tile: *, discardIndex: number, shanten: number, ukeire: number, keepValue: number, candidates: Object[] }}
 */
export function selectDiscardTile(tiles, tileToIndex, options = {}) {
  if (!Array.isArray(tiles)) {
    throw new TypeError('[AdvancedStrategy] selectDiscardTile requires an array of tiles.');
  }
  const counts = countsFromTiles(tiles, tileToIndex); // validates tileToIndex
  const result = chooseEfficientDiscard(counts, options);

  for (let i = tiles.length - 1; i >= 0; i--) {
    if (tileToIndex(tiles[i]) === result.discardIndex) {
      return { tile: tiles[i], ...result };
    }
  }
  // Unreachable: the chosen kind came from these very tiles.
  throw new Error('[AdvancedStrategy] selectDiscardTile: chosen kind not found among tiles.');
}

// ===========================================================================
// Claim evaluation (Task 75)
// ===========================================================================

/** Claim kinds this module evaluates. Ron/win is chooseWinDeclaration's job. */
export const CLAIM_KIND = Object.freeze({
  CHI:  'chi',
  PON:  'pon',
  KONG: 'kong',
});

/** Why a claim was accepted or rejected — useful for logs, tests and tuning. */
export const CLAIM_REASON = Object.freeze({
  PROGRESS:        'progress',        // accepted: claim + best discard lowers shanten
  VALUABLE_HONOR:  'valuable-honor',  // accepted: Pon/Kong of a fan-earning honour, no shanten loss
  KONG_NO_LOSS:    'kong-no-loss',    // accepted: Kong keeps shanten and gives a free replacement draw
  KEEP_CONCEALED:  'keep-concealed',  // rejected: preferConcealed — near tenpai, stay concealed
  NO_PROGRESS:     'no-progress',     // rejected: shanten unchanged and nothing else gained
  LOSES_PROGRESS:  'loses-progress',  // rejected: claim would leave the hand further from winning
});

/** Kind order used only as the final tie-break in chooseBestClaim(). */
const KIND_PRIORITY = Object.freeze({ kong: 0, pon: 1, chi: 2 });

/**
 * Validates a claim against the hand and returns the tile kinds the claim
 * takes OUT of the concealed hand (the claimed discard itself is not in it).
 * @private
 */
function _claimHandTiles(counts, claim, fnName) {
  if (claim === null || typeof claim !== 'object') {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: claim must be an object.`);
  }
  const { kind, tileIndex } = claim;
  if (!Object.values(CLAIM_KIND).includes(kind)) {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: claim.kind must be 'chi', 'pon' or 'kong'; got ${JSON.stringify(kind)}.`);
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= TILE_KIND_COUNT) {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: claim.tileIndex must be a tile-kind index 0–33; got ${tileIndex}.`);
  }

  if (kind === CLAIM_KIND.PON || kind === CLAIM_KIND.KONG) {
    const need = kind === CLAIM_KIND.PON ? 2 : 3;
    if (counts[tileIndex] < need) {
      throw new RangeError(`[AdvancedStrategy] ${fnName}: ${kind} needs ${need} copies of kind ${tileIndex} in hand; have ${counts[tileIndex]}.`);
    }
    return new Array(need).fill(tileIndex);
  }

  // Chi
  const seq = claim.sequence;
  if (!Array.isArray(seq) || seq.length !== 3 || !seq.every((i) => Number.isInteger(i))) {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: chi claim needs sequence: [a, a+1, a+2].`);
  }
  const sorted = seq.slice().sort((a, b) => a - b);
  const [a, b, c] = sorted;
  const sameSuit = a >= 0 && c < HONOR_START && Math.floor(a / SUIT_SIZE) === Math.floor(c / SUIT_SIZE);
  if (!sameSuit || b !== a + 1 || c !== a + 2) {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: chi sequence must be three consecutive ranks of one suit; got [${seq}].`);
  }
  if (!sorted.includes(tileIndex)) {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: chi sequence [${seq}] does not contain the claimed tile ${tileIndex}.`);
  }
  const fromHand = sorted.filter((i, pos) => pos !== sorted.indexOf(tileIndex));
  for (const i of fromHand) {
    if (counts[i] < 1) {
      throw new RangeError(`[AdvancedStrategy] ${fnName}: chi needs kind ${i} in hand.`);
    }
  }
  return fromHand;
}

/**
 * Decides whether to claim another player's discard.
 *
 * `counts` is the claimer's WAITING hand (13 − 3·meldCount concealed tiles —
 * it's someone else's turn). The function simulates the claim:
 *   - Chi / Pon: the meld's hand tiles leave the concealed hand, meldCount
 *     rises by one, and the claimer must discard → the best efficient discard
 *     (chooseEfficientDiscard) is applied and the RESULTING waiting hand is
 *     compared with the current one.
 *   - Kong: three hand tiles leave, meldCount rises, and a replacement tile
 *     will be drawn — the resulting waiting hand is compared directly (the
 *     extra draw is the Kong's bonus, credited via KONG_NO_LOSS).
 *
 * Decision (in order):
 *   1. after.shanten > before.shanten         → reject  LOSES_PROGRESS
 *   2. preferConcealed && hand still concealed && before.shanten ≤ 1 &&
 *      not a valuable honour                  → reject  KEEP_CONCEALED
 *   3. after.shanten < before.shanten         → accept  PROGRESS
 *   4. Pon/Kong of a valuableHonorIndices tile → accept VALUABLE_HONOR
 *   5. Kong                                    → accept KONG_NO_LOSS
 *   6. otherwise                               → reject NO_PROGRESS
 *
 * Why these rules: claiming opens the hand (Seven Pairs / Thirteen Orphans
 * become impossible and, in Hong Kong, the concealed-hand bonus is lost), so a
 * claim must buy real progress or real fan. `preferConcealed` (default off)
 * is for rulesets/tables where staying concealed near tenpai is worth more
 * than one step (Riichi later; optional for HK). Valuable honours are
 * caller-supplied, exactly as in chooseEfficientDiscard().
 *
 * @param {number[]} counts  waiting hand (13 − 3m tiles)
 * @param {{kind: string, tileIndex: number, sequence?: number[]}} claim
 * @param {Object}  [options]
 * @param {number}  [options.meldCount=0]
 * @param {boolean} [options.allowSevenPairs=false]   (only affects the BEFORE hand — an open hand can't use it)
 * @param {boolean} [options.allowThirteenOrphans=false]
 * @param {number[]} [options.visibleCounts]  copies visible to this player, NOT including the discard being claimed
 * @param {number[]} [options.valuableHonorIndices]
 * @param {boolean} [options.preferConcealed=false]
 * @returns {{
 *   accept: boolean, reason: string,
 *   before: { shanten: number, ukeire: number },
 *   after:  { shanten: number, ukeire: number, discardIndex: number|null }
 * }}
 */
export function evaluateClaim(counts, claim, options = {}) {
  const fnName = 'evaluateClaim';
  if (options === null || typeof options !== 'object') {
    throw new TypeError(`[AdvancedStrategy] ${fnName} options must be an object.`);
  }
  const {
    valuableHonorIndices,
    preferConcealed = false,
    visibleCounts,
    meldCount = 0,
    ...shapeOptions
  } = options;
  const valuable = _valuableSet(valuableHonorIndices, fnName);
  if (!Array.isArray(counts) || counts.length !== TILE_KIND_COUNT) {
    throw new TypeError(`[AdvancedStrategy] ${fnName} requires a 34-slot count array.`);
  }
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 3) {
    throw new TypeError(`[AdvancedStrategy] ${fnName}: meldCount must be 0–3 to claim another meld; got ${meldCount}.`);
  }

  // BEFORE: the current waiting hand (validates counts + hand size).
  const beforeOpts = { ...shapeOptions, meldCount, ...(visibleCounts ? { visibleCounts } : {}) };
  const beforeUk = calculateUkeire(counts, beforeOpts);
  const before = { shanten: beforeUk.shanten, ukeire: beforeUk.total };

  const fromHand = _claimHandTiles(counts, claim, fnName);

  // The claimed discard is public: count it as seen for availability.
  const seen = visibleCounts ? visibleCounts.slice() : new Array(TILE_KIND_COUNT).fill(0);
  if (seen[claim.tileIndex] < 4) seen[claim.tileIndex] += 1;

  // AFTER: open hand — special shapes are impossible once a meld is exposed.
  const afterCounts = counts.slice();
  for (const i of fromHand) afterCounts[i] -= 1;
  const afterMelds = meldCount + 1;
  const afterOpts = { meldCount: afterMelds };

  let after;
  if (claim.kind === CLAIM_KIND.KONG) {
    const uk = calculateUkeire(afterCounts, { ...afterOpts, visibleCounts: _clampSeen(seen, afterCounts) });
    after = { shanten: uk.shanten, ukeire: uk.total, discardIndex: null };
  } else {
    const choice = chooseEfficientDiscard(afterCounts, {
      ...afterOpts,
      visibleCounts: _clampSeen(seen, afterCounts),
      ...(valuableHonorIndices ? { valuableHonorIndices } : {}),
    });
    after = { shanten: choice.shanten, ukeire: choice.ukeire, discardIndex: choice.discardIndex };
  }

  const isValuableHonor =
    (claim.kind === CLAIM_KIND.PON || claim.kind === CLAIM_KIND.KONG) && valuable.has(claim.tileIndex);
  const concealedNow = meldCount === 0;

  let accept; let reason;
  if (after.shanten > before.shanten) {
    accept = false; reason = CLAIM_REASON.LOSES_PROGRESS;
  } else if (preferConcealed && concealedNow && before.shanten <= 1 && !isValuableHonor) {
    accept = false; reason = CLAIM_REASON.KEEP_CONCEALED;
  } else if (after.shanten < before.shanten) {
    accept = true; reason = CLAIM_REASON.PROGRESS;
  } else if (isValuableHonor) {
    accept = true; reason = CLAIM_REASON.VALUABLE_HONOR;
  } else if (claim.kind === CLAIM_KIND.KONG) {
    accept = true; reason = CLAIM_REASON.KONG_NO_LOSS;
  } else {
    accept = false; reason = CLAIM_REASON.NO_PROGRESS;
  }

  return { accept, reason, before, after };
}

/**
 * Seen counts can't exceed 4 − held for the evaluator's validation; a stale
 * or over-reported visibleCounts entry is clamped rather than thrown on.
 * @private
 */
function _clampSeen(seen, handCounts) {
  return seen.map((v, i) => Math.max(0, Math.min(v, 4 - handCounts[i])));
}

/**
 * Evaluates every legal claim on one discard and picks the best accepted
 * one, or returns `null` to PASS.
 *
 * Best = lowest after.shanten → most after.ukeire → valuable-honour claims
 * first → Kong > Pon > Chi → input order. A rejected claim is never chosen.
 *
 * @param {number[]} counts  waiting hand
 * @param {Object[]} claims  candidate claims for the same discard
 * @param {Object} [options] same as evaluateClaim
 * @returns {{ claim: Object, evaluation: Object, evaluations: {claim: Object, evaluation: Object}[] } | null}
 *   `evaluations` lists every claim's evaluation (accepted or not), in input order.
 */
export function chooseBestClaim(counts, claims, options = {}) {
  if (!Array.isArray(claims)) {
    throw new TypeError('[AdvancedStrategy] chooseBestClaim requires an array of claims.');
  }
  const evaluations = claims.map((claim) => ({ claim, evaluation: evaluateClaim(counts, claim, options) }));
  const accepted = evaluations
    .map((e, order) => ({ ...e, order }))
    .filter((e) => e.evaluation.accept);
  if (accepted.length === 0) return null;

  const valuableFirst = (e) => (e.evaluation.reason === CLAIM_REASON.VALUABLE_HONOR ? 0 : 1);
  accepted.sort(
    (a, b) =>
      a.evaluation.after.shanten - b.evaluation.after.shanten ||
      b.evaluation.after.ukeire - a.evaluation.after.ukeire ||
      valuableFirst(a) - valuableFirst(b) ||
      KIND_PRIORITY[a.claim.kind] - KIND_PRIORITY[b.claim.kind] ||
      a.order - b.order
  );
  const best = accepted[0];
  return { claim: best.claim, evaluation: best.evaluation, evaluations };
}

// ===========================================================================
// Defensive override (Task 77)
// ===========================================================================

/** Which policy produced a defensive discard. */
export const DISCARD_MODE = Object.freeze({
  PUSH:    'push',     // low threat: pure efficiency (danger only breaks exact ties)
  BALANCE: 'balance',  // real threat, hand still worth playing: trade a little speed for safety
  FOLD:    'fold',     // high threat, hand far from winning: safest tile, efficiency only breaks ties
});

/**
 * Tunable thresholds for chooseDefensiveDiscard(). Override any subset via
 * `options.defense`. `threat` below is the HIGHEST threat among opponents
 * (DefensivePlayEvaluator.assessOpponentThreat).
 */
export const DEFAULT_DEFENSE_SETTINGS = Object.freeze({
  // Thresholds from Task 77's simplified simulation: stricter settings (fold
  // at 0.5 / shanten 2) cut deal-ins but gave up more wins than they saved;
  // re-checked on the real engine at Task 80b (folding at shanten ≥ 2 or
  // threat 0.5–0.6 still costs wins), so they are unchanged.
  pushBelowThreat: 0.25,   // threat under this → PUSH
  foldAtThreat: 0.7,       // threat at/over this AND best shanten ≥ foldMinShanten → FOLD
  foldMinShanten: 3,
  // BALANCE: cost = danger − progressWeight × progress, lowest cost wins, where
  //   progress = ukeire / bestUkeire when the best shanten is kept,
  //            = −shantenLossPenalty × (shanten − bestShanten) otherwise.
  // Task 80b: raised from 1 / 3. `danger` is an ordering score (mean ≈ 0.4),
  // while real Hong Kong deal-in rates are ≈ 0.3–0.8% per discard, so the old
  // weights traded speed for safety ~50× too eagerly (−5.7 points per hand
  // vs no defence on the tuning walls).
  progressWeight: 10,
  tenpaiProgressWeight: 30,  // used instead when the hand is (or can stay) tenpai
  shantenLossPenalty: 1,
});

/** @private */
function _resolveDefense(defense) {
  if (defense === undefined) return DEFAULT_DEFENSE_SETTINGS;
  if (defense === null || typeof defense !== 'object') {
    throw new TypeError('[AdvancedStrategy] options.defense must be an object when supplied.');
  }
  for (const [key, v] of Object.entries(defense)) {
    if (!(key in DEFAULT_DEFENSE_SETTINGS)) throw new TypeError(`[AdvancedStrategy] unknown defense setting "${key}".`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new TypeError(`[AdvancedStrategy] defense setting "${key}" must be a non-negative finite number.`);
    }
  }
  return { ...DEFAULT_DEFENSE_SETTINGS, ...defense };
}

/**
 * Chooses a discard balancing hand progress against the risk of dealing in.
 *
 * Steps:
 *   1. Efficiency ranking — chooseEfficientDiscard(counts, options).
 *   2. Danger — DefensivePlayEvaluator.assessDanger() for every kind, against
 *      `table.opponents`; `threat` = highest opponent threat.
 *   3. Mode:
 *      - PUSH    when threat < pushBelowThreat: efficiency order exactly as
 *                Task 74, except an exact efficiency tie (same shanten, ukeire
 *                AND keep-value) goes to the less dangerous tile.
 *      - FOLD    when threat ≥ foldAtThreat and the best reachable shanten is
 *                ≥ foldMinShanten (the hand is unlikely to win in time):
 *                lowest danger first; efficiency order breaks ties.
 *      - BALANCE otherwise: lowest  cost = danger − w × progress, where
 *                  progress = ukeire/bestUkeire when the discard keeps the best
 *                  shanten, else −shantenLossPenalty × shanten steps lost
 *                  (ukeire isn't comparable across shanten levels)
 *                with w = tenpaiProgressWeight when the best discard keeps
 *                tenpai, else progressWeight. So a tenpai hand only gives up
 *                its wait for a much safer tile, and a 1-shanten hand will
 *                step back once the danger gap is big enough.
 *
 * `table` mirrors DefensivePlayEvaluator.assessDanger's state minus the hand:
 *   { visibleCounts: number[34], opponents: [{ discards, melds, declaredTenpai? }] }
 * Use the same visibleCounts for both efficiency and danger (it's passed to
 * the evaluator as `visibleCounts` unless `options.visibleCounts` is given).
 *
 * @param {number[]} counts  drawn hand (14 − 3m)
 * @param {{ visibleCounts: number[], opponents: Object[] }} table
 * @param {Object} [options] chooseEfficientDiscard options plus
 *   `furiten` (bool), `dangerWeights` (DefensivePlayEvaluator weights), `defense` (overrides)
 * @returns {{
 *   discardIndex: number, mode: string, shanten: number, ukeire: number,
 *   danger: number, threat: number,
 *   candidates: { discardIndex: number, shanten: number, ukeire: number, keepValue: number, danger: number, cost: number|null }[]
 * }}
 */
export function chooseDefensiveDiscard(counts, table, options = {}) {
  if (table === null || typeof table !== 'object') {
    throw new TypeError('[AdvancedStrategy] chooseDefensiveDiscard requires a table object ({ visibleCounts, opponents }).');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('[AdvancedStrategy] chooseDefensiveDiscard options must be an object.');
  }
  const { furiten, dangerWeights, defense, ...efficiencyOptions } = options;
  const settings = _resolveDefense(defense);

  const visibleCounts = efficiencyOptions.visibleCounts ?? table.visibleCounts;
  const efficiency = chooseEfficientDiscard(counts, { ...efficiencyOptions, ...(visibleCounts ? { visibleCounts } : {}) });

  const assessment = assessDanger(
    { handCounts: counts, visibleCounts: table.visibleCounts, opponents: table.opponents },
    { ...(furiten !== undefined ? { furiten } : {}), ...(dangerWeights ? { weights: dangerWeights } : {}) }
  );
  const threat = assessment.perOpponent.reduce((m, o) => Math.max(m, o.threat), 0);

  const best = efficiency.candidates[0];
  const bestUkeire = Math.max(1, best.ukeire);
  const candidates = efficiency.candidates.map((c, rank) => ({
    discardIndex: c.discardIndex,
    shanten: c.shanten,
    ukeire: c.ukeire,
    keepValue: c.keepValue,
    danger: assessment.combined[c.discardIndex],
    cost: null,
    _rank: rank, // efficiency order, for tie-breaks
  }));

  let mode;
  if (threat < settings.pushBelowThreat) {
    mode = DISCARD_MODE.PUSH;
    candidates.sort(
      (a, b) =>
        a.shanten - b.shanten ||
        b.ukeire - a.ukeire ||
        a.keepValue - b.keepValue ||
        a.danger - b.danger ||
        a._rank - b._rank
    );
  } else if (threat >= settings.foldAtThreat && best.shanten >= settings.foldMinShanten) {
    mode = DISCARD_MODE.FOLD;
    candidates.sort((a, b) => a.danger - b.danger || a._rank - b._rank);
  } else {
    mode = DISCARD_MODE.BALANCE;
    const w = best.shanten === 0 ? settings.tenpaiProgressWeight : settings.progressWeight;
    for (const c of candidates) {
      // Ukeire is only comparable between hands at the SAME shanten (a
      // 1-shanten hand naturally accepts far more tiles than a tenpai one),
      // so the ukeire ratio only counts when no shanten is lost; any step
      // back costs the full shantenLossPenalty per step instead.
      const loss = c.shanten - best.shanten;
      const progress = loss === 0 ? c.ukeire / bestUkeire : -settings.shantenLossPenalty * loss;
      c.cost = c.danger - w * progress;
    }
    candidates.sort((a, b) => a.cost - b.cost || a._rank - b._rank);
  }

  for (const c of candidates) delete c._rank;
  const chosen = candidates[0];
  return {
    discardIndex: chosen.discardIndex,
    mode,
    shanten: chosen.shanten,
    ukeire: chosen.ukeire,
    danger: chosen.danger,
    threat,
    candidates,
  };
}

/**
 * Tile-object version of chooseDefensiveDiscard() — same last-copy rule as
 * selectDiscardTile().
 * @param {Array<*>} tiles
 * @param {function(*): (number|null|undefined)} tileToIndex
 * @param {{ visibleCounts: number[], opponents: Object[] }} table
 * @param {Object} [options]
 * @returns {{ tile: *, discardIndex: number, mode: string, shanten: number, ukeire: number, danger: number, threat: number, candidates: Object[] }}
 */
export function selectDefensiveDiscardTile(tiles, tileToIndex, table, options = {}) {
  if (!Array.isArray(tiles)) {
    throw new TypeError('[AdvancedStrategy] selectDefensiveDiscardTile requires an array of tiles.');
  }
  const counts = countsFromTiles(tiles, tileToIndex);
  const result = chooseDefensiveDiscard(counts, table, options);
  for (let i = tiles.length - 1; i >= 0; i--) {
    if (tileToIndex(tiles[i]) === result.discardIndex) return { tile: tiles[i], ...result };
  }
  throw new Error('[AdvancedStrategy] selectDefensiveDiscardTile: chosen kind not found among tiles.');
}

// ===========================================================================
// AdvancedStrategy class (Task 78)
// ===========================================================================

const SUIT_OFFSET = Object.freeze({ [SUIT.DOTS]: 0, [SUIT.BAMBOO]: 9, [SUIT.CHARACTERS]: 18 });
const WIND_INDEX = Object.freeze(Object.fromEntries(WIND_ORDER.map((w, i) => [w.id, HONOR_START + i])));
const DRAGON_INDEX = Object.freeze(Object.fromEntries(DRAGON_ORDER.map((d, i) => [d, HONOR_START + 4 + i])));

/**
 * Maps a real Tile to its kind index for the Task 73–77 evaluators:
 * Dots 0–8, Bamboo 9–17, Characters 18–26, winds E S W N 27–30, dragons
 * red/green/white 31–33. Bonus tiles (flowers/seasons) → null.
 * @param {import('../../core/Tile.js').Tile} tile
 * @returns {number|null}
 */
export function tileToKindIndex(tile) {
  if (!tile || typeof tile.suit !== 'string') throw new TypeError('[AdvancedStrategy] tileToKindIndex requires a Tile.');
  if (tile.suit in SUIT_OFFSET) return SUIT_OFFSET[tile.suit] + tile.value - 1;
  if (tile.suit === SUIT.WIND) return WIND_INDEX[tile.value];
  if (tile.suit === SUIT.DRAGON) return DRAGON_INDEX[tile.value];
  return null;
}

/** Kind index of a face id ('dots-5', 'wind-east'). */
export function faceIdToKindIndex(faceId) {
  const dash = faceId.indexOf('-');
  const suit = faceId.slice(0, dash);
  const raw = faceId.slice(dash + 1);
  if (suit in SUIT_OFFSET) return SUIT_OFFSET[suit] + Number(raw) - 1;
  if (suit === SUIT.WIND) return WIND_INDEX[raw];
  if (suit === SUIT.DRAGON) return DRAGON_INDEX[raw];
  return null;
}

/**
 * Reads what this seat can see from GameManager's AI context.
 *   visibleCounts — every face-up copy NOT in this hand: all discard piles
 *     (incl. its own) + every exposed meld (incl. its own), each physical tile
 *     counted once (a claimed discard is in both a pile and a meld); clamped
 *     to 4 − copies held.
 *   opponents — per other seat: discard kinds and exposed meld kinds.
 *   valuableHonorIndices — the three dragons plus this seat's wind and the
 *     prevailing wind (Hong Kong scores fan for those pungs).
 * @param {import('../../core/PlayerManager.js').PlayerManager} player
 * @param {Object} context  GameManager AI context ({ table, seatWind, roundWind, … })
 * @param {{ excludeTile?: import('../../core/Tile.js').Tile }} [options]
 *   excludeTile — leave one physical tile out of visibleCounts (the discard
 *   being claimed; evaluateClaim adds it back itself).
 */
/**
 * Task 80b: threat multipliers for opponents whose exposed melds show they
 * are unlikely to win off a discard under a minimum-fan rule (Hong Kong).
 * Measured on real games (Task 80 harness, tuning seeds 7900+): opponents
 * with no exposed melds Ron ≈0.02% of discards, opponents whose exposed melds
 * cap the hand below the minimum 0 of ~4,000, opponents whose melds still
 * allow the minimum ≈0.4%.
 */
export const DEFAULT_THREAT_VALUE_SCALE = Object.freeze({
  concealed: 0.1,     // no exposed melds: needs the whole minimum from a hidden shape
  belowMinimum: 0.05, // exposed melds rule out every route to the minimum
});

/**
 * Fan an opponent's exposed melds can still lead to (Hong Kong): visible
 * dragon / seat-wind / prevailing-wind Pungs (1 each, a double wind 2) plus
 * the best open route still possible — one-suit flush (+3, all suited melds
 * in one suit) or all Pungs (+3, no Chi). Concealed Kongs count as Pungs.
 * @param {number[][]} meldKinds   each meld's tile kinds
 * @param {boolean[]} meldIsChi
 * @param {number|null} seatWindIndex
 * @param {number|null} roundWindIndex
 * @returns {number}
 */
export function visibleFanPotential(meldKinds, meldIsChi, seatWindIndex, roundWindIndex) {
  let honor = 0; let chi = false; const suits = new Set();
  meldKinds.forEach((kinds, i) => {
    const k = kinds[0];
    if (meldIsChi[i]) chi = true;
    if (k < HONOR_START) { suits.add(Math.floor(k / 9)); return; }
    if (meldIsChi[i]) return;
    if (k >= HONOR_START + 4) honor += 1;
    if (k === seatWindIndex) honor += 1;
    if (k === roundWindIndex) honor += 1;
  });
  const flush = suits.size <= 1 ? 3 : 0;
  const pungs = chi ? 0 : 3;
  return honor + Math.max(flush, pungs);
}

export function readTable(player, context = {}, { excludeTile = null, threatValueScale = DEFAULT_THREAT_VALUE_SCALE } = {}) {
  const handCounts = countsFromTiles(player.getHand().concealedTiles, tileToKindIndex);
  const visible = new Array(TILE_KIND_COUNT).fill(0);
  const seen = new Set();
  const addTile = (t) => {
    if (!t || seen.has(t.instanceId) || (excludeTile && t.instanceId === excludeTile.instanceId)) return;
    seen.add(t.instanceId);
    const k = tileToKindIndex(t);
    if (k !== null) visible[k] += 1;
  };
  const table = context.table ?? { discards: [], melds: [] };
  (table.discards ?? []).forEach((pile) => (pile ?? []).forEach(addTile));
  (table.melds ?? []).forEach((melds) => (melds ?? []).forEach((m) => m.tiles.forEach(addTile)));
  for (let i = 0; i < TILE_KIND_COUNT; i++) visible[i] = Math.max(0, Math.min(visible[i], 4 - handCounts[i]));

  const opponents = [];
  const seatCount = (table.discards ?? []).length;
  // Task 80b: value-aware threat scaling needs a minimum fan (Hong Kong) and
  // the seat winds (from dealerIndex); otherwise opponents are unscaled.
  const minimumFan = typeof context.ruleEngine?.getMinimumFan === 'function' ? context.ruleEngine.getMinimumFan() : 0;
  const canScale = threatValueScale && minimumFan > 0 && Number.isInteger(context.dealerIndex) && seatCount > 0;
  const roundWindIndex = context.roundWind ? WIND_INDEX[context.roundWind.id] : null;
  for (let s = 0; s < seatCount; s++) {
    if (s === player.seatIndex) continue;
    const allMelds = table.melds?.[s] ?? [];
    const exposed = allMelds.filter((m) => !m.concealed);
    const opp = {
      discards: (table.discards[s] ?? []).map(tileToKindIndex).filter((k) => k !== null),
      melds: exposed.map((m) => m.tiles.map(tileToKindIndex)),
    };
    // Task 90: a seat in riichi has declared tenpai (threat 1).
    if (Array.isArray(table.riichiSeats) && table.riichiSeats.includes(s)) opp.declaredTenpai = true;
    else if (canScale) {
      if (exposed.length === 0) opp.threatScale = threatValueScale.concealed;
      else {
        const seatWind = WIND_ORDER[(s - context.dealerIndex + seatCount) % seatCount];
        const pot = visibleFanPotential(allMelds.map((m) => m.tiles.map(tileToKindIndex)), allMelds.map((m) => m.type === MELD_TYPE.CHI), WIND_INDEX[seatWind.id], roundWindIndex);
        if (pot < minimumFan) opp.threatScale = threatValueScale.belowMinimum;
      }
    }
    opponents.push(opp);
  }

  const valuable = new Set([DRAGON_INDEX.red, DRAGON_INDEX.green, DRAGON_INDEX.white]);
  const seatWind = context.seatWind ?? player.seatWind;
  if (seatWind) valuable.add(WIND_INDEX[seatWind.id]);
  if (context.roundWind) valuable.add(WIND_INDEX[context.roundWind.id]);

  return { handCounts, visibleCounts: visible, opponents, valuableHonorIndices: [...valuable].sort((a, b) => a - b) };
}

/** @private — shape options the rule engine allows (HK: Thirteen Orphans always; Seven Pairs if enabled). */
function _shapeOptions(context) {
  const rules = context.ruleEngine;
  const opts = typeof rules?.getOptions === 'function' ? rules.getOptions() : {};
  return { allowThirteenOrphans: true, allowSevenPairs: opts.allowSevenPairs === true };
}

/** Task 116: exported for the hint advisor (src/ai/HintAdvisor.js). */
export function shapeOptionsFor(context) { return _shapeOptions(context); }
export function meldDescriptorsOf(melds) { return _meldDescriptors(melds); }

/** @private — meld descriptors for HandValuePlanner. */
function _meldDescriptors(melds) {
  return melds.map((m) => ({
    type: m.type === MELD_TYPE.CHI ? 'chi' : m.type === MELD_TYPE.PON ? 'pon' : 'kong',
    kinds: m.tiles.map(tileToKindIndex),
    concealed: m.concealed === true,
  }));
}

/**
 * The Advanced AI tier: efficient discards with a push/balance/fold defence
 * layer (Tasks 73–77), efficiency-aware claims (Task 75), Basic's
 * minimum-fan-aware win declaration (Task 39) — and, from Task 78b, HAND-VALUE
 * awareness: every discard, claim and self-Kong is judged by VALUE SHANTEN
 * (HandValuePlanner — distance to a hand that reaches the rule engine's
 * minimum fan), and every tenpai candidate is checked against the REAL rule
 * engine: a wait that can be won by discard counts as tenpai (value 0), one
 * that only a self-draw can win counts as 0.5, and a wait that can never
 * reach the minimum counts as not tenpai at all.
 *
 * Every evaluator call is guarded: if a hand ever reaches an unexpected
 * shape (an engine edge case), the decision falls back to BasicStrategy for
 * that one call instead of crashing the game, and `getFallbackCount()` goes up.
 */
export class AdvancedStrategy extends AIStrategyInterface {
  /**
   * @param {Object} [options]
   * @param {function(): number} [options.random=Math.random]  only used by fallbacks
   * @param {Object} [options.defense]  overrides for DEFAULT_DEFENSE_SETTINGS
   * @param {Object} [options.dangerWeights]  overrides for DefensivePlayEvaluator.DEFAULT_DANGER_WEIGHTS (Task 80b)
   * @param {Object|false} [options.threatValueScale=DEFAULT_THREAT_VALUE_SCALE]  Task 80b value-aware
   *   threat ({concealed, belowMinimum} in [0, 1]); false = unscaled Task 77 threat
   * @param {boolean} [options.useDefense=true]  false = efficiency only (no push/fold layer)
   * @param {boolean} [options.useValue=true]    false = Task 78 behaviour (fan-blind)
   * @param {boolean} [options.preferConcealed=false]  passed to claim evaluation
   */
  constructor({ random = Math.random, defense, dangerWeights, threatValueScale = DEFAULT_THREAT_VALUE_SCALE, useDefense = true, useValue = true, preferConcealed = false } = {}) {
    super(AI_DIFFICULTY.ADVANCED);
    this._basic = new BasicStrategy({ random });
    this._defense = defense;
    this._dangerWeights = dangerWeights;
    if (threatValueScale !== null && threatValueScale !== false) {
      for (const k of Object.keys(DEFAULT_THREAT_VALUE_SCALE)) {
        const v = threatValueScale?.[k];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new TypeError(`[AdvancedStrategy] threatValueScale.${k} must be a number in [0, 1].`);
      }
    }
    /** null/false = Task 77 threat (no value scaling). */
    this._threatValueScale = threatValueScale === false ? null : threatValueScale;
    this._useDefense = useDefense !== false;
    this._useValue = useValue !== false;
    this._preferConcealed = preferConcealed === true;
    this._fallbacks = 0;
    /** Mode of the latest discard decision ('push' | 'balance' | 'fold' | 'efficient' | 'fallback'). */
    this.lastDiscardMode = null;
    /** Value shanten of the hand kept by the latest discard (Task 78b diagnostics). */
    this.lastValueShanten = null;
    /** Task 116: the latest discard decision in full ({ mode, discardIndex, threat, candidates[] }) — what hints explain. */
    this.lastDecision = null;
  }

  /** How many decisions fell back to BasicStrategy. */
  getFallbackCount() { return this._fallbacks; }

  // -------------------------------------------------------------------------
  // Value layer (Task 78b)
  // -------------------------------------------------------------------------

  /** @private */
  _valueOptions(player, context) {
    // Task 90: Riichi needs one yaku — its value routes map onto Riichi's main
    // ways to get one (closed hand → Riichi, honour Pung → Yakuhai, flush →
    // Honitsu, all Pungs → Toitoi), so plan for a 1-han minimum there.
    const minimumFan = typeof context.ruleEngine?.getMinimumFan === 'function' ? context.ruleEngine.getMinimumFan() : (isRiichiContext(context) ? 1 : 0);
    const seatWind = context.seatWind ?? player.seatWind;
    return {
      minimumFan,
      seatWindIndex: seatWind ? WIND_INDEX[seatWind.id] : null,
      roundWindIndex: context.roundWind ? WIND_INDEX[context.roundWind.id] : null,
    };
  }

  /**
   * Value of a WAITING hand (13 − 3m concealed tiles).
   * @private
   * @param {number[]} counts       its kind counts
   * @param {Object[]} meldDesc     planner meld descriptors
   * @param {import('../../core/Hand.js').Hand} hand  the same hand as real tiles (for scoring)
   * @returns {{ vs: number, ukeire: number|null }}  ukeire = winning live copies at tenpai, else null
   */
  _valueOfWaitingHand(counts, meldDesc, hand, player, context, visible) {
    // Task 98: Chinese Official plans for its 8-point minimum with its own routes.
    if (isChineseOfficialContext(context)) return this._mcrValueOfWaitingHand(counts, meldDesc, hand, player, context, visible);
    const opts = this._valueOptions(player, context);
    const shape = _shapeOptions(context);
    const meldCount = meldDesc.length;
    let vs = analyzeValueRoutes(counts, meldDesc, opts).valueShanten;
    const plain = _calculateShanten(counts, { meldCount, ...shape });
    if (plain !== 0) return { vs: Math.max(vs, plain), ukeire: null };

    // Tenpai: ask the real rule engine which waits can actually be declared.
    const rules = context.ruleEngine;
    if (!rules || typeof rules.scoreHand !== 'function') return { vs: 0, ukeire: null };
    let ronLive = 0; let tsumoLive = 0;
    for (let w = 0; w < TILE_KIND_COUNT; w++) {
      if (counts[w] >= 4) continue;
      const c = counts.slice(); c[w]++;
      if (_calculateShanten(c, { meldCount, ...shape }) !== -1) continue;
      const live = Math.max(0, 4 - counts[w] - (visible?.[w] ?? 0));
      const probe = Tile.fromId(STANDARD_FACE_IDS[w], `${STANDARD_FACE_IDS[w]}#probe`);
      const view = hand.clone();
      view.addConcealedTile(probe);
      const base = {
        winningTile: probe, seatWind: context.seatWind ?? player.seatWind, roundWind: context.roundWind, isLastTile: false,
        // Task 90: a closed Riichi hand can always declare riichi for its yaku.
        ...(isRiichiContext(context) && hand.melds.every((m) => m.concealed === true) ? { isRiichi: true } : {}),
      };
      if (rules.scoreHand(view, { ...base, winType: WIN_SOURCE.DISCARD }).meetsMinimum) ronLive += live;
      else if (rules.scoreHand(view, { ...base, winType: WIN_SOURCE.SELF }).meetsMinimum) tsumoLive += live;
    }
    if (ronLive > 0) return { vs: 0, ukeire: ronLive + tsumoLive };
    if (tsumoLive > 0) return { vs: 0.5, ukeire: tsumoLive };
    return { vs: Math.max(vs, 1), ukeire: null }; // dead tenpai: no wait reaches the minimum
  }

  /**
   * Task 98 — Chinese Official: value shanten from ChineseOfficialAIHelpers'
   * MCR routes (8-point minimum, flowers never counted); at tenpai the waits
   * come from every MCR shape (Seven Pairs, Honors and Knitted, Knitted
   * Straight, Thirteen Orphans included) and each is checked with the real
   * rule engine, exactly like the Hong Kong / Riichi path.
   * @private
   */
  _mcrValueOfWaitingHand(counts, meldDesc, hand, player, context, visible) {
    const roles = this._valueOptions(player, context);
    const meldCount = meldDesc.length;
    const vs = analyzeMcrRoutes(counts, meldDesc, roles).valueShanten;
    const total = counts.reduce((a, b) => a + b, 0);
    if (total !== 13 - 3 * meldCount) return { vs, ukeire: null };
    const waits = mcrWaitKinds(counts, meldCount);
    if (waits.length === 0) return { vs: Math.max(vs, 1), ukeire: null };
    const rules = context.ruleEngine;
    let ronLive = 0; let tsumoLive = 0;
    for (const w of waits) {
      const live = Math.max(0, 4 - counts[w] - (visible?.[w] ?? 0));
      const probe = Tile.fromId(STANDARD_FACE_IDS[w], `${STANDARD_FACE_IDS[w]}#probe`);
      const view = hand.clone();
      view.addConcealedTile(probe);
      const base = { winningTile: probe, seatWind: context.seatWind ?? player.seatWind, roundWind: context.roundWind, isLastTile: false };
      if (rules.scoreHand(view, { ...base, winType: WIN_SOURCE.DISCARD }).meetsMinimum) ronLive += live;
      else if (rules.scoreHand(view, { ...base, winType: WIN_SOURCE.SELF }).meetsMinimum) tsumoLive += live;
    }
    if (ronLive > 0) return { vs: 0, ukeire: ronLive + tsumoLive };
    if (tsumoLive > 0) return { vs: 0.5, ukeire: tsumoLive };
    return { vs: Math.max(vs, 1), ukeire: null };
  }

  /**
   * Value shanten / ukeire after each possible discard from a DRAWN hand.
   * @private
   * @returns {{ valueShanten: number[], valueUkeire: number[] }}
   */
  _discardValueArrays(player, context, view, handOverride = null, meldDescOverride = null) {
    const hand = handOverride ?? player.getHand();
    const counts = handOverride ? countsFromTiles(hand.concealedTiles, tileToKindIndex) : view.handCounts;
    const meldDesc = meldDescOverride ?? _meldDescriptors(hand.melds);
    const valueShanten = new Array(TILE_KIND_COUNT).fill(undefined);
    const valueUkeire = new Array(TILE_KIND_COUNT).fill(undefined);
    for (let k = 0; k < TILE_KIND_COUNT; k++) {
      if (counts[k] === 0) continue;
      const c = counts.slice(); c[k]--;
      const waiting = hand.clone();
      waiting.removeConcealedByFace(STANDARD_FACE_IDS[k], 1);
      const v = this._valueOfWaitingHand(c, meldDesc, waiting, player, context, view.visibleCounts);
      valueShanten[k] = v.vs;
      if (v.ukeire !== null) valueUkeire[k] = v.ukeire;
    }
    return { valueShanten, valueUkeire };
  }

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------

  chooseDiscard(player, context = {}) {
    // Task 90: respect the rule engine's allowed discards (riichi lock: one tile).
    const allowed = Array.isArray(context.allowedDiscards) && context.allowedDiscards.length ? context.allowedDiscards : null;
    if (allowed && allowed.length === 1) { this.lastDiscardMode = 'forced'; this.lastDecision = { mode: 'forced', candidates: [] }; return allowed[0]; }
    const pick = this._chooseDiscardUnrestricted(player, context);
    if (!allowed || allowed.some((t) => t.instanceId === pick.tile.instanceId)) return pick.tile;
    // Best-ranked kind that is allowed (candidates are in the selector's order).
    for (const c of pick.candidates ?? []) {
      const t = allowed.filter((x) => tileToKindIndex(x) === c.discardIndex).pop();
      if (t) return t;
    }
    return allowed[allowed.length - 1];
  }

  /** Task 90 — Riichi: declare on the discard leaving the most live waits (at least 2). */
  chooseRiichi(player, riichiAction, context = {}) {
    return chooseRiichiDeclaration(player, riichiAction, context, { minLive: 2 })
      ?? chooseRiichiDeclaration(player, riichiAction, context, { minLive: 1 });
  }

  /** Task 90 — nine terminals: redeal unless Thirteen Orphans looks realistic (11+ kinds). */
  chooseAbortiveDraw(player) {
    return distinctTerminalHonorKinds(player.getHand().concealedTiles) < 11;
  }

  /** @private — the pre-Task-90 discard choice; returns { tile, candidates }. */
  _chooseDiscardUnrestricted(player, context = {}) {
    try {
      const view = readTable(player, context, { threatValueScale: this._threatValueScale });
      const meldCount = player.getHand().meldCount;
      const tiles = player.getHand().concealedTiles;
      const shape = _shapeOptions(context);
      const value = this._useValue ? this._discardValueArrays(player, context, view) : {};
      const common = { meldCount, ...shape, valuableHonorIndices: view.valuableHonorIndices, ...value };
      let r;
      if (this._useDefense) {
        r = selectDefensiveDiscardTile(tiles, tileToKindIndex, { visibleCounts: view.visibleCounts, opponents: view.opponents }, {
          ...common, ...(this._defense ? { defense: this._defense } : {}), ...(this._dangerWeights ? { dangerWeights: this._dangerWeights } : {}),
        });
        this.lastDiscardMode = r.mode;
      } else {
        r = selectDiscardTile(tiles, tileToKindIndex, { ...common, visibleCounts: view.visibleCounts });
        this.lastDiscardMode = 'efficient';
      }
      this.lastValueShanten = value.valueShanten ? value.valueShanten[r.discardIndex] : r.shanten;
      this.lastDecision = { mode: this.lastDiscardMode, discardIndex: r.discardIndex, threat: r.threat ?? 0, candidates: r.candidates ?? [] };
      return { tile: r.tile, candidates: r.candidates };
    } catch (error) {
      this._fallbacks++;
      this.lastDiscardMode = 'fallback';
      this.lastDecision = { mode: 'fallback', candidates: [] };
      return { tile: this._basic.chooseDiscard(player, context), candidates: [] };
    }
  }

  chooseClaim(player, actions, context = {}) {
    if (!Array.isArray(actions) || actions.length === 0) return { type: ACTION_TYPE.PASS };
    try {
      const selfKongs = actions.filter((a) => a.type === ACTION_TYPE.KONG && (a.kongType === KONG_TYPE.CONCEALED || a.kongType === KONG_TYPE.ADDED));
      if (selfKongs.length === actions.length) return this._chooseSelfKong(player, selfKongs, context);

      const claimable = actions.filter((a) => [ACTION_TYPE.CHI, ACTION_TYPE.PON, ACTION_TYPE.KONG].includes(a.type));
      if (claimable.length === 0) return { type: ACTION_TYPE.PASS };
      const discardTile = claimable[0].tile;
      const view = readTable(player, context, { excludeTile: discardTile, threatValueScale: this._threatValueScale });
      const claims = claimable.map((a) => ({
        kind: a.type === ACTION_TYPE.CHI ? CLAIM_KIND.CHI : a.type === ACTION_TYPE.PON ? CLAIM_KIND.PON : CLAIM_KIND.KONG,
        tileIndex: tileToKindIndex(a.tile),
        ...(a.type === ACTION_TYPE.CHI ? { sequence: a.sequence.map(faceIdToKindIndex) } : {}),
      }));
      const claimOptions = {
        meldCount: player.getHand().meldCount,
        visibleCounts: view.visibleCounts,
        valuableHonorIndices: view.valuableHonorIndices,
        preferConcealed: this._preferConcealed,
        ..._shapeOptions(context),
      };
      if (!this._useValue) {
        const best = chooseBestClaim(view.handCounts, claims, claimOptions);
        return best ? claimable[claims.indexOf(best.claim)] : { type: ACTION_TYPE.PASS };
      }
      return this._chooseValueClaim(player, claimable, claims, claimOptions, view, context);
    } catch (error) {
      this._fallbacks++;
      return this._basic.chooseClaim(player, actions, context);
    }
  }

  /**
   * Task 78b claim rule: claim only when it brings the hand closer to a
   * DECLARABLE hand (lower value shanten), or keeps that distance while
   * adding fan (a valuable honour Pon/Kong) or a free Kong draw — and never
   * when it loses plain progress.
   * @private
   */
  _chooseValueClaim(player, claimable, claims, claimOptions, view, context) {
    const hand = player.getHand();
    const meldDesc = _meldDescriptors(hand.melds);
    const before = this._valueOfWaitingHand(view.handCounts, meldDesc, hand.clone(), player, context, view.visibleCounts).vs;
    const roles = this._valueOptions(player, context);
    let best = null;
    claimable.forEach((action, i) => {
      const plain = evaluateClaim(view.handCounts, claims[i], claimOptions);
      if (plain.reason === CLAIM_REASON.LOSES_PROGRESS) return;
      // Build the post-claim hand with real tiles.
      const after = hand.clone();
      const used = action.handTiles.map((t) => after.removeConcealedTile(t));
      const type = action.type === ACTION_TYPE.CHI ? MELD_TYPE.CHI : action.type === ACTION_TYPE.PON ? MELD_TYPE.PON : MELD_TYPE.KONG;
      after.addMeld(new Meld({ type, tiles: [...used, action.tile], calledFrom: action.fromSeat ?? null, calledTile: action.tile, kongType: type === MELD_TYPE.KONG ? KONG_TYPE.EXPOSED : null }));
      const afterDesc = _meldDescriptors(after.melds);
      let vs;
      if (type === MELD_TYPE.KONG) {
        const c = countsFromTiles(after.concealedTiles, tileToKindIndex);
        vs = this._valueOfWaitingHand(c, afterDesc, after, player, context, view.visibleCounts).vs;
      } else {
        const arr = this._discardValueArrays(player, context, view, after, afterDesc).valueShanten;
        vs = Math.min(...arr.filter((x) => typeof x === 'number'));
      }
      const fanGain = type !== MELD_TYPE.CHI ? honorPungFan(claims[i].tileIndex, roles) : 0;
      const ok = vs < before || (vs === before && (fanGain > 0 || type === MELD_TYPE.KONG));
      if (!ok) return;
      const cand = { action, vs, plainAfter: plain.after.shanten, fanGain };
      if (!best || cand.vs < best.vs || (cand.vs === best.vs && (cand.fanGain > best.fanGain || (cand.fanGain === best.fanGain && cand.plainAfter < best.plainAfter)))) best = cand;
    });
    return best ? best.action : { type: ACTION_TYPE.PASS };
  }

  /**
   * Concealed / added Kong on own turn: declare it when the hand is no
   * further from winning afterwards (by value shanten when the value layer is
   * on) than with its best ordinary discard — a Kong also brings a free draw.
   * @private
   */
  _chooseSelfKong(player, kongs, context) {
    const view = readTable(player, context, { threatValueScale: this._threatValueScale });
    const hand = player.getHand();
    const meldCount = hand.meldCount;
    const shape = _shapeOptions(context);
    if (!this._useValue) {
      const baseline = chooseEfficientDiscard(view.handCounts, { meldCount, ...shape }).shanten;
      for (const k of kongs) {
        const counts = view.handCounts.slice();
        const idx = faceIdToKindIndex(k.faceId);
        let after;
        if (k.kongType === KONG_TYPE.CONCEALED) { counts[idx] -= 4; after = _calculateShanten(counts, { meldCount: meldCount + 1 }); }
        else { counts[idx] -= 1; after = _calculateShanten(counts, { meldCount }); }
        if (after <= baseline) return k;
      }
      return { type: ACTION_TYPE.PASS };
    }
    const baseline = Math.min(...this._discardValueArrays(player, context, view).valueShanten.filter((x) => typeof x === 'number'));
    for (const k of kongs) {
      const after = hand.clone();
      if (k.kongType === KONG_TYPE.CONCEALED) {
        const tiles = k.tiles.map((t) => after.removeConcealedTile(t));
        after.addMeld(new Meld({ type: MELD_TYPE.KONG, tiles, concealed: true, kongType: KONG_TYPE.CONCEALED }));
      } else {
        const tile = after.removeConcealedTile(k.tile);
        after.replaceMeld(k.meldIndex, after.melds[k.meldIndex].upgradeToKong(tile));
      }
      const c = countsFromTiles(after.concealedTiles, tileToKindIndex);
      const vs = this._valueOfWaitingHand(c, _meldDescriptors(after.melds), after, player, context, view.visibleCounts).vs;
      if (vs <= baseline) return k;
    }
    return { type: ACTION_TYPE.PASS };
  }

  chooseWinDeclaration(player, winAction, context = {}) {
    return this._basic.chooseWinDeclaration(player, winAction, context);
  }
}

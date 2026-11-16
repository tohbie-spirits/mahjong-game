/**
 * DefensivePlayEvaluator.js
 *
 * Task 76: danger-tile assessment — how likely each tile kind is to deal into
 * (be the winning tile for) an opponent if discarded now.
 *
 * Like HandEfficiencyEvaluator (Task 73), this is Tile-agnostic: it works on
 * the same 34-slot tile-kind indices (0–8 suit A, 9–17 suit B, 18–26 suit C,
 * 27–33 honours) and plain table-state data. The Task 78 class wrapper turns
 * real discard piles / melds into this shape. Task 77 combines the danger
 * numbers produced here with Task 74's efficiency ranking to decide when to
 * fold; this module only MEASURES danger, it never chooses a discard.
 *
 * MODEL (per opponent, per tile kind k):
 *
 *   danger(k) = threat × waitLikelihood(k) × suitBias(k)
 *
 *   threat — estimated chance the opponent is tenpai right now:
 *       base + perDiscard·(discards so far) + perMeld·(open melds),
 *       capped at maxThreat; 1 when `declaredTenpai` (Riichi later).
 *
 *   waitLikelihood — how many plausible wait shapes could be waiting on k,
 *   given everything this player can see:
 *     - SEQUENCE waits (suited only): the three neighbour pairs that can wait
 *       on k — (k−2,k−1), (k−1,k+1), (k+1,k+2). A pair is DEAD when either
 *       neighbour has no unseen copies left (the "wall"/kabe effect). The two
 *       open-ended pairs are also weakened by SUJI: holding (k+1,k+2) waits on
 *       k AND k+3, so if the opponent discarded k+3 they are less likely to
 *       be waiting there — fully ruled out under furiten rules, only weakened
 *       without them.
 *     - SINGLE waits (pair-wait / tanki): need the opponent to hold copies of
 *       k, so they scale with k's unseen copies; zero unseen → impossible.
 *       Honours only ever have this kind of wait.
 *     - GENBUTSU: a kind the opponent discarded themselves. Under furiten
 *       rules (Riichi) it is perfectly safe against them; without furiten
 *       (Hong Kong, Chinese Official) it is only less likely.
 *     Terminals and honours come out safer than middle tiles naturally,
 *     because fewer wait shapes can reach them — no hand-tuned rank table.
 *
 *   suitBias — flush signal: when two or more of the opponent's open melds
 *   are all in one suit (honour melds don't count against it), that suit is
 *   multiplied up and the other suits down; honours unaffected.
 *
 *   Across opponents: combined(k) = 1 − Π(1 − dangerᵢ(k)).
 *
 * All numbers are heuristic estimates in [0, 1], tuned so their ORDER is
 * right (validated in the tests against simulated opponents' real waits),
 * not calibrated probabilities. Weights are exported and overridable.
 *
 * Public API (pure, inputs never mutated):
 *   DEFAULT_DANGER_WEIGHTS
 *   visibleCountsFromTable({ discards, melds, extra })
 *   assessOpponentThreat(opponent, weights?)
 *   assessDanger(state, options?) → { combined, perOpponent }
 *   rankSafeDiscards(handCounts, assessment) → [{ index, danger }]
 */

import { TILE_KIND_COUNT, HONOR_START, SUIT_SIZE, createEmptyCounts } from './HandEfficiencyEvaluator.js';

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Tunable weights. Override any subset via `options.weights`.
 * Frozen so callers can't mutate the shared defaults.
 */
export const DEFAULT_DANGER_WEIGHTS = Object.freeze({
  // Threat (tenpai estimate)
  threatBase: 0.02,
  threatPerDiscard: 0.035,
  threatPerMeld: 0.15,
  maxThreat: 0.95,
  // Wait likelihood
  sequenceFormWeight: 0.3,   // per live sequence wait form (max 3 forms)
  singleWaitWeight: 0.25,    // tanki / pair-wait term at full strength
  sujiReductionFuriten: 1,   // fraction of an open-ended form removed by suji under furiten
  sujiReductionNoFuriten: 0.5,
  genbutsuFactorNoFuriten: 0.35, // multiplier for the opponent's own discards when no furiten
  // Flush bias
  flushInSuit: 1.6,
  flushOffSuit: 0.4,
});

const MAX_COPIES = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @private */
function _isKind(i) {
  return Number.isInteger(i) && i >= 0 && i < TILE_KIND_COUNT;
}

/** @private */
function _suitOf(i) {
  return i < HONOR_START ? Math.floor(i / SUIT_SIZE) : null;
}

/** @private */
function _assertKindList(list, label) {
  if (!Array.isArray(list)) throw new TypeError(`[DefensivePlayEvaluator] ${label} must be an array of tile-kind indices.`);
  for (const i of list) {
    if (!_isKind(i)) throw new TypeError(`[DefensivePlayEvaluator] ${label} contains an invalid tile-kind index: ${i}.`);
  }
}

/** @private */
function _assertCountArray(arr, label) {
  if (!Array.isArray(arr) || arr.length !== TILE_KIND_COUNT) {
    throw new TypeError(`[DefensivePlayEvaluator] ${label} must be a ${TILE_KIND_COUNT}-slot count array.`);
  }
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    const v = arr[i];
    if (!Number.isInteger(v) || v < 0 || v > MAX_COPIES) {
      throw new TypeError(`[DefensivePlayEvaluator] ${label}[${i}] must be an integer 0–${MAX_COPIES}; got ${v}.`);
    }
  }
}

/** @private */
function _validateOpponent(opp, i) {
  if (opp === null || typeof opp !== 'object') {
    throw new TypeError(`[DefensivePlayEvaluator] opponents[${i}] must be an object.`);
  }
  _assertKindList(opp.discards ?? [], `opponents[${i}].discards`);
  const melds = opp.melds ?? [];
  if (!Array.isArray(melds)) throw new TypeError(`[DefensivePlayEvaluator] opponents[${i}].melds must be an array of tile-kind arrays.`);
  melds.forEach((m, j) => {
    _assertKindList(m, `opponents[${i}].melds[${j}]`);
    if (m.length < 3 || m.length > 4) throw new TypeError(`[DefensivePlayEvaluator] opponents[${i}].melds[${j}] must have 3 or 4 tiles.`);
  });
  if (melds.length > 4) throw new TypeError(`[DefensivePlayEvaluator] opponents[${i}] cannot have more than 4 melds.`);
  if (opp.declaredTenpai !== undefined && typeof opp.declaredTenpai !== 'boolean') {
    throw new TypeError(`[DefensivePlayEvaluator] opponents[${i}].declaredTenpai must be a boolean when supplied.`);
  }
  if (opp.threatScale !== undefined && (typeof opp.threatScale !== 'number' || !Number.isFinite(opp.threatScale) || opp.threatScale < 0 || opp.threatScale > 1)) {
    throw new TypeError(`[DefensivePlayEvaluator] opponents[${i}].threatScale must be a number in [0, 1] when supplied.`);
  }
}

/** @private */
function _resolveWeights(weights) {
  if (weights === undefined) return DEFAULT_DANGER_WEIGHTS;
  if (weights === null || typeof weights !== 'object') {
    throw new TypeError('[DefensivePlayEvaluator] options.weights must be an object when supplied.');
  }
  for (const [k, v] of Object.entries(weights)) {
    if (!(k in DEFAULT_DANGER_WEIGHTS)) throw new TypeError(`[DefensivePlayEvaluator] unknown weight "${k}".`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new TypeError(`[DefensivePlayEvaluator] weight "${k}" must be a non-negative finite number.`);
    }
  }
  return { ...DEFAULT_DANGER_WEIGHTS, ...weights };
}

// ---------------------------------------------------------------------------
// Visible counts
// ---------------------------------------------------------------------------

/**
 * Convenience: builds a visible-count array from table state.
 * @param {Object} table
 * @param {number[][]} [table.discards]  every discard pile (including your own)
 * @param {number[][]} [table.melds]     every exposed meld's tile kinds (any seat; NOT the claimed
 *                                       discard again if it's already in a discard list)
 * @param {number[]}   [table.extra]     any other face-up tiles (e.g. dora indicators)
 * @returns {number[]}
 * @throws {RangeError} when any kind would exceed 4 visible copies
 */
export function visibleCountsFromTable(table = {}) {
  if (table === null || typeof table !== 'object') {
    throw new TypeError('[DefensivePlayEvaluator] visibleCountsFromTable requires an object.');
  }
  const counts = createEmptyCounts();
  const add = (list, label) => {
    _assertKindList(list, label);
    for (const i of list) {
      counts[i] += 1;
      if (counts[i] > MAX_COPIES) throw new RangeError(`[DefensivePlayEvaluator] more than ${MAX_COPIES} visible copies of kind ${i}.`);
    }
  };
  (table.discards ?? []).forEach((pile, i) => add(pile, `discards[${i}]`));
  (table.melds ?? []).forEach((meld, i) => add(meld, `melds[${i}]`));
  add(table.extra ?? [], 'extra');
  return counts;
}

// ---------------------------------------------------------------------------
// Threat
// ---------------------------------------------------------------------------

/**
 * Estimated chance (0–1) the opponent is currently tenpai.
 * @param {{ discards?: number[], melds?: number[][], declaredTenpai?: boolean }} opponent
 * @param {Object} [weights] partial override of DEFAULT_DANGER_WEIGHTS
 * @returns {number}
 */
export function assessOpponentThreat(opponent, weights) {
  _validateOpponent(opponent, 0);
  const w = _resolveWeights(weights);
  if (opponent.declaredTenpai === true) return 1;
  const discards = (opponent.discards ?? []).length;
  const melds = (opponent.melds ?? []).length;
  const raw = w.threatBase + w.threatPerDiscard * discards + w.threatPerMeld * melds;
  // Task 80b: a caller-supplied threatScale (0–1) — e.g. a ruleset-aware
  // estimate that this opponent can't legally win off a discard — scales
  // the shape-based tenpai estimate. Omitted = 1 (Task 76 behaviour).
  const scale = opponent.threatScale ?? 1;
  return Math.max(0, Math.min(w.maxThreat, raw)) * scale;
}

// ---------------------------------------------------------------------------
// Wait likelihood
// ---------------------------------------------------------------------------

/** @private — 0..1 likelihood that a tenpai opponent waits on `k`. */
function _waitLikelihood(k, unseen, oppDiscardSet, furiten, w) {
  if (unseen[k] < 0) return 0;

  // Single waits (tanki / pair-wait): need the opponent to hold k.
  const u = unseen[k];
  const singleUnits = u <= 0 ? 0 : u === 1 ? 0.5 : 1;
  let score = w.singleWaitWeight * singleUnits;

  // Sequence waits (suited only).
  if (k < HONOR_START) {
    const suitStart = k - (k % SUIT_SIZE);
    const inSuit = (j) => j >= suitStart && j < suitStart + SUIT_SIZE;
    const alive = (j) => inSuit(j) && unseen[j] > 0;
    const sujiCut = furiten ? w.sujiReductionFuriten : w.sujiReductionNoFuriten;

    // Low side (k−2, k−1): open-ended unless k−2 is rank 1 (penchan) — suji partner k−3.
    if (alive(k - 2) && alive(k - 1)) {
      const partner = k - 3;
      const sujiSafe = inSuit(partner) && oppDiscardSet.has(partner);
      score += w.sequenceFormWeight * (sujiSafe ? 1 - sujiCut : 1);
    }
    // Middle (k−1, k+1): kanchan — unaffected by suji.
    if (alive(k - 1) && alive(k + 1)) {
      score += w.sequenceFormWeight;
    }
    // High side (k+1, k+2): suji partner k+3.
    if (alive(k + 1) && alive(k + 2)) {
      const partner = k + 3;
      const sujiSafe = inSuit(partner) && oppDiscardSet.has(partner);
      score += w.sequenceFormWeight * (sujiSafe ? 1 - sujiCut : 1);
    }
  }

  const max = 3 * w.sequenceFormWeight + w.singleWaitWeight;
  let likelihood = max > 0 ? Math.min(1, score / max) : 0;

  // Genbutsu.
  if (oppDiscardSet.has(k)) {
    likelihood = furiten ? 0 : likelihood * w.genbutsuFactorNoFuriten;
  }
  return likelihood;
}

/** @private — multiplier per kind from a one-suit meld pattern. */
function _suitBias(opponent, w) {
  const melds = opponent.melds ?? [];
  const suits = new Set();
  let suitedMelds = 0;
  for (const m of melds) {
    const s = _suitOf(m[0]);
    if (s === null) continue;
    suits.add(s);
    suitedMelds++;
  }
  const bias = new Array(TILE_KIND_COUNT).fill(1);
  if (suitedMelds >= 2 && suits.size === 1) {
    const flushSuit = [...suits][0];
    for (let i = 0; i < HONOR_START; i++) {
      bias[i] = _suitOf(i) === flushSuit ? w.flushInSuit : w.flushOffSuit;
    }
  }
  return bias;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/**
 * Assesses the danger of every tile kind against every opponent.
 *
 * @param {Object} state
 * @param {number[]} state.handCounts     your concealed hand (34 slots)
 * @param {number[]} state.visibleCounts  every OTHER face-up copy you can see
 *                                        (all discard piles incl. your own, all exposed melds)
 * @param {{ discards?: number[], melds?: number[][], declaredTenpai?: boolean }[]} state.opponents
 * @param {Object}  [options]
 * @param {boolean} [options.furiten=false]  true for furiten rulesets (Riichi): an opponent's own
 *                                           discards are perfectly safe against them, and suji
 *                                           fully rules out the matching open-ended wait.
 * @param {Object}  [options.weights]        partial override of DEFAULT_DANGER_WEIGHTS
 * @returns {{
 *   combined: number[],
 *   perOpponent: { threat: number, danger: number[] }[]
 * }}  danger values in [0, 1] per tile kind
 */
export function assessDanger(state, options = {}) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('[DefensivePlayEvaluator] assessDanger requires a state object.');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('[DefensivePlayEvaluator] assessDanger options must be an object.');
  }
  const { handCounts, visibleCounts, opponents } = state;
  _assertCountArray(handCounts, 'handCounts');
  _assertCountArray(visibleCounts, 'visibleCounts');
  if (!Array.isArray(opponents)) throw new TypeError('[DefensivePlayEvaluator] state.opponents must be an array.');
  opponents.forEach(_validateOpponent);
  if (options.furiten !== undefined && typeof options.furiten !== 'boolean') {
    throw new TypeError('[DefensivePlayEvaluator] options.furiten must be a boolean when supplied.');
  }
  const furiten = options.furiten === true;
  const w = _resolveWeights(options.weights);

  // Copies the opponents could still hold (from this player's point of view).
  const unseen = new Array(TILE_KIND_COUNT);
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    const u = MAX_COPIES - handCounts[i] - visibleCounts[i];
    if (u < 0) throw new RangeError(`[DefensivePlayEvaluator] hand + visible copies of kind ${i} exceed ${MAX_COPIES}.`);
    unseen[i] = u;
  }

  const perOpponent = opponents.map((opp) => {
    const threat = assessOpponentThreat(opp, options.weights);
    const discardSet = new Set(opp.discards ?? []);
    const bias = _suitBias(opp, w);
    const danger = new Array(TILE_KIND_COUNT);
    for (let k = 0; k < TILE_KIND_COUNT; k++) {
      const d = threat * _waitLikelihood(k, unseen, discardSet, furiten, w) * bias[k];
      danger[k] = Math.max(0, Math.min(1, d));
    }
    return { threat, danger };
  });

  const combined = new Array(TILE_KIND_COUNT).fill(0).map((_, k) => {
    let safe = 1;
    for (const o of perOpponent) safe *= 1 - o.danger[k];
    return 1 - safe;
  });

  return { combined, perOpponent };
}

/**
 * The kinds in `handCounts`, safest first (combined danger ascending, then
 * index ascending for determinism).
 * @param {number[]} handCounts
 * @param {{ combined: number[] }} assessment  result of assessDanger()
 * @returns {{ index: number, danger: number }[]}
 */
export function rankSafeDiscards(handCounts, assessment) {
  _assertCountArray(handCounts, 'handCounts');
  if (!assessment || !Array.isArray(assessment.combined) || assessment.combined.length !== TILE_KIND_COUNT) {
    throw new TypeError('[DefensivePlayEvaluator] rankSafeDiscards requires an assessDanger() result.');
  }
  const out = [];
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    if (handCounts[i] > 0) out.push({ index: i, danger: assessment.combined[i] });
  }
  out.sort((a, b) => a.danger - b.danger || a.index - b.index);
  return out;
}

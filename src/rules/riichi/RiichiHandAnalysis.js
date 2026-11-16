/**
 * RiichiHandAnalysis.js — Task 81: hand-shape analysis for the Riichi ruleset.
 *
 * Pure functions over a 34-slot COUNT ARRAY of concealed tiles, in
 * STANDARD_FACE_IDS order: dots 0–8, bamboo 9–17, characters 18–26,
 * winds E S W N 27–30, dragons red / green / white 31–33.
 *
 *   kindOfFaceId(faceId) / faceIdOfKind(k) / countsFromTiles(tiles)
 *   decomposeStandard(counts, meldCount)  → every distinct {pair, sets[]} split
 *                                          of a complete concealed part
 *   isSevenPairs(counts, meldCount)       → 7 DIFFERENT pairs, closed hands only
 *   isThirteenOrphans(counts, meldCount)  → 13 terminals/honours + one pair
 *   analyzeComplete(counts, meldCount)    → { isComplete, standard, sevenPairs, thirteenOrphans }
 *   findWaits(counts, meldCount)          → kinds that would complete a 13 − 3m hand
 *   isTenpai(counts, meldCount)
 *   interpretWin(counts, meldCount, winningKind)  (Task 82) → every reading of a
 *                                          complete hand × the part the winning tile
 *                                          completed, with its wait type
 *
 * Kept separate from the Hong Kong analysis on purpose (the plan's ruleset
 * isolation rule): Riichi needs every decomposition (later yaku and fu
 * depend on the interpretation), Seven Pairs with distinct pairs only, and
 * waits that ignore kinds already held four times ("karaten").
 * Never mutates its inputs.
 */

import { STANDARD_FACE_IDS } from '../../core/TileSetGenerator.js';

export const KIND_COUNT = 34;
export const HONOR_START = 27;
const SUIT_SIZE = 9;
const TERMINAL_HONOR_KINDS = Object.freeze([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);

const KIND_BY_FACE = new Map(STANDARD_FACE_IDS.map((id, k) => [id, k]));

/** @returns {number} kind index 0–33 (throws for bonus / unknown faces) */
export function kindOfFaceId(faceId) {
  const k = KIND_BY_FACE.get(faceId);
  if (k === undefined) throw new TypeError(`[RiichiHandAnalysis] not a standard tile face: ${faceId}`);
  return k;
}

/** @returns {string} */
export function faceIdOfKind(k) {
  if (!Number.isInteger(k) || k < 0 || k >= KIND_COUNT) throw new RangeError(`[RiichiHandAnalysis] kind out of range: ${k}`);
  return STANDARD_FACE_IDS[k];
}

export function isTerminalOrHonorKind(k) { return TERMINAL_HONOR_KINDS.includes(k); }

/** Count array from Tile objects (anything with an `id` face). */
export function countsFromTiles(tiles) {
  if (!Array.isArray(tiles)) throw new TypeError('[RiichiHandAnalysis] countsFromTiles requires an array of tiles.');
  const counts = new Array(KIND_COUNT).fill(0);
  for (const t of tiles) {
    const k = kindOfFaceId(t?.id);
    counts[k]++;
    if (counts[k] > 4) throw new RangeError(`[RiichiHandAnalysis] more than four copies of ${t.id}.`);
  }
  return counts;
}

function assertCounts(counts, meldCount, expectedTotal, fn) {
  if (!Array.isArray(counts) || counts.length !== KIND_COUNT || counts.some((v) => !Number.isInteger(v) || v < 0 || v > 4)) {
    throw new TypeError(`[RiichiHandAnalysis] ${fn}: counts must be ${KIND_COUNT} integers in 0–4.`);
  }
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) throw new RangeError(`[RiichiHandAnalysis] ${fn}: meldCount must be 0–4.`);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== expectedTotal(meldCount)) {
    throw new RangeError(`[RiichiHandAnalysis] ${fn}: ${total} concealed tiles, expected ${expectedTotal(meldCount)} with ${meldCount} melds.`);
  }
}

const completeTotal = (m) => 14 - 3 * m;
const waitingTotal = (m) => 13 - 3 * m;

/**
 * Every distinct way to split a complete concealed part into one pair and
 * (4 − meldCount) sets. Sets are { type: 'triplet' | 'run', kind } (a run's
 * kind is its lowest tile), listed in ascending kind order.
 * @returns {{ pair: number, sets: { type: string, kind: number }[] }[]}
 */
export function decomposeStandard(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'decomposeStandard');
  const out = [];
  const c = counts.slice();
  const setsNeeded = 4 - meldCount;
  for (let p = 0; p < KIND_COUNT; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const sets = [];
    (function search(start) {
      let k = start;
      while (k < KIND_COUNT && c[k] === 0) k++;
      if (k === KIND_COUNT) { if (sets.length === setsNeeded) out.push({ pair: p, sets: sets.slice() }); return; }
      if (c[k] >= 3) { c[k] -= 3; sets.push({ type: 'triplet', kind: k }); search(k); sets.pop(); c[k] += 3; }
      if (k < HONOR_START && k % SUIT_SIZE <= 6 && c[k + 1] > 0 && c[k + 2] > 0) {
        c[k]--; c[k + 1]--; c[k + 2]--; sets.push({ type: 'run', kind: k }); search(k); sets.pop(); c[k]++; c[k + 1]++; c[k + 2]++;
      }
    })(0);
    c[p] += 2;
  }
  return out;
}

/** Seven DIFFERENT pairs (four of a kind is not two pairs). Closed hands only. */
export function isSevenPairs(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'isSevenPairs');
  return meldCount === 0 && counts.filter((v) => v === 2).length === 7;
}

/** Thirteen Orphans: one of each terminal/honour plus one duplicate. Closed hands only. */
export function isThirteenOrphans(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'isThirteenOrphans');
  if (meldCount !== 0) return false;
  let pair = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const term = TERMINAL_HONOR_KINDS.includes(k);
    if (!term && counts[k] > 0) return false;
    if (term && counts[k] === 0) return false;
    if (counts[k] === 2) pair++;
  }
  return pair === 1;
}

/** @returns {{ isComplete: boolean, standard: Object[], sevenPairs: boolean, thirteenOrphans: boolean }} */
export function analyzeComplete(counts, meldCount = 0) {
  const standard = decomposeStandard(counts, meldCount);
  const sevenPairs = isSevenPairs(counts, meldCount);
  const thirteenOrphans = isThirteenOrphans(counts, meldCount);
  return { isComplete: standard.length > 0 || sevenPairs || thirteenOrphans, standard, sevenPairs, thirteenOrphans };
}

/**
 * Kinds that complete a waiting hand (13 − 3m concealed tiles). A kind the
 * hand already holds four of can never arrive, so it is not a wait.
 * @returns {number[]} ascending kinds
 */
export function findWaits(counts, meldCount = 0) {
  assertCounts(counts, meldCount, waitingTotal, 'findWaits');
  const waits = [];
  for (let k = 0; k < KIND_COUNT; k++) {
    if (counts[k] >= 4) continue;
    const c = counts.slice(); c[k]++;
    if (analyzeComplete(c, meldCount).isComplete) waits.push(k);
  }
  return waits;
}

export function isTenpai(counts, meldCount = 0) {
  return findWaits(counts, meldCount).length > 0;
}

/** Wait types (Task 82). */
export const WAIT_TYPE = Object.freeze({
  RYANMEN: 'ryanmen',           // open wait: 23 + 1/4
  KANCHAN: 'kanchan',           // closed wait: 13 + 2
  PENCHAN: 'penchan',           // edge wait: 12 + 3 / 89 + 7
  SHANPON: 'shanpon',           // two pairs, one becomes a triplet
  TANKI: 'tanki',               // pair wait (also every Seven Pairs win)
  THIRTEEN_SIDED: 'thirteen-sided', // Thirteen Orphans on any of the 13
  SINGLE: 'single',             // Thirteen Orphans completing the missing kind
});

/**
 * Every interpretation of a complete hand won on `winningKind`: each
 * standard reading × each of its parts that contains the winning kind (the
 * winner chooses the best one when scoring — Task 85), plus Seven Pairs and
 * Thirteen Orphans when they apply.
 *
 *   { structure: 'standard', pair, sets, winningPart: 'pair' | set index, wait }
 *   { structure: 'seven-pairs', wait: 'tanki' }
 *   { structure: 'thirteen-orphans', wait: 'thirteen-sided' | 'single' }
 *
 * Identical interpretations are listed once — two parts of a reading that
 * are the same set (e.g. three 1-2-3 runs) give one interpretation.
 * @param {number[]} counts       complete concealed part (14 − 3m, incl. the winning tile)
 * @param {number} meldCount
 * @param {number} winningKind
 * @returns {Object[]}
 */
export function interpretWin(counts, meldCount, winningKind) {
  assertCounts(counts, meldCount, completeTotal, 'interpretWin');
  if (!Number.isInteger(winningKind) || winningKind < 0 || winningKind >= KIND_COUNT || counts[winningKind] === 0) {
    throw new RangeError('[RiichiHandAnalysis] interpretWin: the winning kind must be in the hand.');
  }
  const out = [];
  const seen = new Set();
  // Identity = the reading + WHAT the winning part is (not its position), so
  // e.g. three identical runs give one interpretation, not three.
  const push = (i) => {
    const part = i.winningPart === undefined || i.winningPart === 'pair' ? i.winningPart ?? null : i.sets[i.winningPart];
    const key = JSON.stringify([i.structure, i.pair ?? null, i.sets ?? null, part, i.wait]);
    if (!seen.has(key)) { seen.add(key); out.push(i); }
  };
  for (const r of decomposeStandard(counts, meldCount)) {
    if (r.pair === winningKind) push({ structure: 'standard', pair: r.pair, sets: r.sets, winningPart: 'pair', wait: WAIT_TYPE.TANKI });
    r.sets.forEach((set, i) => {
      let wait = null;
      if (set.type === 'triplet' && set.kind === winningKind) wait = WAIT_TYPE.SHANPON;
      if (set.type === 'run') {
        const pos = winningKind - set.kind;
        if (pos === 1) wait = WAIT_TYPE.KANCHAN;
        else if (pos === 0) wait = set.kind % SUIT_SIZE === 6 ? WAIT_TYPE.PENCHAN : WAIT_TYPE.RYANMEN;   // 7 of 789 / 1 of 123…
        else if (pos === 2) wait = set.kind % SUIT_SIZE === 0 ? WAIT_TYPE.PENCHAN : WAIT_TYPE.RYANMEN;   // 3 of 123 / 9 of 789…
      }
      if (wait) push({ structure: 'standard', pair: r.pair, sets: r.sets, winningPart: i, wait });
    });
  }
  if (isSevenPairs(counts, meldCount)) push({ structure: 'seven-pairs', wait: WAIT_TYPE.TANKI });
  if (isThirteenOrphans(counts, meldCount)) {
    push({ structure: 'thirteen-orphans', wait: counts[winningKind] === 2 ? WAIT_TYPE.THIRTEEN_SIDED : WAIT_TYPE.SINGLE });
  }
  return out;
}

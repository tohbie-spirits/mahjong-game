/**
 * ChineseOfficialHandAnalysis.js — Task 93: hand-shape analysis for the
 * Chinese Official ruleset (Mahjong Competition Rules, "MCR" / Guobiao).
 *
 * Pure functions over a 34-slot COUNT ARRAY of concealed tiles, in
 * STANDARD_FACE_IDS order: dots 0–8, bamboo 9–17, characters 18–26,
 * winds E S W N 27–30, dragons red / green / white 31–33. Bonus tiles
 * (flowers / seasons) are never part of a hand shape — callers drop them
 * with standardTiles() first.
 *
 * WINNING SHAPES (every one is reported, because MCR scores the hand by the
 * arrangement worth the most points — Tasks 94–95):
 *   standard           four sets (chow / pung) + a pair, melds included
 *   seven-pairs        seven pairs, closed; four of a kind counts as TWO pairs
 *                      (unlike Riichi)
 *   thirteen-orphans   one of each terminal / honour + one duplicate, closed
 *   honors-knitted     ("Lesser Honors and Knitted Tiles", 全不靠) 14 single
 *                      tiles, no two alike, taken from the 7 honours and one
 *                      KNITTED set — 1-4-7 / 2-5-8 / 3-6-9 each in a different
 *                      suit; all 7 honours present = "Greater Honors and
 *                      Knitted Tiles" (七星不靠). Closed.
 *   knitted-straight   (组合龙) all nine tiles of one knitted set + one more
 *                      set + a pair. The extra set may be a melded one.
 *
 *   kindOfFaceId / faceIdOfKind / standardTiles / countsFromTiles
 *   KNITTED_ARRANGEMENTS                 the six suit → (147|258|369) assignments
 *   decomposeStandard(counts, meldCount) every distinct { pair, sets[] } split
 *   isSevenPairs / isThirteenOrphans / honorsKnitted / knittedStraights
 *   analyzeComplete(counts, meldCount)   { isComplete, standard, sevenPairs,
 *                                          thirteenOrphans, honorsKnitted, knittedStraight }
 *   findWaits(counts, meldCount)         kinds that complete a 13 − 3m hand
 *   interpretWin(counts, meldCount, winningKind) every reading × the part
 *                                        the winning tile completed, with its wait
 *
 * Kept separate from the Hong Kong and Riichi analyses on purpose (the plan's
 * ruleset isolation rule). Never mutates its inputs.
 */

import { STANDARD_FACE_IDS } from '../../core/TileSetGenerator.js';

export const KIND_COUNT = 34;
export const HONOR_START = 27;
const SUIT_SIZE = 9;
export const TERMINAL_HONOR_KINDS = Object.freeze([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
const HONOR_KINDS = Object.freeze([27, 28, 29, 30, 31, 32, 33]);

const KIND_BY_FACE = new Map(STANDARD_FACE_IDS.map((id, k) => [id, k]));

/** @returns {number} kind 0–33 (throws for bonus / unknown faces) */
export function kindOfFaceId(faceId) {
  const k = KIND_BY_FACE.get(faceId);
  if (k === undefined) throw new TypeError(`[ChineseOfficialHandAnalysis] not a standard tile face: ${faceId}`);
  return k;
}

/** @returns {string} face id of kind k */
export function faceIdOfKind(k) {
  if (!Number.isInteger(k) || k < 0 || k >= KIND_COUNT) throw new RangeError(`[ChineseOfficialHandAnalysis] bad kind: ${k}`);
  return STANDARD_FACE_IDS[k];
}

/** The tiles that take part in a hand shape (flowers / seasons dropped). */
export function standardTiles(tiles) {
  if (!Array.isArray(tiles)) throw new TypeError('[ChineseOfficialHandAnalysis] standardTiles requires an array.');
  return tiles.filter((t) => KIND_BY_FACE.has(t?.id));
}

/** Count array from tiles (anything with a standard `id`). */
export function countsFromTiles(tiles) {
  if (!Array.isArray(tiles)) throw new TypeError('[ChineseOfficialHandAnalysis] countsFromTiles requires an array of tiles.');
  const counts = new Array(KIND_COUNT).fill(0);
  for (const t of tiles) {
    const k = kindOfFaceId(t?.id);
    if (++counts[k] > 4) throw new RangeError(`[ChineseOfficialHandAnalysis] more than four copies of ${t.id}.`);
  }
  return counts;
}

/** True when no kind is held more than four times (a probe for a 5th copy is not a hand). */
export function isPhysicallyPossible(counts) {
  return counts.every((v) => v <= 4);
}

const completeTotal = (m) => 14 - 3 * m;
const waitingTotal = (m) => 13 - 3 * m;

function assertCounts(counts, meldCount, totalFor, fn) {
  if (!Array.isArray(counts) || counts.length !== KIND_COUNT || !counts.every((v) => Number.isInteger(v) && v >= 0)) {
    throw new TypeError(`[ChineseOfficialHandAnalysis] ${fn}: counts must be a ${KIND_COUNT}-slot array of non-negative integers.`);
  }
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) throw new RangeError(`[ChineseOfficialHandAnalysis] ${fn}: meldCount must be 0–4.`);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== totalFor(meldCount)) throw new RangeError(`[ChineseOfficialHandAnalysis] ${fn}: expected ${totalFor(meldCount)} tiles, got ${total}.`);
}

// ---------------------------------------------------------------------------
// Knitted sets
// ---------------------------------------------------------------------------

/**
 * The six knitted arrangements: suitOffsets[s] = 0 | 1 | 2 means suit s
 * (0 dots, 1 bamboo, 2 characters) holds 1-4-7, 2-5-8 or 3-6-9. `kinds` are
 * the nine kinds of that knitted set, ascending.
 */
export const KNITTED_ARRANGEMENTS = Object.freeze(
  [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((suitOffsets) => Object.freeze({
    suitOffsets: Object.freeze(suitOffsets),
    kinds: Object.freeze(suitOffsets.flatMap((off, s) => [0, 3, 6].map((r) => s * SUIT_SIZE + off + r)).sort((a, b) => a - b)),
  })),
);

// ---------------------------------------------------------------------------
// Standard decomposition
// ---------------------------------------------------------------------------

/** Every way to split `c` into exactly `setsNeeded` chows / pungs. */
function splitSets(c, setsNeeded) {
  const out = [];
  const sets = [];
  (function search(start) {
    let k = start;
    while (k < KIND_COUNT && c[k] === 0) k++;
    if (k === KIND_COUNT) { if (sets.length === setsNeeded) out.push(sets.slice()); return; }
    if (sets.length === setsNeeded) return;
    if (c[k] >= 3) { c[k] -= 3; sets.push({ type: 'pung', kind: k }); search(k); sets.pop(); c[k] += 3; }
    if (k < HONOR_START && k % SUIT_SIZE <= 6 && c[k + 1] > 0 && c[k + 2] > 0) {
      c[k]--; c[k + 1]--; c[k + 2]--; sets.push({ type: 'chow', kind: k }); search(k); sets.pop(); c[k]++; c[k + 1]++; c[k + 2]++;
    }
  })(0);
  return out;
}

/** Every pair + sets split of `c` with `setsNeeded` sets. */
function splitPairAndSets(c, setsNeeded) {
  const out = [];
  for (let p = 0; p < KIND_COUNT; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    for (const sets of splitSets(c, setsNeeded)) out.push({ pair: p, sets });
    c[p] += 2;
  }
  return out;
}

/**
 * Every distinct standard reading of a complete concealed part: { pair, sets }
 * with sets { type: 'chow'|'pung', kind } (a chow's kind is its lowest tile).
 */
export function decomposeStandard(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'decomposeStandard');
  return splitPairAndSets(counts.slice(), 4 - meldCount);
}

// ---------------------------------------------------------------------------
// Special shapes
// ---------------------------------------------------------------------------

/** Seven pairs, closed; four of a kind counts as two pairs (MCR). */
export function isSevenPairs(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'isSevenPairs');
  return meldCount === 0 && counts.every((v) => v % 2 === 0);
}

/** Thirteen Orphans: every terminal / honour once plus one duplicate. Closed. */
export function isThirteenOrphans(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'isThirteenOrphans');
  if (meldCount !== 0) return false;
  let pairs = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const term = TERMINAL_HONOR_KINDS.includes(k);
    if (!term && counts[k] > 0) return false;
    if (term && counts[k] === 0) return false;
    if (counts[k] === 2) pairs++;
  }
  return pairs === 1;
}

/**
 * Lesser / Greater Honors and Knitted Tiles: 14 different tiles, all honours
 * or from one knitted set. Closed.
 * @returns {{ greater: boolean, arrangement: Object, honors: number }|null}
 */
export function honorsKnitted(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'honorsKnitted');
  if (meldCount !== 0 || counts.some((v) => v > 1)) return null;
  const honors = HONOR_KINDS.filter((k) => counts[k] === 1).length;
  for (const arrangement of KNITTED_ARRANGEMENTS) {
    const allowed = new Set(arrangement.kinds);
    let ok = true;
    for (let k = 0; k < HONOR_START; k++) if (counts[k] && !allowed.has(k)) { ok = false; break; }
    if (ok) return { greater: honors === 7, arrangement, honors };
  }
  return null;
}

/**
 * Knitted Straight readings: the nine tiles of one knitted set + one set + a
 * pair. With one meld, the meld is the set.
 * @returns {{ arrangement: Object, pair: number, sets: Object[] }[]}
 */
export function knittedStraights(counts, meldCount = 0) {
  assertCounts(counts, meldCount, completeTotal, 'knittedStraights');
  if (meldCount > 1) return [];
  const out = [];
  for (const arrangement of KNITTED_ARRANGEMENTS) {
    if (!arrangement.kinds.every((k) => counts[k] > 0)) continue;
    const c = counts.slice();
    for (const k of arrangement.kinds) c[k]--;
    for (const r of splitPairAndSets(c, 1 - meldCount)) out.push({ arrangement, pair: r.pair, sets: r.sets });
  }
  return out;
}

/**
 * @returns {{ isComplete: boolean, standard: Object[], sevenPairs: boolean, thirteenOrphans: boolean,
 *             honorsKnitted: Object|null, knittedStraight: Object[] }}
 */
export function analyzeComplete(counts, meldCount = 0) {
  if (!isPhysicallyPossible(counts)) {
    assertCounts(counts, meldCount, completeTotal, 'analyzeComplete');
    return { isComplete: false, standard: [], sevenPairs: false, thirteenOrphans: false, honorsKnitted: null, knittedStraight: [] };
  }
  const standard = decomposeStandard(counts, meldCount);
  const sevenPairs = isSevenPairs(counts, meldCount);
  const thirteenOrphans = isThirteenOrphans(counts, meldCount);
  const hk = honorsKnitted(counts, meldCount);
  const knittedStraight = knittedStraights(counts, meldCount);
  return {
    isComplete: standard.length > 0 || sevenPairs || thirteenOrphans || hk !== null || knittedStraight.length > 0,
    standard, sevenPairs, thirteenOrphans, honorsKnitted: hk, knittedStraight,
  };
}

/**
 * Kinds that complete a waiting hand (13 − 3m concealed tiles). A kind held
 * four times can't arrive, so it is never a wait.
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

// ---------------------------------------------------------------------------
// Interpretations
// ---------------------------------------------------------------------------

/**
 * How the winning tile completed its part (MCR's wait fans — Edge Wait,
 * Closed Wait, Single Wait — use these; Tasks 94–95).
 */
export const WAIT_TYPE = Object.freeze({
  EDGE: 'edge',          // 12 + 3, 89 + 7
  CLOSED: 'closed',      // 13 + 2
  SINGLE: 'single',      // waiting on the pair
  OPEN: 'open',          // 23 + 1/4 (two-sided)
  PUNG: 'pung',          // two pairs, one becomes a pung
  KNITTED: 'knitted',    // the tile completed a knitted part
  NONE: 'none',          // shapes without a wait concept (Seven Pairs, Thirteen Orphans, Honors & Knitted)
});

function chowWait(set, winningKind) {
  const pos = winningKind - set.kind;
  if (pos === 1) return WAIT_TYPE.CLOSED;
  if (pos === 0) return set.kind % SUIT_SIZE === 6 ? WAIT_TYPE.EDGE : WAIT_TYPE.OPEN;
  if (pos === 2) return set.kind % SUIT_SIZE === 0 ? WAIT_TYPE.EDGE : WAIT_TYPE.OPEN;
  return null;
}

/**
 * Every interpretation of a complete hand won on `winningKind`:
 *   { structure: 'standard', pair, sets, winningPart: 'pair' | set index, wait }
 *   { structure: 'knitted-straight', arrangement, pair, sets, winningPart: 'knitted' | 'pair' | 0, wait }
 *   { structure: 'seven-pairs' | 'thirteen-orphans', wait: 'none' }
 *   { structure: 'honors-knitted', greater, arrangement, wait: 'none' }
 * Identical interpretations are listed once.
 */
export function interpretWin(counts, meldCount, winningKind) {
  assertCounts(counts, meldCount, completeTotal, 'interpretWin');
  if (!Number.isInteger(winningKind) || winningKind < 0 || winningKind >= KIND_COUNT || counts[winningKind] === 0) {
    throw new RangeError('[ChineseOfficialHandAnalysis] interpretWin: the winning kind must be in the hand.');
  }
  const a = analyzeComplete(counts, meldCount);
  const out = [];
  const seen = new Set();
  const push = (i) => {
    const part = typeof i.winningPart === 'number' ? i.sets[i.winningPart] : i.winningPart ?? null;
    const key = JSON.stringify([i.structure, i.arrangement?.suitOffsets ?? null, i.pair ?? null, i.sets ?? null, part, i.wait]);
    if (!seen.has(key)) { seen.add(key); out.push(i); }
  };
  const readings = (structure, list, extra = () => ({})) => {
    for (const r of list) {
      const base = { structure, pair: r.pair, sets: r.sets, ...extra(r) };
      if (r.pair === winningKind) push({ ...base, winningPart: 'pair', wait: WAIT_TYPE.SINGLE });
      r.sets.forEach((set, i) => {
        const wait = set.type === 'pung' ? (set.kind === winningKind ? WAIT_TYPE.PUNG : null) : chowWait(set, winningKind);
        if (wait) push({ ...base, winningPart: i, wait });
      });
      if (structure === 'knitted-straight' && r.arrangement.kinds.includes(winningKind)) push({ ...base, winningPart: 'knitted', wait: WAIT_TYPE.KNITTED });
    }
  };
  readings('standard', a.standard);
  readings('knitted-straight', a.knittedStraight, (r) => ({ arrangement: r.arrangement }));
  if (a.sevenPairs) push({ structure: 'seven-pairs', wait: WAIT_TYPE.NONE });
  if (a.thirteenOrphans) push({ structure: 'thirteen-orphans', wait: WAIT_TYPE.NONE });
  if (a.honorsKnitted) push({ structure: 'honors-knitted', greater: a.honorsKnitted.greater, arrangement: a.honorsKnitted.arrangement, wait: WAIT_TYPE.NONE });
  return out;
}

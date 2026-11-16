/**
 * HongKongHandAnalysis.js
 *
 * Structural analysis of a complete Hong Kong hand: every way the concealed
 * tiles split into sets + one pair (alongside the declared melds), plus the
 * two special shapes (Thirteen Orphans; Seven Pairs when enabled). Shared by
 * HongKongRules (win validation, Task 23) and HongKongScoring (Tasks 24–25),
 * which picks the highest-scoring decomposition.
 *
 * REBUILT (after Task 77).
 *
 * Group shape: { kind: 'chow'|'pung'|'kong'|'pair', faceIds: string[], concealed: boolean }
 */

import { STANDARD_FACE_IDS } from '../../core/TileSetGenerator.js';
import { MELD_TYPE } from '../../utils/constants.js';

const FACE_INDEX = new Map(STANDARD_FACE_IDS.map((id, i) => [id, i]));
const SUITED_END = 27; // first honour index in STANDARD_FACE_IDS

export const TERMINAL_HONOR_FACE_IDS = Object.freeze(
  STANDARD_FACE_IDS.filter((id, i) => i >= SUITED_END || /-(1|9)$/.test(id))
);

/** Face-count array (34 slots) for a list of tiles. Bonus tiles ignored. */
export function faceCounts(tiles) {
  const counts = new Array(34).fill(0);
  for (const t of tiles) {
    const i = FACE_INDEX.get(t.id);
    if (i !== undefined) counts[i]++;
  }
  return counts;
}

/** Group form of a declared meld. */
export function meldToGroup(meld) {
  const kind = meld.type === MELD_TYPE.CHI ? 'chow' : meld.type === MELD_TYPE.PON ? 'pung' : 'kong';
  return { kind, faceIds: meld.tiles.map((t) => t.id), concealed: meld.concealed === true };
}

/**
 * All standard decompositions of the concealed tiles into `setsNeeded` sets
 * plus one pair. Returns [] when there is none.
 * @param {number[]} counts  34-slot face counts of the concealed tiles
 * @param {number} setsNeeded
 * @returns {{kind: string, faceIds: string[], concealed: boolean}[][]}
 */
export function decomposeConcealed(counts, setsNeeded) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== setsNeeded * 3 + 2) return [];
  const results = [];
  const c = counts.slice();
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const pair = { kind: 'pair', faceIds: [STANDARD_FACE_IDS[p], STANDARD_FACE_IDS[p]], concealed: true };
    _sets(c, 0, [], (sets) => results.push([...sets, pair]));
    c[p] += 2;
  }
  // Deduplicate identical decompositions (same multiset of groups).
  const seen = new Set();
  return results.filter((d) => {
    const key = d.map((g) => `${g.kind}:${g.faceIds.join(',')}`).sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @private */
function _sets(c, start, acc, emit) {
  let i = start;
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) { emit(acc); return; }
  if (c[i] >= 3) {
    c[i] -= 3;
    _sets(c, i, [...acc, { kind: 'pung', faceIds: [STANDARD_FACE_IDS[i], STANDARD_FACE_IDS[i], STANDARD_FACE_IDS[i]], concealed: true }], emit);
    c[i] += 3;
  }
  if (i < SUITED_END && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    _sets(c, i, [...acc, { kind: 'chow', faceIds: [STANDARD_FACE_IDS[i], STANDARD_FACE_IDS[i + 1], STANDARD_FACE_IDS[i + 2]], concealed: true }], emit);
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

/** Thirteen Orphans: 14 concealed tiles, every terminal/honour kind present, one paired. */
export function isThirteenOrphans(counts, meldCount) {
  if (meldCount !== 0) return false;
  let total = 0; let pairs = 0;
  for (let i = 0; i < 34; i++) total += counts[i];
  if (total !== 14) return false;
  for (const id of TERMINAL_HONOR_FACE_IDS) {
    const n = counts[FACE_INDEX.get(id)];
    if (n === 0) return false;
    if (n === 2) pairs++;
    if (n > 2) return false;
  }
  return pairs === 1;
}

/** Seven Pairs: 14 concealed tiles forming seven DISTINCT pairs. */
export function isSevenPairs(counts, meldCount) {
  if (meldCount !== 0) return false;
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) continue;
    if (counts[i] !== 2) return false;
    pairs++;
  }
  return pairs === 7;
}

/**
 * Full analysis of a complete hand.
 * @param {import('../../core/Hand.js').Hand} hand
 * @param {{ allowSevenPairs?: boolean }} [options]
 * @returns {{ isComplete: boolean, standard: Object[][], thirteenOrphans: boolean, sevenPairs: boolean, meldGroups: Object[] }}
 */
export function analyzeHand(hand, options = {}) {
  const counts = faceCounts(hand.concealedTiles);
  const melds = hand.melds;
  const meldGroups = melds.map(meldToGroup);
  const setsNeeded = 4 - melds.length;
  const standard = setsNeeded >= 0 ? decomposeConcealed(counts, setsNeeded).map((d) => [...meldGroups, ...d]) : [];
  const thirteenOrphans = isThirteenOrphans(counts, melds.length);
  const sevenPairs = options.allowSevenPairs === true && isSevenPairs(counts, melds.length);
  return { isComplete: standard.length > 0 || thirteenOrphans || sevenPairs, standard, thirteenOrphans, sevenPairs, meldGroups };
}

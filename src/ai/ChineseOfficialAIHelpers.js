/**
 * ChineseOfficialAIHelpers.js — Task 98: the shared Chinese Official (MCR)
 * adaptation layer for the Basic and Advanced AI tiers.
 *
 *   isChineseOfficialContext(context)    the AI context's rule engine is MCR
 *   valuableHonorKinds(roles)            dragons + seat wind + prevalent wind (2 points a Pung)
 *   analyzeMcrRoutes(counts, melds, roles)
 *       VALUE SHANTEN for MCR's 8-point minimum: how far the hand is from a
 *       complete hand GUARANTEED to reach 8 points (flowers never count), by
 *       checking the main ways real hands get there and taking the fastest
 *       route that qualifies:
 *         MIXED_STRAIGHT (8)      123 / 456 / 789 in three different suits
 *         PURE_STRAIGHT (16)      123 456 789 in one suit
 *         MIXED_TRIPLE_CHOW (8)   the same chow in all three suits
 *         FULL_FLUSH (24)         one suit, no honours
 *         HALF_FLUSH (6 + base)   one suit + honours — qualifies with ≥ 2 more
 *                                 (a closed hand, a valuable honour Pung), or
 *                                 as HALF_FLUSH_HONOR finishing a valuable honour pair
 *         ALL_PUNGS (6 + base)    likewise (two concealed Pungs also give 2)
 *         SEVEN_PAIRS (24)        closed; four of a kind = two pairs
 *         THIRTEEN_ORPHANS (88)   closed
 *         HONORS_KNITTED (12)     closed; 14 different honours / knitted tiles
 *         KNITTED_STRAIGHT (12)   the nine knitted tiles + a set + a pair
 *         PLAIN (base)            anything — qualifies only if base ≥ 8
 *       base = 2 for a still-closed hand (Concealed Hand / Fully Concealed)
 *            + 2 per valuable honour Pung already held (each role).
 *       Shanten here = tiles still needed − 1 (0 = one tile from complete),
 *       the same scale as HandEfficiencyEvaluator. Unqualified routes are
 *       ranked after every qualifying one (+3), as in HandValuePlanner.
 *   mcrWaitKinds(counts, meldCount)      waits by every MCR shape (ChineseOfficialHandAnalysis)
 *
 * Everything works on the AI's 34-slot kind counts (STANDARD_FACE_IDS order)
 * and the planner meld descriptors { type: 'chi'|'pon'|'kong', kinds, concealed }.
 */

import { RULESET_ID } from '../utils/constants.js';
import { calculateShantenUnchecked, calculatePungsShanten, TILE_KIND_COUNT, HONOR_START, SUIT_SIZE } from './advanced/HandEfficiencyEvaluator.js';
import { findWaits, KNITTED_ARRANGEMENTS, TERMINAL_HONOR_KINDS } from '../rules/chineseOfficial/ChineseOfficialHandAnalysis.js';

export const MCR_ROUTE = Object.freeze({
  PLAIN: 'plain',
  MIXED_STRAIGHT: 'mixed-straight',
  PURE_STRAIGHT: 'pure-straight',
  MIXED_TRIPLE_CHOW: 'mixed-triple-chow',
  FULL_FLUSH: 'full-flush',
  HALF_FLUSH: 'half-flush',
  HALF_FLUSH_HONOR: 'half-flush-honor',
  ALL_PUNGS: 'all-pungs',
  ALL_PUNGS_HONOR: 'all-pungs-honor',
  SEVEN_PAIRS: 'seven-pairs',
  THIRTEEN_ORPHANS: 'thirteen-orphans',
  HONORS_KNITTED: 'honors-knitted',
  KNITTED_STRAIGHT: 'knitted-straight',
});

export const MCR_MINIMUM = 8;
const UNQUALIFIED_PENALTY = 3;
const DRAGON_KINDS = [31, 32, 33];
const HONOR_KINDS = [27, 28, 29, 30, 31, 32, 33];
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

export function isChineseOfficialContext(context) {
  return typeof context?.ruleEngine?.getRulesetId === 'function' && context.ruleEngine.getRulesetId() === RULESET_ID.CHINESE_OFFICIAL;
}

/** Kinds whose Pung is worth points: dragons, the seat wind, the prevalent wind. */
export function valuableHonorKinds({ seatWindIndex = null, roundWindIndex = null } = {}) {
  const out = new Set(DRAGON_KINDS);
  if (seatWindIndex !== null) out.add(seatWindIndex);
  if (roundWindIndex !== null) out.add(roundWindIndex);
  return out;
}

/** Points a Pung of honour `kind` brings (2 per role). */
function honorPoints(kind, { seatWindIndex = null, roundWindIndex = null } = {}) {
  let p = 0;
  if (DRAGON_KINDS.includes(kind)) p += 2;
  if (kind === seatWindIndex) p += 2;
  if (kind === roundWindIndex) p += 2;
  return p;
}

/** Points already certain for the hand. */
export function mcrBasePoints(counts, melds, roles = {}) {
  let p = 0;
  for (const m of melds) if (m.type !== 'chi') p += honorPoints(m.kinds[0], roles);
  for (let k = HONOR_START; k < TILE_KIND_COUNT; k++) if (counts[k] >= 3) p += honorPoints(k, roles);
  if (melds.every((m) => m.concealed)) p += 2;
  return p;
}

/**
 * Tiles needed to turn `rest` into `setsNeeded` sets (0 or 1) + a pair.
 * @private
 */
function restNeed(rest, setsNeeded) {
  const pairNeed = (c) => (c.some((v) => v >= 2) ? 0 : c.some((v) => v >= 1) ? 1 : 2);
  if (setsNeeded <= 0) return pairNeed(rest);
  let best = 3 + pairNeed(rest);
  for (let k = 0; k < TILE_KIND_COUNT; k++) {
    // a pung of k
    if (rest[k] > 0) {
      const c = rest.slice(); const use = Math.min(3, c[k]); c[k] -= use;
      best = Math.min(best, (3 - use) + pairNeed(c));
    }
    // a chow from k
    if (k < HONOR_START && k % SUIT_SIZE <= 6) {
      const c = rest.slice(); let need = 0;
      for (let d = 0; d < 3; d++) { if (c[k + d] > 0) c[k + d]--; else need++; }
      if (need < 3) best = Math.min(best, need + pairNeed(c));
    }
  }
  return best;
}

/**
 * A route made of fixed required sets (chows as [kind,kind+1,kind+2]).
 * @private
 * @returns {number|null} shanten, or null when the melds make it impossible
 */
function requiredSetsShanten(counts, melds, required) {
  const left = required.map((r) => r.slice());
  let unmatched = 0;
  for (const m of melds) {
    const i = left.findIndex((r) => m.type === 'chi' && r.join() === m.kinds.slice().sort((a, b) => a - b).join());
    if (i >= 0) left.splice(i, 1); else unmatched++;
  }
  const extra = 4 - required.length - unmatched;
  if (extra < 0) return null;
  const c = counts.slice();
  let missing = 0;
  for (const r of left) for (const k of r) { if (c[k] > 0) c[k]--; else missing++; }
  return missing + restNeed(c, extra) - 1;
}

/**
 * MCR value routes for a hand (any size up to 14 − 3m concealed tiles).
 * @param {number[]} counts
 * @param {{type: string, kinds: number[], concealed: boolean}[]} melds
 * @param {{ seatWindIndex?: number|null, roundWindIndex?: number|null }} [roles]
 * @returns {{ valueShanten: number, best: Object, routes: Object[] }}
 */
export function analyzeMcrRoutes(counts, melds = [], roles = {}) {
  if (!Array.isArray(counts) || counts.length !== TILE_KIND_COUNT) throw new TypeError('[ChineseOfficialAIHelpers] counts must be a 34-slot array.');
  if (!Array.isArray(melds)) throw new TypeError('[ChineseOfficialAIHelpers] melds must be an array.');
  const m = melds.length;
  const closed = melds.every((x) => x.concealed);
  const base = mcrBasePoints(counts, melds, roles);
  const routes = [];
  const push = (route, shanten, points, extra = {}) => { if (shanten !== null && Number.isFinite(shanten)) routes.push({ route, shanten, points, ...extra }); };

  push(MCR_ROUTE.PLAIN, calculateShantenUnchecked(counts, m), base);

  // Chow routes.
  const chow = (suit, start) => [suit * SUIT_SIZE + start - 1, suit * SUIT_SIZE + start, suit * SUIT_SIZE + start + 1];
  for (const p of PERMS) push(MCR_ROUTE.MIXED_STRAIGHT, requiredSetsShanten(counts, melds, [chow(p[0], 1), chow(p[1], 4), chow(p[2], 7)]), 8 + base, { suits: p });
  for (let s = 0; s < 3; s++) push(MCR_ROUTE.PURE_STRAIGHT, requiredSetsShanten(counts, melds, [chow(s, 1), chow(s, 4), chow(s, 7)]), 16 + base, { suit: s });
  for (let n = 1; n <= 7; n++) push(MCR_ROUTE.MIXED_TRIPLE_CHOW, requiredSetsShanten(counts, melds, [chow(0, n), chow(1, n), chow(2, n)]), 8 + base, { start: n });

  // Flush routes.
  for (let s = 0; s < 3; s++) {
    const lo = s * SUIT_SIZE; const hi = lo + SUIT_SIZE;
    const offSuitMeld = melds.some((x) => x.kinds.some((k) => k < HONOR_START && (k < lo || k >= hi)));
    if (offSuitMeld) continue;
    const honorMeld = melds.some((x) => x.kinds.some((k) => k >= HONOR_START));
    if (!honorMeld) {
      const pure = counts.map((v, k) => (k >= lo && k < hi ? v : 0));
      push(MCR_ROUTE.FULL_FLUSH, calculateShantenUnchecked(pure, m), 24 + base, { suit: s });
    }
    const half = counts.map((v, k) => (k < HONOR_START && (k < lo || k >= hi) ? 0 : v));
    push(MCR_ROUTE.HALF_FLUSH, calculateShantenUnchecked(half, m), 6 + base, { suit: s });
    for (const h of valuableHonorKinds(roles)) {
      if (half[h] !== 2 || m >= 4) continue;
      const c = half.slice(); c[h] = 0;
      push(MCR_ROUTE.HALF_FLUSH_HONOR, calculateShantenUnchecked(c, m + 1) + 1, 6 + honorPoints(h, roles) + base, { suit: s, honor: h });
    }
  }

  // All Pungs.
  if (!melds.some((x) => x.type === 'chi')) {
    const concealedTriplets = counts.filter((v) => v >= 3).length + melds.filter((x) => x.type !== 'chi' && x.concealed).length;
    const extra = base + (concealedTriplets >= 2 ? 2 : 0);
    push(MCR_ROUTE.ALL_PUNGS, calculatePungsShanten(counts, m), 6 + extra);
    for (const h of valuableHonorKinds(roles)) {
      if (counts[h] !== 2 || m >= 4) continue;
      const c = counts.slice(); c[h] = 0;
      push(MCR_ROUTE.ALL_PUNGS_HONOR, calculatePungsShanten(c, m + 1) + 1, 6 + honorPoints(h, roles) + extra, { honor: h });
    }
  }

  // Closed special shapes.
  if (m === 0) {
    const pairs = Math.min(7, counts.reduce((a, v) => a + Math.floor(v / 2), 0));
    push(MCR_ROUTE.SEVEN_PAIRS, 6 - pairs, 24 + 2);
    const th = TERMINAL_HONOR_KINDS.filter((k) => counts[k] > 0).length;
    push(MCR_ROUTE.THIRTEEN_ORPHANS, 13 - th - (TERMINAL_HONOR_KINDS.some((k) => counts[k] >= 2) ? 1 : 0), 88);
    const honors = HONOR_KINDS.filter((k) => counts[k] > 0).length;
    for (const a of KNITTED_ARRANGEMENTS) {
      const knitted = a.kinds.filter((k) => counts[k] > 0).length;
      push(MCR_ROUTE.HONORS_KNITTED, 13 - Math.min(13, honors + knitted), 12);
    }
  }
  if (m <= 1) {
    for (const a of KNITTED_ARRANGEMENTS) {
      const c = counts.slice(); let missing = 0;
      for (const k of a.kinds) { if (c[k] > 0) c[k]--; else missing++; }
      const extra = 1 - m;
      push(MCR_ROUTE.KNITTED_STRAIGHT, missing + restNeed(c, extra) - 1, 12 + (closed ? 2 : 0));
    }
  }

  for (const r of routes) r.qualifies = r.points >= MCR_MINIMUM;
  const qualifying = routes.filter((r) => r.qualifies);
  const pool = qualifying.length ? qualifying : routes;
  const best = pool.reduce((a, b) => (b.shanten < a.shanten || (b.shanten === a.shanten && b.points > a.points) ? b : a));
  return { valueShanten: qualifying.length ? best.shanten : best.shanten + UNQUALIFIED_PENALTY, best, routes };
}

/**
 * Waiting kinds of a 13 − 3m hand by every MCR shape (standard, Seven Pairs,
 * Thirteen Orphans, Honors and Knitted, Knitted Straight).
 * @returns {number[]}
 */
export function mcrWaitKinds(counts, meldCount = 0) {
  return findWaits(counts, meldCount);
}

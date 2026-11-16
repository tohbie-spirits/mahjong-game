/**
 * HandValuePlanner.js
 *
 * Task 78b: hand-VALUE awareness for the Advanced AI.
 *
 * Tasks 73–77 measure how far a hand is from ANY complete shape. Under Hong
 * Kong's minimum fan (3 by default) that is not enough: a complete Chicken
 * Hand cannot be declared. This module measures VALUE SHANTEN — how far the
 * hand is from a complete hand that is GUARANTEED to reach the minimum fan —
 * by checking a few scoring ROUTES and taking the fastest one that qualifies.
 *
 * Routes (fan values follow HongKongScoring.js):
 *
 *   PLAIN        any shape. Guaranteed fan = valuable honour pungs already
 *                held (melded or concealed triplets) + Concealed Hand (1) while
 *                no meld is exposed. Qualifies only when that already reaches
 *                the minimum.
 *   HONOR_PUNG   finish a PAIR of a valuable honour (a dragon, the seat wind,
 *                the prevailing wind) as a pung: +1 fan per matching role.
 *                Shanten = shape shanten with that pair treated as a set
 *                needing one more tile. One route per eligible pair.
 *   FLUSH        one numbered suit + honours (Mixed One Suit, 3 fan; 7 if no
 *                honours). Off-suit tiles are junk to exchange. Impossible if
 *                an exposed meld is in another numbered suit.
 *   ALL_PUNGS    every set a pung (3 fan). Impossible after an exposed chow.
 *
 * Each route's fan also includes the guaranteed fan above (honour pungs,
 * concealed). Self-drawn (1) is never assumed — it can't be planned — but the
 * Advanced strategy checks real waits at tenpai with the actual rule engine,
 * where a self-draw-only win is still recognised.
 *
 * Everything here works on the same 34-slot kind counts as Tasks 73–77 and
 * is pure. Melds are described as { type: 'chi'|'pon'|'kong', kinds: number[],
 * concealed: boolean }.
 */

import { TILE_KIND_COUNT, HONOR_START, SUIT_SIZE, calculateShantenUnchecked, calculatePungsShanten } from './HandEfficiencyEvaluator.js';

export const ROUTE = Object.freeze({
  PLAIN: 'plain',
  HONOR_PUNG: 'honor-pung',
  FLUSH: 'flush',
  ALL_PUNGS: 'all-pungs',
});

/** Fan values the routes rely on (HongKongScoring.js). */
export const ROUTE_FAN = Object.freeze({
  concealed: 1,
  honorRole: 1,   // per role: dragon, seat wind, prevailing wind
  mixedOneSuit: 3,
  pureOneSuit: 7,
  allPungs: 3,
});

const DRAGON_KINDS = Object.freeze([31, 32, 33]);

/** Unqualified routes are ranked after every qualifying one by this much. */
const UNQUALIFIED_PENALTY = 3;

/**
 * Fan a pung of honour `kind` is worth for this seat (0 for an ordinary wind).
 * @param {number} kind
 * @param {{ seatWindIndex?: number|null, roundWindIndex?: number|null }} roles
 */
export function honorPungFan(kind, { seatWindIndex = null, roundWindIndex = null } = {}) {
  let fan = 0;
  if (DRAGON_KINDS.includes(kind)) fan += ROUTE_FAN.honorRole;
  if (kind === seatWindIndex) fan += ROUTE_FAN.honorRole;
  if (kind === roundWindIndex) fan += ROUTE_FAN.honorRole;
  return fan;
}

/** @private */
function _validate(counts, melds, options) {
  if (!Array.isArray(counts) || counts.length !== TILE_KIND_COUNT) throw new TypeError('[HandValuePlanner] counts must be a 34-slot array.');
  if (!Array.isArray(melds)) throw new TypeError('[HandValuePlanner] melds must be an array.');
  for (const m of melds) {
    if (!m || !['chi', 'pon', 'kong'].includes(m.type) || !Array.isArray(m.kinds)) {
      throw new TypeError('[HandValuePlanner] each meld needs { type: chi|pon|kong, kinds: number[] }.');
    }
  }
  const min = options.minimumFan ?? 0;
  if (!Number.isInteger(min) || min < 0) throw new TypeError('[HandValuePlanner] minimumFan must be a non-negative integer.');
}

/**
 * Fan that is already certain: valuable honour pungs (exposed or concealed
 * melds, plus concealed triplets in hand) and Concealed Hand.
 */
export function guaranteedFan(counts, melds, roles = {}) {
  let fan = 0;
  for (const m of melds) {
    if (m.type !== 'chi') fan += honorPungFan(m.kinds[0], roles);
  }
  for (let k = HONOR_START; k < TILE_KIND_COUNT; k++) {
    if (counts[k] >= 3) fan += honorPungFan(k, roles);
  }
  if (melds.every((m) => m.concealed)) fan += ROUTE_FAN.concealed;
  return fan;
}

/**
 * Evaluates every route for a hand.
 *
 * @param {number[]} counts  concealed kind counts (any size up to 14 − 3m)
 * @param {{type: string, kinds: number[], concealed: boolean}[]} melds
 * @param {Object} [options]
 * @param {number} [options.minimumFan=0]
 * @param {number|null} [options.seatWindIndex]   27–30
 * @param {number|null} [options.roundWindIndex]  27–30
 * @returns {{
 *   valueShanten: number,
 *   best: { route: string, shanten: number, fan: number, qualifies: boolean, suit?: number, honor?: number } | null,
 *   routes: { route: string, shanten: number, fan: number, qualifies: boolean, suit?: number, honor?: number }[]
 * }}
 *   valueShanten — the fastest qualifying route's shanten; if none qualifies,
 *   the fastest route + UNQUALIFIED_PENALTY.
 */
export function analyzeValueRoutes(counts, melds = [], options = {}) {
  _validate(counts, melds, options);
  const minimumFan = options.minimumFan ?? 0;
  const roles = { seatWindIndex: options.seatWindIndex ?? null, roundWindIndex: options.roundWindIndex ?? null };
  const meldCount = melds.length;
  const base = guaranteedFan(counts, melds, roles);
  const routes = [];

  // PLAIN
  routes.push({ route: ROUTE.PLAIN, shanten: calculateShantenUnchecked(counts, meldCount), fan: base });

  // HONOR_PUNG — finish a valuable honour pair.
  for (let k = HONOR_START; k < TILE_KIND_COUNT; k++) {
    const gain = honorPungFan(k, roles);
    if (gain === 0 || counts[k] !== 2 || meldCount >= 4) continue;
    const total = counts.reduce((a, b) => a + b, 0);
    if (total - 2 > 14 - 3 * (meldCount + 1)) continue; // only meaningful for waiting hands
    const c = counts.slice();
    c[k] = 0;
    routes.push({ route: ROUTE.HONOR_PUNG, honor: k, shanten: calculateShantenUnchecked(c, meldCount + 1) + 1, fan: base + gain });
  }

  // FLUSH — per numbered suit.
  for (let suit = 0; suit < 3; suit++) {
    const lo = suit * SUIT_SIZE; const hi = lo + SUIT_SIZE;
    const offSuitMeld = melds.some((m) => m.kinds.some((k) => k < HONOR_START && (k < lo || k >= hi)));
    if (offSuitMeld) continue;
    const c = counts.map((n, k) => (k < HONOR_START && (k < lo || k >= hi) ? 0 : n));
    // Mixed One Suit (3) is what the route guarantees; Pure One Suit (7) is a
    // bonus the scorer finds if no honours end up in the hand.
    routes.push({ route: ROUTE.FLUSH, suit, shanten: calculateShantenUnchecked(c, meldCount), fan: base + ROUTE_FAN.mixedOneSuit });
  }

  // ALL_PUNGS
  if (!melds.some((m) => m.type === 'chi')) {
    routes.push({ route: ROUTE.ALL_PUNGS, shanten: calculatePungsShanten(counts, meldCount), fan: base + ROUTE_FAN.allPungs });
  }

  for (const r of routes) r.qualifies = r.fan >= minimumFan;
  const qualifying = routes.filter((r) => r.qualifies);
  const pool = qualifying.length ? qualifying : routes;
  const best = pool.reduce((a, b) => (b.shanten < a.shanten || (b.shanten === a.shanten && b.fan > a.fan) ? b : a));
  const valueShanten = qualifying.length ? best.shanten : best.shanten + UNQUALIFIED_PENALTY;
  return { valueShanten, best, routes };
}

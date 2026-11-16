/**
 * HandEfficiencyEvaluator.js
 *
 * Task 73: shanten / tile-efficiency calculation — the analytical core the
 * Advanced AI (Tasks 74–80) builds on.
 *
 *   - SHANTEN: how many tile exchanges a hand is away from tenpai.
 *       -1 = already a complete winning shape
 *        0 = tenpai (one tile from winning)
 *        n = n useful exchanges away from tenpai
 *   - UKEIRE ("acceptance"): which tile kinds would lower the shanten if
 *     drawn, and how many copies of each are still unseen.
 *   - DISCARD EVALUATION: for a hand that has just drawn (3n+2 tiles), the
 *     shanten and ukeire left after each possible discard, ranked best-first.
 *
 * REPRESENTATION — deliberately Tile-agnostic.
 * Everything here works on a 34-slot COUNT ARRAY (one slot per tile kind,
 * value 0–4), never on Tile instances:
 *
 *     index  0– 8   suit A, ranks 1–9
 *     index  9–17   suit B, ranks 1–9
 *     index 18–26   suit C, ranks 1–9
 *     index 27–33   honours (4 winds + 3 dragons; order within is irrelevant
 *                   to shanten — honours only ever form pairs/triplets)
 *
 * Which real suit is "A", "B" or "C" doesn't matter to the maths, only that
 * each suit's ranks 1–9 occupy consecutive slots. Bonus tiles (flowers /
 * seasons) are never part of a hand's shape and must not be counted.
 *
 * Why no Tile.js import: this module was built without access to Tile.js /
 * constants.js (the Task 73 session only had the persistence/UI files), so
 * the Tile → index mapping is INJECTED via `countsFromTiles(tiles,
 * tileToIndex)` rather than guessed. Task 74 (AdvancedStrategy.js) owns that
 * one small adapter, written against the real Tile API. Keeping the evaluator
 * on plain counts is also what makes it ruleset-agnostic and fast: Riichi
 * and Chinese Official reuse it unchanged.
 *
 * Ruleset differences are OPT-IN via options, never assumed:
 *   - `meldCount`            — open (or declared) melds already on the table;
 *                              each removes one set from what the concealed
 *                              tiles still need to form.
 *   - `allowSevenPairs`      — also consider the Seven Pairs shape
 *                              (concealed hands only).
 *   - `allowThirteenOrphans` — also consider Thirteen Orphans
 *                              (concealed hands only).
 *   The default (both false) is the standard "4 sets + 1 pair" shape only,
 *   which every supported ruleset accepts. Whether Hong Kong's own
 *   HongKongRules.js accepts the special shapes is the caller's call.
 *
 * Known, documented simplification: shanten counts shapes, not physical
 * availability. A hand holding all four copies of a tile can treat that tile
 * as a partial wait even though no fifth copy exists (the classic "phantom
 * wait" case). UKEIRE, by contrast, always reports real availability (never
 * more than 4 minus what's held/seen), so evaluateDiscards() ranking — which
 * uses ukeire as the tie-breaker — never prefers a dead wait.
 *
 * Public API (all pure functions, no state, inputs never mutated):
 *   TILE_KIND_COUNT, HONOR_START, SUIT_SIZE
 *   isHonorIndex(i), isTerminalIndex(i), isTerminalOrHonorIndex(i)
 *   createEmptyCounts()
 *   countsFromIndices(indices)
 *   countsFromTiles(tiles, tileToIndex)
 *   calculateShanten(counts, options)          → number
 *   calculateShantenBreakdown(counts, options) → { shanten, regular, sevenPairs, thirteenOrphans }
 *   calculateUkeire(counts, options)           → { shanten, tiles: [{index, remaining}], total }
 *   evaluateDiscards(counts, options)          → [{ discardIndex, shanten, ukeire, ukeireTiles }]
 */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Number of distinct tile kinds (3 suits × 9 + 7 honours). */
export const TILE_KIND_COUNT = 34;

/** First honour index; indices below this are suited. */
export const HONOR_START = 27;

/** Ranks per suit. */
export const SUIT_SIZE = 9;

/** Maximum copies of any one tile kind. */
const MAX_COPIES = 4;

/** Indices of every terminal (1/9) and honour — the 13 Thirteen Orphans kinds. */
const TERMINAL_HONOR_INDICES = Object.freeze([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

/** @param {number} i @returns {boolean} */
export function isHonorIndex(i) {
  return Number.isInteger(i) && i >= HONOR_START && i < TILE_KIND_COUNT;
}

/** Suited 1 or 9. @param {number} i @returns {boolean} */
export function isTerminalIndex(i) {
  if (!Number.isInteger(i) || i < 0 || i >= HONOR_START) return false;
  const rank = (i % SUIT_SIZE) + 1;
  return rank === 1 || rank === 9;
}

/** @param {number} i @returns {boolean} */
export function isTerminalOrHonorIndex(i) {
  return isTerminalIndex(i) || isHonorIndex(i);
}

// ---------------------------------------------------------------------------
// Count-array construction
// ---------------------------------------------------------------------------

/** @returns {number[]} a fresh 34-slot array of zeros */
export function createEmptyCounts() {
  return new Array(TILE_KIND_COUNT).fill(0);
}

/**
 * Builds a count array from a list of tile-kind indices.
 * @param {number[]} indices
 * @returns {number[]}
 * @throws {TypeError} on a non-array or an out-of-range index;
 *         {RangeError} when any kind exceeds 4 copies.
 */
export function countsFromIndices(indices) {
  if (!Array.isArray(indices)) {
    throw new TypeError('[HandEfficiencyEvaluator] countsFromIndices requires an array of tile-kind indices.');
  }
  const counts = createEmptyCounts();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= TILE_KIND_COUNT) {
      throw new TypeError(`[HandEfficiencyEvaluator] invalid tile-kind index: ${i}`);
    }
    counts[i] += 1;
    if (counts[i] > MAX_COPIES) {
      throw new RangeError(`[HandEfficiencyEvaluator] more than ${MAX_COPIES} copies of tile kind ${i}.`);
    }
  }
  return counts;
}

/**
 * Builds a count array from real tile objects via an injected mapping.
 * `tileToIndex(tile)` must return an index 0–33, or `null`/`undefined` for a
 * tile that isn't part of the hand's shape (bonus flowers/seasons) — those
 * are skipped.
 *
 * @param {Iterable<*>} tiles
 * @param {function(*): (number|null|undefined)} tileToIndex
 * @returns {number[]}
 */
export function countsFromTiles(tiles, tileToIndex) {
  if (typeof tileToIndex !== 'function') {
    throw new TypeError('[HandEfficiencyEvaluator] countsFromTiles requires a tileToIndex(tile) function.');
  }
  if (tiles == null || typeof tiles[Symbol.iterator] !== 'function') {
    throw new TypeError('[HandEfficiencyEvaluator] countsFromTiles requires an iterable of tiles.');
  }
  const indices = [];
  for (const tile of tiles) {
    const idx = tileToIndex(tile);
    if (idx === null || idx === undefined) continue;
    indices.push(idx);
  }
  return countsFromIndices(indices);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @private */
function _assertCounts(counts, fnName) {
  if (!Array.isArray(counts) || counts.length !== TILE_KIND_COUNT) {
    throw new TypeError(`[HandEfficiencyEvaluator] ${fnName} requires a ${TILE_KIND_COUNT}-slot count array.`);
  }
  let total = 0;
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    const c = counts[i];
    if (!Number.isInteger(c) || c < 0 || c > MAX_COPIES) {
      throw new TypeError(`[HandEfficiencyEvaluator] ${fnName}: counts[${i}] must be an integer 0–${MAX_COPIES}; got ${c}.`);
    }
    total += c;
  }
  return total;
}

/** @private */
function _normalizeOptions(options, fnName) {
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new TypeError(`[HandEfficiencyEvaluator] ${fnName} options must be an object when supplied.`);
  }
  const o = options ?? {};
  const meldCount = o.meldCount === undefined ? 0 : o.meldCount;
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) {
    throw new TypeError(`[HandEfficiencyEvaluator] ${fnName}: meldCount must be an integer 0–4; got ${meldCount}.`);
  }
  return {
    meldCount,
    allowSevenPairs: o.allowSevenPairs === true,
    allowThirteenOrphans: o.allowThirteenOrphans === true,
    visibleCounts: o.visibleCounts,
  };
}

/**
 * Checks the concealed tile total matches the meld count: 13 − 3m (waiting)
 * or 14 − 3m (just drew). Anything else can't be a real hand.
 * @private
 */
function _assertHandSize(total, meldCount, fnName, allowed) {
  const base = 3 * (4 - meldCount);
  const ok = allowed.some((extra) => total === base + extra);
  if (!ok) {
    const sizes = allowed.map((e) => base + e).join(' or ');
    throw new RangeError(
      `[HandEfficiencyEvaluator] ${fnName}: expected ${sizes} concealed tiles for meldCount ${meldCount}; got ${total}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Shanten
// ---------------------------------------------------------------------------

/**
 * Standard-shape shanten: concealed tiles must form (4 − meldCount) sets plus
 * one pair. Depth-first decomposition into sets (triplet/sequence), partial
 * sets (pair/adjacent/gapped) and a designated pair, scored by
 *   shanten = 2·setsNeeded − 2·sets − min(partials, setsNeeded − sets) − pair
 * where partials beyond the free set slots don't count.
 * @private
 */
/**
 * Task 119: _regularShanten is pure and the Advanced AI asks it the same
 * question many times per decision (discard A then draw B is the same hand
 * as discard B then draw A; a hint, a claim check and the next turn revisit
 * the same hands). A bounded memo — results are identical, only faster.
 */
const SHANTEN_MEMO = new Map();
const SHANTEN_MEMO_MAX = 50000;
const _memoStats = { hits: 0, misses: 0 };
/** Task 119: memo statistics (tests / benchmarks). */
export function getShantenMemoStats() { return { ..._memoStats, size: SHANTEN_MEMO.size }; }
/** Task 119: empties the memo (tests / benchmarks). */
export function clearShantenMemo() { SHANTEN_MEMO.clear(); _memoStats.hits = 0; _memoStats.misses = 0; }

function _regularShanten(counts, meldCount) {
  let key = String.fromCharCode(48 + meldCount);
  for (let i = 0; i < TILE_KIND_COUNT; i++) key += String.fromCharCode(48 + counts[i]);
  const known = SHANTEN_MEMO.get(key);
  if (known !== undefined) { _memoStats.hits++; return known; }
  _memoStats.misses++;
  const result = _regularShantenBySuit(counts, meldCount);
  if (SHANTEN_MEMO.size >= SHANTEN_MEMO_MAX) SHANTEN_MEMO.clear(); // simple bound: start over
  SHANTEN_MEMO.set(key, result);
  return result;
}

/**
 * Task 119: the same shanten, computed suit by suit. Blocks never cross a
 * suit (or the honours), and the score below couples the suits only through
 * three totals — sets (capped at setsNeeded), partial sets, and at most one
 * designated pair — so each group's achievable (sets, partials, pair) tuples
 * are enumerated once (memoized by that group's counts), dominated tuples
 * dropped (more sets / more partials never raise the score), and the groups
 * combined. Exactly equal to the whole-hand search (_regularShantenReference;
 * tests/ai/performance.test.mjs checks it on hundreds of thousands of hands).
 * @private
 */
const GROUP_MEMO = new Map();
const GROUP_MEMO_MAX = 20000;

function _groupOptions(counts, start, len, suited) {
  let key = suited ? 's' : 'h';
  for (let i = 0; i < len; i++) key += String.fromCharCode(48 + counts[start + i]);
  const known = GROUP_MEMO.get(key);
  if (known) return known;
  const c = counts.slice(start, start + len);
  const found = new Map(); // "sets,partials,pair" → tuple
  function dfs(i, sets, partials, pair) {
    while (i < len && c[i] === 0) i++;
    if (i >= len) { const k = `${sets},${partials},${pair}`; if (!found.has(k)) found.set(k, [sets, partials, pair]); return; }
    if (c[i] >= 3) { c[i] -= 3; dfs(i, sets + 1, partials, pair); c[i] += 3; }
    if (suited && i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) { c[i]--; c[i + 1]--; c[i + 2]--; dfs(i, sets + 1, partials, pair); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2 && pair === 0) { c[i] -= 2; dfs(i, sets, partials, 1); c[i] += 2; }
    if (c[i] >= 2) { c[i] -= 2; dfs(i, sets, partials + 1, pair); c[i] += 2; }
    if (suited && i <= 7 && c[i + 1] > 0) { c[i]--; c[i + 1]--; dfs(i, sets, partials + 1, pair); c[i]++; c[i + 1]++; }
    if (suited && i <= 6 && c[i + 2] > 0) { c[i]--; c[i + 2]--; dfs(i, sets, partials + 1, pair); c[i]++; c[i + 2]++; }
    c[i]--; dfs(i, sets, partials, pair); c[i]++;
  }
  dfs(0, 0, 0, 0);
  const all = [...found.values()];
  const kept = all.filter((a) => !all.some((b) => b !== a && b[2] === a[2] && b[0] >= a[0] && b[1] >= a[1] && (b[0] > a[0] || b[1] > a[1])));
  if (GROUP_MEMO.size >= GROUP_MEMO_MAX) GROUP_MEMO.clear();
  GROUP_MEMO.set(key, kept);
  return kept;
}

function _regularShantenBySuit(counts, meldCount) {
  const setsNeeded = 4 - meldCount;
  const groups = [
    _groupOptions(counts, 0, SUIT_SIZE, true),
    _groupOptions(counts, SUIT_SIZE, SUIT_SIZE, true),
    _groupOptions(counts, 2 * SUIT_SIZE, SUIT_SIZE, true),
    _groupOptions(counts, HONOR_START, TILE_KIND_COUNT - HONOR_START, false),
  ];
  let best = 2 * setsNeeded;
  for (const a of groups[0]) for (const b of groups[1]) {
    if (a[2] + b[2] > 1) continue;
    for (const d of groups[2]) {
      if (a[2] + b[2] + d[2] > 1) continue;
      for (const h of groups[3]) {
        const pair = a[2] + b[2] + d[2] + h[2];
        if (pair > 1) continue;
        const sets = Math.min(setsNeeded, a[0] + b[0] + d[0] + h[0]);
        const partials = a[1] + b[1] + d[1] + h[1];
        const sc = 2 * setsNeeded - 2 * sets - Math.min(partials, setsNeeded - sets) - pair;
        if (sc < best) best = sc;
      }
    }
  }
  return best;
}

/** Task 119: the original whole-hand search, kept as the reference the suit-by-suit version is tested against. */
export function _regularShantenReference(counts, meldCount = 0) { return _regularShantenUncached(counts, meldCount); }

function _regularShantenUncached(counts, meldCount) {
  const c = counts.slice();
  const setsNeeded = 4 - meldCount;
  let best = 2 * setsNeeded; // worst possible (no blocks, no pair)

  const score = (sets, partials, pair) =>
    2 * setsNeeded - 2 * sets - Math.min(partials, setsNeeded - sets) - pair;

  function dfs(i, sets, partials, pair) {
    while (i < TILE_KIND_COUNT && c[i] === 0) i++;
    if (i >= TILE_KIND_COUNT) {
      const s = score(sets, partials, pair);
      if (s < best) best = s;
      return;
    }
    // A complete decomposition (−1) can't be improved on — stop searching.
    if (best === -1) return;

    const suited = i < HONOR_START;
    const rank = i % SUIT_SIZE; // 0-based within suit (only meaningful when suited)

    // Triplet.
    if (c[i] >= 3 && sets < setsNeeded) {
      c[i] -= 3;
      dfs(i, sets + 1, partials, pair);
      c[i] += 3;
    }
    // Sequence.
    if (suited && rank <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && sets < setsNeeded) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      dfs(i, sets + 1, partials, pair);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    // Designated pair.
    if (c[i] >= 2 && pair === 0) {
      c[i] -= 2;
      dfs(i, sets, partials, 1);
      c[i] += 2;
    }
    // Pair as a partial set (future triplet).
    if (c[i] >= 2) {
      c[i] -= 2;
      dfs(i, sets, partials + 1, pair);
      c[i] += 2;
    }
    // Adjacent partial (e.g. 3-4).
    if (suited && rank <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--;
      dfs(i, sets, partials + 1, pair);
      c[i]++; c[i + 1]++;
    }
    // Gapped partial (e.g. 3-5).
    if (suited && rank <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--;
      dfs(i, sets, partials + 1, pair);
      c[i]++; c[i + 2]++;
    }
    // Leave one copy of this kind isolated.
    c[i]--;
    dfs(i, sets, partials, pair);
    c[i]++;
  }

  dfs(0, 0, 0, 0);
  return best;
}

/** Seven Pairs shanten (concealed only). Duplicate pairs don't count twice. @private */
function _sevenPairsShanten(counts) {
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    if (counts[i] > 0) kinds++;
    if (counts[i] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** Thirteen Orphans shanten (concealed only). @private */
function _thirteenOrphansShanten(counts) {
  let kinds = 0;
  let hasPair = false;
  for (const i of TERMINAL_HONOR_INDICES) {
    if (counts[i] > 0) kinds++;
    if (counts[i] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/**
 * Shanten per shape plus the overall minimum. Special shapes are `null` when
 * disabled by options or impossible (any open meld).
 *
 * @param {number[]} counts  34-slot count array, 13−3m or 14−3m tiles
 * @param {Object}  [options]
 * @param {number}  [options.meldCount=0]
 * @param {boolean} [options.allowSevenPairs=false]
 * @param {boolean} [options.allowThirteenOrphans=false]
 * @returns {{ shanten: number, regular: number, sevenPairs: number|null, thirteenOrphans: number|null }}
 */
export function calculateShantenBreakdown(counts, options) {
  const fnName = 'calculateShanten';
  const total = _assertCounts(counts, fnName);
  const opts = _normalizeOptions(options, fnName);
  _assertHandSize(total, opts.meldCount, fnName, [1, 2]);

  const regular = _regularShanten(counts, opts.meldCount);
  const concealedOnly = opts.meldCount === 0;
  const sevenPairs = opts.allowSevenPairs && concealedOnly ? _sevenPairsShanten(counts) : null;
  const thirteenOrphans = opts.allowThirteenOrphans && concealedOnly ? _thirteenOrphansShanten(counts) : null;

  let shanten = regular;
  if (sevenPairs !== null && sevenPairs < shanten) shanten = sevenPairs;
  if (thirteenOrphans !== null && thirteenOrphans < shanten) shanten = thirteenOrphans;

  return { shanten, regular, sevenPairs, thirteenOrphans };
}

/**
 * Task 78b: regular-shape shanten WITHOUT the hand-size check, for
 * route-constrained evaluation. Removing tiles from `counts` is how a caller
 * says "these tiles are useless on this route" (e.g. off-suit tiles for a
 * flush): the formula only counts the blocks that remain, so the result is
 * the route's shanten with the removed tiles treated as junk to exchange.
 * @param {number[]} counts  34-slot counts, at most 14 − 3·meldCount tiles
 * @param {number} [meldCount=0]
 * @returns {number}
 */
export function calculateShantenUnchecked(counts, meldCount = 0) {
  const total = _assertCounts(counts, 'calculateShantenUnchecked');
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) {
    throw new TypeError(`[HandEfficiencyEvaluator] calculateShantenUnchecked: meldCount must be 0–4; got ${meldCount}.`);
  }
  if (total > 14 - 3 * meldCount) {
    throw new RangeError(`[HandEfficiencyEvaluator] calculateShantenUnchecked: ${total} tiles exceed ${14 - 3 * meldCount}.`);
  }
  return _regularShanten(counts, meldCount);
}

/**
 * Task 78b: shanten when every set must be a pung (the All Pungs route).
 * Triplets are complete sets, pairs are the eyes or half-built pungs; nothing
 * else helps. Same hand-size rule as calculateShantenUnchecked.
 * @param {number[]} counts
 * @param {number} [meldCount=0]  existing melds (all must be pungs/kongs on this route)
 * @returns {number}
 */
export function calculatePungsShanten(counts, meldCount = 0) {
  const total = _assertCounts(counts, 'calculatePungsShanten');
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) {
    throw new TypeError(`[HandEfficiencyEvaluator] calculatePungsShanten: meldCount must be 0–4; got ${meldCount}.`);
  }
  if (total > 14 - 3 * meldCount) {
    throw new RangeError(`[HandEfficiencyEvaluator] calculatePungsShanten: ${total} tiles exceed ${14 - 3 * meldCount}.`);
  }
  const need = 4 - meldCount;
  let triplets = 0; let pairs = 0;
  for (const c of counts) {
    if (c >= 3) triplets++;
    else if (c === 2) pairs++;
  }
  triplets = Math.min(triplets, need);
  const eye = pairs > 0 ? 1 : 0;
  const partials = Math.min(pairs - eye, need - triplets);
  return 2 * (need - triplets) - partials - eye;
}

/**
 * Minimum shanten across the enabled shapes.
 * @param {number[]} counts
 * @param {Object} [options] — see calculateShantenBreakdown
 * @returns {number} −1 complete, 0 tenpai, n ≥ 1 otherwise
 */
export function calculateShanten(counts, options) {
  return calculateShantenBreakdown(counts, options).shanten;
}

// ---------------------------------------------------------------------------
// Ukeire
// ---------------------------------------------------------------------------

/** @private */
function _resolveVisible(visibleCounts, fnName) {
  if (visibleCounts === undefined) return null;
  if (!Array.isArray(visibleCounts) || visibleCounts.length !== TILE_KIND_COUNT) {
    throw new TypeError(`[HandEfficiencyEvaluator] ${fnName}: visibleCounts must be a ${TILE_KIND_COUNT}-slot array.`);
  }
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    const v = visibleCounts[i];
    if (!Number.isInteger(v) || v < 0 || v > MAX_COPIES) {
      throw new TypeError(`[HandEfficiencyEvaluator] ${fnName}: visibleCounts[${i}] must be an integer 0–${MAX_COPIES}; got ${v}.`);
    }
  }
  return visibleCounts;
}

/** Ukeire for an already-validated waiting hand. @private */
function _ukeire(counts, opts, visible, baseShanten) {
  const c = counts.slice();
  const tiles = [];
  let total = 0;
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    const remaining = MAX_COPIES - c[i] - (visible ? visible[i] : 0);
    if (remaining <= 0) continue; // nothing left to draw (also guards the 5th-copy case)
    c[i]++;
    const s = calculateShantenBreakdown(c, opts).shanten;
    c[i]--;
    if (s < baseShanten) {
      tiles.push({ index: i, remaining });
      total += remaining;
    }
  }
  return { tiles, total };
}

/**
 * Which tile kinds would lower the shanten of a WAITING hand (13 − 3m tiles),
 * and how many unseen copies of each remain.
 *
 * `remaining` = 4 − copies in this hand − `options.visibleCounts[i]`
 * (visibleCounts = every OTHER copy the player can see: discards, open melds,
 * dora indicators…; omit it to count only this hand). Kinds with nothing
 * left are excluded.
 *
 * @param {number[]} counts
 * @param {Object} [options] — calculateShanten options plus `visibleCounts`
 * @returns {{ shanten: number, tiles: {index: number, remaining: number}[], total: number }}
 */
export function calculateUkeire(counts, options) {
  const fnName = 'calculateUkeire';
  const total = _assertCounts(counts, fnName);
  const opts = _normalizeOptions(options, fnName);
  _assertHandSize(total, opts.meldCount, fnName, [1]);
  const visible = _resolveVisible(opts.visibleCounts, fnName);
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    if (visible && counts[i] + visible[i] > MAX_COPIES) {
      throw new RangeError(`[HandEfficiencyEvaluator] ${fnName}: hand + visible copies of kind ${i} exceed ${MAX_COPIES}.`);
    }
  }

  const shanten = calculateShantenBreakdown(counts, opts).shanten;
  const { tiles, total: ukeireTotal } = _ukeire(counts, opts, visible, shanten);
  return { shanten, tiles, total: ukeireTotal };
}

// ---------------------------------------------------------------------------
// Discard evaluation
// ---------------------------------------------------------------------------

/**
 * For a hand that has just drawn (14 − 3m tiles), evaluates every distinct
 * discard: the shanten left afterwards and that hand's ukeire.
 *
 * Ranked best-first: lower shanten, then more ukeire (more live copies),
 * then more distinct accepted kinds, then lower index (deterministic).
 * The caller (AdvancedStrategy, Task 74) layers its own tie-breaks and
 * defence (Task 77) on top; this function never picks randomly.
 *
 * @param {number[]} counts
 * @param {Object} [options] — calculateShanten options plus `visibleCounts`
 * @returns {{ discardIndex: number, shanten: number, ukeire: number, ukeireTiles: {index: number, remaining: number}[] }[]}
 */
export function evaluateDiscards(counts, options) {
  const fnName = 'evaluateDiscards';
  const total = _assertCounts(counts, fnName);
  const opts = _normalizeOptions(options, fnName);
  _assertHandSize(total, opts.meldCount, fnName, [2]);
  const visible = _resolveVisible(opts.visibleCounts, fnName);
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    // After discarding, the discarded copy becomes visible too, so allow
    // hand + visible to be at most 4 per kind.
    if (visible && counts[i] + visible[i] > MAX_COPIES) {
      throw new RangeError(`[HandEfficiencyEvaluator] ${fnName}: hand + visible copies of kind ${i} exceed ${MAX_COPIES}.`);
    }
  }

  const c = counts.slice();
  const results = [];
  for (let i = 0; i < TILE_KIND_COUNT; i++) {
    if (c[i] === 0) continue;
    c[i]--;
    // The discarded tile is now visible to everyone, including this player.
    const afterVisible = visible ? visible.slice() : createEmptyCounts();
    afterVisible[i] += 1;
    const shanten = calculateShantenBreakdown(c, opts).shanten;
    const { tiles, total: ukeire } = _ukeire(c, opts, afterVisible, shanten);
    results.push({ discardIndex: i, shanten, ukeire, ukeireTiles: tiles });
    c[i]++;
  }

  results.sort(
    (a, b) =>
      a.shanten - b.shanten ||
      b.ukeire - a.ukeire ||
      b.ukeireTiles.length - a.ukeireTiles.length ||
      a.discardIndex - b.discardIndex
  );
  return results;
}

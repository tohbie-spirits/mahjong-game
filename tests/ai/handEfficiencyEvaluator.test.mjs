/**
 * handEfficiencyEvaluator.test.mjs
 *
 * Task 73 — HandEfficiencyEvaluator.js (shanten / tile efficiency).
 *
 * Sections:
 *   1.  Index helpers + constants
 *   2.  countsFromIndices / countsFromTiles (+ validation)
 *   3.  Input validation (count arrays, options, hand sizes)
 *   4.  Shanten — hand-built regular-shape cases
 *   5.  Shanten — open melds (meldCount)
 *   6.  Shanten — Seven Pairs / Thirteen Orphans (opt-in, concealed only)
 *   7.  Ukeire — waits, remaining counts, visibleCounts, exhausted kinds
 *   8.  evaluateDiscards — ranking, determinism, discarded copy counted as seen
 *   9.  Inputs never mutated
 *  10.  Brute-force cross-check vs an INDEPENDENT complete-hand checker:
 *       −1 ⇔ complete; 0 ⇔ some draw completes; 1 ⇔ some swap reaches tenpai
 *  11.  Consistency: drawing an accepted tile + best discard lowers shanten by 1
 *  12.  Performance sanity
 *
 * Tile-kind index layout: 0–8 suit A (1–9), 9–17 suit B, 18–26 suit C,
 * 27–33 honours. Helper `h('123a 456b 55c EE')` builds hands readably:
 * digits followed by a suit letter a/b/c, or honour letters E S W N R G H.
 *
 * Run with:
 *   node tests/ai/handEfficiencyEvaluator.test.mjs
 */

import {
  TILE_KIND_COUNT,
  HONOR_START,
  SUIT_SIZE,
  isHonorIndex,
  isTerminalIndex,
  isTerminalOrHonorIndex,
  createEmptyCounts,
  countsFromIndices,
  countsFromTiles,
  calculateShanten,
  calculateShantenBreakdown,
  calculateUkeire,
  evaluateDiscards,
} from '../../src/ai/advanced/HandEfficiencyEvaluator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUIT_OFFSET = { a: 0, b: 9, c: 18 };
const HONOR_INDEX = { E: 27, S: 28, W: 29, N: 30, R: 31, G: 32, H: 33 };

/** Parses 'h("123a 456b 55c EE")' into tile-kind indices. */
function idx(spec) {
  const out = [];
  for (const group of spec.trim().split(/\s+/)) {
    if (/^[ESWNRGH]+$/.test(group)) {
      for (const ch of group) out.push(HONOR_INDEX[ch]);
      continue;
    }
    const m = group.match(/^(\d+)([abc])$/);
    if (!m) throw new Error(`bad group ${group}`);
    for (const d of m[1]) out.push(SUIT_OFFSET[m[2]] + Number(d) - 1);
  }
  return out;
}
const h = (spec) => countsFromIndices(idx(spec));
const kind = (spec) => idx(spec)[0];

let passed = 0;
let failed = 0;
const failures = [];
let currentSection = '';

function section(name, fn) {
  currentSection = name;
  console.log(`\n▸ ${name}`);
  return fn();
}
function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(`[${currentSection}] ${message}`); console.error(`  ✗ FAIL: ${message}`); }
}
function assertThrows(fn, expectedType, message) {
  let threw = false; let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) assert(false, `${message} — expected throw, nothing thrown`);
  else if (expectedType && !(err instanceof expectedType)) assert(false, `${message} — wrong error type: ${err?.constructor?.name}`);
  else assert(true, message);
}

// ---------------------------------------------------------------------------
// Independent reference: is a count array a complete standard-shape hand?
// (sets + one pair; written separately from the evaluator's DFS on purpose)
// ---------------------------------------------------------------------------

function refIsComplete(counts, setsNeeded) {
  const c = counts.slice();
  const total = c.reduce((a, b) => a + b, 0);
  if (total !== 3 * setsNeeded + 2) return false;
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    if (refAllSets(c)) { c[p] += 2; return true; }
    c[p] += 2;
  }
  return false;
}
function refAllSets(c) {
  let i = 0;
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = refAllSets(c);
    c[i] += 3;
    if (ok) return true;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = refAllSets(c);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}
/** Shape-based tenpai (adding any kind, even a 5th copy — matching shanten's shape semantics). */
function refIsTenpai(counts, setsNeeded) {
  const c = counts.slice();
  for (let t = 0; t < 34; t++) {
    c[t]++;
    const ok = refIsComplete(c, setsNeeded);
    c[t]--;
    if (ok) return true;
  }
  return false;
}
/** Some single swap (remove one held kind, add any kind) reaches tenpai. */
function refOneSwapToTenpai(counts, setsNeeded) {
  const c = counts.slice();
  for (let r = 0; r < 34; r++) {
    if (c[r] === 0) continue;
    c[r]--;
    for (let a = 0; a < 34; a++) {
      if (a === r) continue;
      c[a]++;
      const ok = refIsTenpai(c, setsNeeded);
      c[a]--;
      if (ok) { c[r]++; return true; }
    }
    c[r]++;
  }
  return false;
}

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Random hand of `size` tiles drawn from a reduced kind pool (bias toward connected shapes). */
function randomHand(rand, size, poolKinds) {
  const pool = [];
  for (const k of poolKinds) for (let n = 0; n < 4; n++) pool.push(k);
  const counts = createEmptyCounts();
  for (let n = 0; n < size; n++) {
    const j = Math.floor(rand() * pool.length);
    counts[pool[j]]++;
    pool.splice(j, 1);
  }
  return counts;
}
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

// ---------------------------------------------------------------------------
// 1. Index helpers
// ---------------------------------------------------------------------------

section('Index helpers and constants', () => {
  assert(TILE_KIND_COUNT === 34 && HONOR_START === 27 && SUIT_SIZE === 9, 'layout constants');
  assert(isHonorIndex(27) && isHonorIndex(33) && !isHonorIndex(26) && !isHonorIndex(34), 'isHonorIndex bounds');
  assert(isTerminalIndex(0) && isTerminalIndex(8) && isTerminalIndex(9) && isTerminalIndex(26), 'suited 1s and 9s are terminals');
  assert(!isTerminalIndex(4) && !isTerminalIndex(27) && !isTerminalIndex(-1) && !isTerminalIndex(1.5), 'non-terminals rejected');
  assert(isTerminalOrHonorIndex(30) && isTerminalOrHonorIndex(17) && !isTerminalOrHonorIndex(13), 'isTerminalOrHonorIndex');
  const e = createEmptyCounts();
  assert(e.length === 34 && e.every((x) => x === 0), 'createEmptyCounts → 34 zeros');
  assert(createEmptyCounts() !== e, 'createEmptyCounts returns a fresh array');
});

// ---------------------------------------------------------------------------
// 2. Construction
// ---------------------------------------------------------------------------

section('countsFromIndices / countsFromTiles', () => {
  const c = countsFromIndices([0, 0, 33]);
  assert(c[0] === 2 && c[33] === 1 && c.reduce((a, b) => a + b) === 3, 'counts built from indices');
  assertThrows(() => countsFromIndices('0,1'), TypeError, 'non-array throws');
  assertThrows(() => countsFromIndices([34]), TypeError, 'index 34 throws');
  assertThrows(() => countsFromIndices([-1]), TypeError, 'negative index throws');
  assertThrows(() => countsFromIndices([1.5]), TypeError, 'fractional index throws');
  assertThrows(() => countsFromIndices([5, 5, 5, 5, 5]), RangeError, 'fifth copy throws RangeError');

  const tiles = [{ k: 3 }, { k: 3 }, { k: null, bonus: true }, { k: 30 }];
  const t = countsFromTiles(tiles, (tile) => tile.k);
  assert(t[3] === 2 && t[30] === 1, 'countsFromTiles maps via injected function');
  assert(t.reduce((a, b) => a + b) === 3, 'null mapping (bonus tile) skipped');
  assert(countsFromTiles(new Set([{ k: 1 }]), (x) => x.k)[1] === 1, 'accepts any iterable');
  assertThrows(() => countsFromTiles(tiles), TypeError, 'missing tileToIndex throws');
  assertThrows(() => countsFromTiles(42, (x) => x), TypeError, 'non-iterable tiles throws');
  assertThrows(() => countsFromTiles([{}], () => 99), TypeError, 'mapping to an invalid index throws');
});

// ---------------------------------------------------------------------------
// 3. Validation
// ---------------------------------------------------------------------------

section('Input validation', () => {
  const ok13 = h('123a 456a 789a 123b 5b');
  assertThrows(() => calculateShanten([1, 2, 3]), TypeError, 'short array throws');
  assertThrows(() => calculateShanten(null), TypeError, 'null counts throws');
  const bad = ok13.slice(); bad[0] = 5;
  assertThrows(() => calculateShanten(bad), TypeError, 'count of 5 throws');
  const neg = ok13.slice(); neg[0] = -1;
  assertThrows(() => calculateShanten(neg), TypeError, 'negative count throws');
  assertThrows(() => calculateShanten(h('123a 456a')), RangeError, '6 tiles with meldCount 0 throws');
  assertThrows(() => calculateShanten(ok13, { meldCount: 5 }), TypeError, 'meldCount 5 throws');
  assertThrows(() => calculateShanten(ok13, { meldCount: 1 }), RangeError, '13 tiles with meldCount 1 throws');
  assertThrows(() => calculateShanten(ok13, 'x'), TypeError, 'non-object options throws');
  assertThrows(() => calculateUkeire(h('123a 456a 789a 123b 55b')), RangeError, 'calculateUkeire rejects a 14-tile hand');
  assertThrows(() => evaluateDiscards(ok13), RangeError, 'evaluateDiscards rejects a 13-tile hand');
  assertThrows(() => calculateUkeire(ok13, { visibleCounts: [1] }), TypeError, 'bad visibleCounts shape throws');
  const vis = createEmptyCounts(); vis[0] = 4;
  assertThrows(() => calculateUkeire(ok13, { visibleCounts: vis }), RangeError, 'hand + visible > 4 throws');
});

// ---------------------------------------------------------------------------
// 4. Regular-shape shanten
// ---------------------------------------------------------------------------

section('Shanten — regular shape', () => {
  assert(calculateShanten(h('123a 456a 789a 123b 55b')) === -1, 'complete hand → −1');
  assert(calculateShanten(h('111a 222a 333a EEE 55b')) === -1, 'all-triplet complete hand → −1');
  assert(calculateShanten(h('123a 456a 789a 123b 5b')) === 0, 'single-wait tenpai → 0');
  assert(calculateShanten(h('123a 456a 789a 55b 67b')) === 0, 'two-sided wait tenpai → 0');
  assert(calculateShanten(h('1112345678999a')) === 0, 'nine-gates shape tenpai → 0');
  assert(calculateShanten(h('123a 456a 789a 5b 7b 9c E')) === 1, 'one-shanten hand → 1');
  assert(calculateShanten(h('147a 258b 369c ESWN')) === 8, 'thirteen unconnected tiles → 8 (worst case)');
  assert(calculateShanten(h('123a 456a 789a 123b 55b'.replace('55b', '5b 9c'))) === 0, '14-tile hand one off complete → 0');
  assert(calculateShanten(h('1133557799a 11b E')) === 3, 'six pairs + single, standard shape only → 3');
  assert(calculateShanten(h('EEE SSS WWW NN RG')) === 1, 'honour triplets + pair + two singles → 1');
});

// ---------------------------------------------------------------------------
// 5. Open melds
// ---------------------------------------------------------------------------

section('Shanten — open melds', () => {
  assert(calculateShanten(h('123a 456a 789a 5b'), { meldCount: 1 }) === 0, '1 meld, 10 tiles, tanki → 0');
  assert(calculateShanten(h('123a 456a 789a 55b'), { meldCount: 1 }) === -1, '1 meld, 11 tiles complete → −1');
  assert(calculateShanten(h('5b'), { meldCount: 4 }) === 0, '4 melds, bare single → 0');
  assert(calculateShanten(h('55b'), { meldCount: 4 }) === -1, '4 melds, pair → −1');
  assert(calculateShanten(h('1a 9b 5c E'), { meldCount: 3 }) === 2, '3 melds, four isolated tiles → 2');
});

// ---------------------------------------------------------------------------
// 6. Special shapes
// ---------------------------------------------------------------------------

section('Shanten — Seven Pairs / Thirteen Orphans', () => {
  const sp = h('11a 99a 11b 99b EE SS W');
  const off = calculateShantenBreakdown(sp);
  assert(off.sevenPairs === null && off.thirteenOrphans === null, 'special shapes disabled by default');
  assert(off.shanten === off.regular, 'default shanten = regular shape');
  const on = calculateShantenBreakdown(sp, { allowSevenPairs: true });
  assert(on.sevenPairs === 0 && on.shanten === 0, 'six pairs + single → Seven Pairs tenpai');
  assert(calculateShanten(h('11a 99a 11b 99b EE SS WW'), { allowSevenPairs: true }) === -1, 'seven distinct pairs → −1');
  assert(calculateShanten(h('1111a 99a 11b 99b EE S'), { allowSevenPairs: true }) === 2, 'four-of-a-kind counts as one pair; needs 7 distinct kinds');

  const ko = h('19a 19b 19c ESWNRG H');
  assert(calculateShanten(ko, { allowThirteenOrphans: true }) === 0, 'thirteen-sided orphans → 0');
  assert(calculateShanten(h('19a 19b 19c ESWNRG HH'), { allowThirteenOrphans: true }) === -1, 'complete orphans → −1');
  const isolated = h('147a 258b 369c ESWN');
  assert(calculateShantenBreakdown(isolated, { allowThirteenOrphans: true }).thirteenOrphans === 7, 'orphans shanten counts terminal/honour kinds');

  const open = calculateShantenBreakdown(h('11a 99a 11b 99b EE'), { meldCount: 1, allowSevenPairs: true, allowThirteenOrphans: true });
  assert(open.sevenPairs === null && open.thirteenOrphans === null, 'special shapes impossible with an open meld');
});

// ---------------------------------------------------------------------------
// 7. Ukeire
// ---------------------------------------------------------------------------

section('Ukeire', () => {
  let u = calculateUkeire(h('123a 456a 789a 123b 5b'));
  assert(u.shanten === 0, 'reports shanten');
  assert(u.tiles.length === 1 && u.tiles[0].index === kind('5b') && u.tiles[0].remaining === 3, 'tanki wait: 3 copies of the held kind');
  assert(u.total === 3, 'total = 3');

  u = calculateUkeire(h('123a 456a 789a 55b 67b'));
  const waits = u.tiles.map((t) => t.index).sort((a, b) => a - b);
  assert(waits.join(',') === [kind('5b'), kind('8b')].join(','), 'ryanmen + pair: waits on 5 (shanpon via pair) and 8');
  assert(u.total === 2 + 4, 'totals: 5b has 2 left, 8b has 4 left');

  const vis = createEmptyCounts();
  vis[kind('8b')] = 3;
  u = calculateUkeire(h('123a 456a 789a 55b 67b'), { visibleCounts: vis });
  assert(u.tiles.find((t) => t.index === kind('8b')).remaining === 1, 'visibleCounts reduces remaining');
  vis[kind('8b')] = 4;
  u = calculateUkeire(h('123a 456a 789a 55b 67b'), { visibleCounts: vis });
  assert(!u.tiles.some((t) => t.index === kind('8b')), 'fully visible kind excluded');

  u = calculateUkeire(h('1111a 234b 567b 99c E'));
  assert(!u.tiles.some((t) => t.index === kind('1a')), 'never lists a kind with all 4 copies in hand');

  u = calculateUkeire(h('147a 258b 369c ESWN'));
  assert(u.shanten === 8 && u.total > 0, 'worst hand still accepts tiles');
  assert(u.tiles.every((t) => t.remaining >= 1 && t.remaining <= 4), 'remaining always 1–4');
});

// ---------------------------------------------------------------------------
// 8. evaluateDiscards
// ---------------------------------------------------------------------------

section('evaluateDiscards', () => {
  const hand = h('123a 456a 789a 123b 5b 9c');
  const res = evaluateDiscards(hand);
  assert(res.length === 14, 'one result per distinct kind held (14 kinds)');
  assert(res[0].shanten === 0 && res[1].shanten === 0, 'best two discards keep tenpai');
  assert(res[0].discardIndex === kind('5b') && res[1].discardIndex === kind('9c'), 'ties broken by lower index (5b before 9c)');
  assert(res[0].ukeire === 3 && res[0].ukeireTiles[0].index === kind('9c'), 'discard 5b → wait on 9c, 3 left');
  assert(res.slice(2).every((r) => r.shanten >= 1), 'breaking a set costs shanten');
  for (let i = 1; i < res.length; i++) {
    const a = res[i - 1]; const b = res[i];
    if (a.shanten > b.shanten || (a.shanten === b.shanten && a.ukeire < b.ukeire)) {
      assert(false, `results out of order at ${i}`);
      return;
    }
  }
  assert(true, 'sorted by shanten asc, then ukeire desc');

  // Discarded copy counts as seen: holding 3 of a kind, discard one → only 0 left of it to draw back.
  const r2 = evaluateDiscards(h('123a 456a 789a 555b E 9c'));
  const discardE = r2.find((r) => r.discardIndex === kind('E'));
  assert(discardE.shanten === 0, 'discarding the honour leaves a set + triplet tenpai');
  const d5 = r2.find((r) => r.discardIndex === kind('5b'));
  const back5 = d5.ukeireTiles.find((t) => t.index === kind('5b'));
  assert(!back5 || back5.remaining <= 1, 'discarded tile counted as visible (at most 1 copy left to draw back)');

  const again = evaluateDiscards(hand);
  assert(JSON.stringify(again) === JSON.stringify(res), 'deterministic across calls');

  const open = evaluateDiscards(h('123a 456a 5b 9c'), { meldCount: 2 });
  assert(open[0].shanten === 0, 'works with open melds (meldCount 2, 8 tiles)');
});

// ---------------------------------------------------------------------------
// 9. Purity
// ---------------------------------------------------------------------------

section('Inputs never mutated', () => {
  const hand = h('123a 456a 789a 123b 5b 9c');
  const snap = hand.slice();
  const vis = createEmptyCounts(); vis[0] = 1;
  const visSnap = vis.slice();
  evaluateDiscards(hand, { visibleCounts: vis });
  calculateShanten(hand.slice(0, 34).map((x, i) => (i === kind('9c') ? 0 : x)));
  assert(hand.every((x, i) => x === snap[i]), 'counts unchanged by evaluateDiscards');
  assert(vis.every((x, i) => x === visSnap[i]), 'visibleCounts unchanged');
  const w = h('123a 456a 789a 123b 5b');
  const wSnap = w.slice();
  calculateUkeire(w);
  assert(w.every((x, i) => x === wSnap[i]), 'counts unchanged by calculateUkeire');
});

// ---------------------------------------------------------------------------
// 10. Brute-force cross-check
// ---------------------------------------------------------------------------

section('Brute-force cross-check against an independent checker', () => {
  const rand = mulberry32(73);
  const pools = [
    range(0, 9),                 // one suit — dense, many complete/tenpai hands
    range(0, 18),                // two suits
    [...range(0, 9), 27, 28, 31], // one suit + some honours
    range(0, 34),                // everything
  ];

  // (a) 14-tile hands: shanten −1 ⇔ complete.
  let mismatches = 0; let completes = 0;
  for (let n = 0; n < 1500; n++) {
    const hand = randomHand(rand, 14, pools[n % pools.length]);
    const complete = refIsComplete(hand, 4);
    if (complete) completes++;
    if ((calculateShanten(hand) === -1) !== complete) mismatches++;
  }
  assert(mismatches === 0, `14-tile: −1 ⇔ complete (1500 hands, ${completes} complete)`);

  // (b) 13-tile hands: shanten 0 ⇔ tenpai; shanten 1 ⇔ not tenpai but one swap reaches it.
  let tenpaiMismatch = 0; let oneMismatch = 0; let tenpais = 0; let ones = 0;
  for (let n = 0; n < 300; n++) {
    const hand = randomHand(rand, 13, pools[n % 3]);
    const s = calculateShanten(hand);
    const tenpai = refIsTenpai(hand, 4);
    if (tenpai) tenpais++;
    if ((s === 0) !== tenpai) tenpaiMismatch++;
    if (!tenpai) {
      const one = refOneSwapToTenpai(hand, 4);
      if (one) ones++;
      if ((s === 1) !== one) oneMismatch++;
    }
  }
  assert(tenpaiMismatch === 0, `13-tile: 0 ⇔ tenpai (300 hands, ${tenpais} tenpai)`);
  assert(oneMismatch === 0, `13-tile: 1 ⇔ one swap from tenpai (${ones} one-shanten)`);

  // (c) Open hands (meldCount 2 → 7 tiles): 0 ⇔ tenpai.
  let openMismatch = 0;
  for (let n = 0; n < 500; n++) {
    const hand = randomHand(rand, 7, pools[n % 2]);
    if ((calculateShanten(hand, { meldCount: 2 }) === 0) !== refIsTenpai(hand, 2)) openMismatch++;
  }
  assert(openMismatch === 0, 'meldCount 2: 0 ⇔ tenpai (500 hands)');

  // (d) Ukeire tiles are exactly the shape-completing tiles for tenpai hands.
  let ukMismatch = 0; let checked = 0;
  for (let n = 0; n < 400 && checked < 80; n++) {
    const hand = randomHand(rand, 13, pools[0]);
    if (calculateShanten(hand) !== 0) continue;
    checked++;
    const got = calculateUkeire(hand).tiles.map((t) => t.index).sort((a, b) => a - b).join(',');
    const want = range(0, 34)
      .filter((t) => hand[t] < 4 && (() => { const c = hand.slice(); c[t]++; return refIsComplete(c, 4); })())
      .join(',');
    if (got !== want) ukMismatch++;
  }
  assert(checked > 0 && ukMismatch === 0, `tenpai ukeire = exact winning tiles (${checked} hands)`);
});

// ---------------------------------------------------------------------------
// 11. Draw/discard consistency
// ---------------------------------------------------------------------------

section('Accepted tile + best discard lowers shanten by exactly 1', () => {
  const rand = mulberry32(1173);
  let bad = 0; let checked = 0;
  for (let n = 0; n < 150; n++) {
    const hand = randomHand(rand, 13, n % 2 ? range(0, 18) : range(0, 34));
    const { shanten, tiles } = calculateUkeire(hand);
    if (shanten <= 0 || tiles.length === 0) continue;
    const t = tiles[Math.floor(rand() * tiles.length)].index;
    const drawn = hand.slice(); drawn[t]++;
    const best = evaluateDiscards(drawn)[0];
    checked++;
    if (best.shanten !== shanten - 1) bad++;
  }
  assert(checked > 50 && bad === 0, `consistent across ${checked} draws`);
});

// ---------------------------------------------------------------------------
// 12. Performance
// ---------------------------------------------------------------------------

section('Performance sanity', () => {
  const rand = mulberry32(7);
  const hands = Array.from({ length: 50 }, () => randomHand(rand, 14, range(0, 34)));
  const t0 = Date.now();
  for (const hand of hands) evaluateDiscards(hand, { allowSevenPairs: true, allowThirteenOrphans: true });
  const ms = Date.now() - t0;
  console.log(`    (50 full discard evaluations in ${ms} ms)`);
  assert(ms < 10000, '50 full discard evaluations well under 10s (avg < 200ms each)');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} assertions passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

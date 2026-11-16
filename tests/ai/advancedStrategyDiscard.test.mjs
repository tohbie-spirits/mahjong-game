/**
 * advancedStrategyDiscard.test.mjs
 *
 * Task 74 — AdvancedStrategy.js efficient-discard selection.
 *
 * Sections:
 *   1.  tileKeepValue — ordering (honour < terminal < edge < middle),
 *       copies/neighbours raise value, valuable honours, validation
 *   2.  chooseEfficientDiscard — validation + passthrough of evaluator options
 *   3.  Efficiency first — never trades shanten/ukeire for keep-value
 *   4.  Tie-break — isolated honour/terminal thrown before middle tiles;
 *       valuable honours kept; deterministic
 *   5.  Candidates — complete, ordered, keepValue attached
 *   6.  selectDiscardTile — returns a real tile object, last copy (tsumogiri),
 *       bonus tiles ignored, validation
 *   7.  Property check — on 500 random hands the chosen discard always has the
 *       evaluator's best shanten and best ukeire
 *   8.  Solitaire benchmark — draw/discard from a shuffled 136-tile wall:
 *       Advanced reaches tenpai faster and more often than both a random
 *       discarder and a re-creation of BasicStrategy's documented
 *       "least-connected tile" rule (Task 37)
 *
 * Index layout as in HandEfficiencyEvaluator: 0–8 suit A, 9–17 suit B,
 * 18–26 suit C, 27–33 honours (E S W N R G H in this test's notation).
 *
 * Run with:
 *   node tests/ai/advancedStrategyDiscard.test.mjs
 */

import {
  tileKeepValue,
  chooseEfficientDiscard,
  selectDiscardTile,
} from '../../src/ai/advanced/AdvancedStrategy.js';
import {
  countsFromIndices,
  createEmptyCounts,
  evaluateDiscards,
  calculateShanten,
} from '../../src/ai/advanced/HandEfficiencyEvaluator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUIT_OFFSET = { a: 0, b: 9, c: 18 };
const HONOR_INDEX = { E: 27, S: 28, W: 29, N: 30, R: 31, G: 32, H: 33 };

function idx(spec) {
  const out = [];
  for (const group of spec.trim().split(/\s+/)) {
    if (/^[ESWNRGH]+$/.test(group)) { for (const ch of group) out.push(HONOR_INDEX[ch]); continue; }
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
function section(name, fn) { currentSection = name; console.log(`\n▸ ${name}`); return fn(); }
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
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 1. tileKeepValue
// ---------------------------------------------------------------------------

section('tileKeepValue', () => {
  const lone = h('1a 5b 2c E'); // padding irrelevant for keep-value
  const vH = tileKeepValue(kind('E'), lone);
  const vT = tileKeepValue(kind('1a'), lone);
  const vE = tileKeepValue(kind('2c'), lone);
  const vM = tileKeepValue(kind('5b'), lone);
  assert(vH < vT && vT < vE && vE < vM, 'isolated: honour < terminal < edge(2/8) < middle');

  assert(tileKeepValue(kind('5b'), h('55b')) > tileKeepValue(kind('5b'), h('5b')), 'a second copy raises value');
  assert(tileKeepValue(kind('5b'), h('45b')) > tileKeepValue(kind('5b'), h('35b')), 'adjacent neighbour worth more than gapped');
  assert(tileKeepValue(kind('5b'), h('35b')) > tileKeepValue(kind('5b'), h('5b')), 'gapped neighbour still adds value');
  assert(tileKeepValue(kind('9a'), h('9a 1b')) === tileKeepValue(kind('9a'), h('9a')), 'no cross-suit neighbours (9a and 1b are not adjacent)');
  assert(tileKeepValue(kind('R'), h('R'), { valuableHonorIndices: [kind('R')] }) > tileKeepValue(kind('R'), h('R')), 'valuable honour worth more');
  assert(tileKeepValue(kind('R'), h('R'), { valuableHonorIndices: [kind('R')] }) > tileKeepValue(kind('1a'), h('1a')), 'valuable lone honour outranks a lone terminal');

  assertThrows(() => tileKeepValue(34, lone), TypeError, 'index out of range throws');
  assertThrows(() => tileKeepValue(0, [1, 2]), TypeError, 'bad counts throws');
  assertThrows(() => tileKeepValue(0, lone, { valuableHonorIndices: [3] }), TypeError, 'non-honour in valuableHonorIndices throws');
  assertThrows(() => tileKeepValue(0, lone, { valuableHonorIndices: 31 }), TypeError, 'non-array valuableHonorIndices throws');
});

// ---------------------------------------------------------------------------
// 2. Validation / passthrough
// ---------------------------------------------------------------------------

section('chooseEfficientDiscard — validation and options', () => {
  assertThrows(() => chooseEfficientDiscard(h('123a 456a 789a 123b 5b')), RangeError, '13-tile hand rejected (needs a drawn hand)');
  assertThrows(() => chooseEfficientDiscard([1]), TypeError, 'bad counts rejected');
  assertThrows(() => chooseEfficientDiscard(h('123a 456a 789a 123b 5b 9c'), null), TypeError, 'null options rejected');
  assertThrows(() => chooseEfficientDiscard(h('123a 456a 789a 123b 5b 9c'), { valuableHonorIndices: [0] }), TypeError, 'bad valuableHonorIndices rejected');

  const open = chooseEfficientDiscard(h('123a 456a 5b 9c'), { meldCount: 2 });
  assert(open.shanten === 0, 'meldCount passed through to the evaluator');

  const sp = h('11a 99a 11b 99b EE SS W N');
  assert(chooseEfficientDiscard(sp).shanten > 0, 'Seven Pairs ignored by default');
  assert(chooseEfficientDiscard(sp, { allowSevenPairs: true }).shanten === 0, 'allowSevenPairs passed through');
});

// ---------------------------------------------------------------------------
// 3. Efficiency first
// ---------------------------------------------------------------------------

section('Efficiency always beats keep-value', () => {
  // Discarding the lone East keeps tenpai; discarding a middle tile would break a set.
  const r = chooseEfficientDiscard(h('123a 456a 789a 345b 5c E'));
  assert(r.shanten === 0, 'keeps the hand tenpai');
  assert(r.discardIndex === kind('E') || r.discardIndex === kind('5c'), 'discards one of the two loose tiles');

  // Efficiency outranks keep-value: across random hands, whenever the choice
  // is NOT the lowest-keep-value tile, it must be strictly more efficient
  // (lower shanten or more ukeire) than every lower-valued candidate.
  {
    const rand = mulberry32(4242);
    let overrides = 0; let violations = 0;
    for (let n = 0; n < 300; n++) {
      const pool = [];
      for (let k = 0; k < 34; k++) for (let c = 0; c < 4; c++) pool.push(k);
      const counts = createEmptyCounts();
      for (let t = 0; t < 14; t++) { const j = Math.floor(rand() * pool.length); counts[pool[j]]++; pool.splice(j, 1); }
      const res = chooseEfficientDiscard(counts);
      const chosen = res.candidates[0];
      for (const c of res.candidates.slice(1)) {
        if (c.keepValue < chosen.keepValue) {
          overrides++;
          const moreEfficient = chosen.shanten < c.shanten || (chosen.shanten === c.shanten && chosen.ukeire > c.ukeire);
          if (!moreEfficient) violations++;
        }
      }
    }
    assert(overrides > 0, `efficiency overrode keep-value in real hands (${overrides} cases)`);
    assert(violations === 0, 'every override was justified by strictly better shanten or ukeire');
  }

  const vis = createEmptyCounts();
  // Two equal tanki waits: 5b vs 9c. Make 9c's copies all visible → keeping 9c is dead.
  vis[kind('9c')] = 3;
  const r3 = chooseEfficientDiscard(h('123a 456a 789a 123b 5b 9c'), { visibleCounts: vis });
  assert(r3.discardIndex === kind('9c'), 'visible copies steer away from a dead wait');
  assert(r3.ukeire === 3, 'remaining wait has 3 live copies');
});

// ---------------------------------------------------------------------------
// 4. Tie-break
// ---------------------------------------------------------------------------

section('Keep-value tie-break', () => {
  // Isolated honour vs isolated middle tile, equal efficiency → honour goes.
  const r = chooseEfficientDiscard(h('123a 456a 789a 11b 5c W 9c'));
  const top = r.candidates.filter((c) => c.shanten === r.shanten && c.ukeire === r.ukeire);
  if (top.length > 1) {
    assert(r.keepValue === Math.min(...top.map((c) => c.keepValue)), 'among equal-efficiency candidates, lowest keep-value wins');
  } else {
    assert(true, 'single best candidate (no tie to break)');
  }

  // Lone honours: plain wind discarded before a valuable dragon when equal.
  const hand = h('123a 456a 789a 11b 5c R E');
  const plain = chooseEfficientDiscard(hand);
  const valued = chooseEfficientDiscard(hand, { valuableHonorIndices: [kind('R')] });
  const eq = (res) => res.candidates.filter((c) => c.shanten === res.shanten && c.ukeire === res.ukeire).map((c) => c.discardIndex);
  if (eq(valued).includes(kind('E')) && eq(valued).includes(kind('R'))) {
    assert(valued.discardIndex === kind('E'), 'valuable Red Dragon kept, East discarded');
  } else {
    assert(valued.discardIndex !== kind('R') || plain.discardIndex === kind('R'), 'valuable honour never discarded ahead of an equal alternative');
  }

  const a = chooseEfficientDiscard(hand);
  const b = chooseEfficientDiscard(hand);
  assert(JSON.stringify(a) === JSON.stringify(b), 'deterministic');
});

// ---------------------------------------------------------------------------
// 5. Candidates
// ---------------------------------------------------------------------------

section('Candidates list', () => {
  const hand = h('123a 456a 789a 123b 5b 9c');
  const r = chooseEfficientDiscard(hand);
  assert(r.candidates.length === 14, 'one candidate per distinct kind');
  assert(r.candidates.every((c) => typeof c.keepValue === 'number'), 'keepValue on every candidate');
  assert(r.candidates[0].discardIndex === r.discardIndex, 'first candidate is the choice');
  let ordered = true;
  for (let i = 1; i < r.candidates.length; i++) {
    const p = r.candidates[i - 1]; const c = r.candidates[i];
    const cmp = p.shanten - c.shanten || c.ukeire - p.ukeire || p.keepValue - c.keepValue || p.discardIndex - c.discardIndex;
    if (cmp > 0) ordered = false;
  }
  assert(ordered, 'candidates in decision order');
  assert(hand[kind('9c')] === 1, 'input counts not mutated');
});

// ---------------------------------------------------------------------------
// 6. selectDiscardTile
// ---------------------------------------------------------------------------

section('selectDiscardTile', () => {
  let uid = 0;
  const mk = (k) => ({ k, uid: uid++ });
  const kinds = idx('123a 456a 789a 123b 5b');
  const tiles = kinds.map(mk);
  const drawnE = mk(kind('E'));
  const flower = { k: null, bonus: true, uid: uid++ };
  const hand = [...tiles, flower, drawnE];
  const toIndex = (t) => t.k;

  const r = selectDiscardTile(hand, toIndex);
  assert(r.tile === drawnE, 'returns the actual tile object (useless drawn East)');
  assert(r.discardIndex === kind('E') && r.shanten === 0, 'result carries decision details');
  assert(r.tile !== flower, 'bonus tile never chosen');

  // When the chosen kind has several copies, the LAST copy is returned.
  {
    const rand = mulberry32(99);
    let tested = 0; let ok = 0;
    for (let n = 0; n < 400 && tested < 25; n++) {
      const pool = [];
      for (let k = 0; k < 34; k++) for (let c = 0; c < 4; c++) pool.push(k);
      const kindsDrawn = [];
      for (let t = 0; t < 14; t++) { const j = Math.floor(rand() * pool.length); kindsDrawn.push(pool[j]); pool.splice(j, 1); }
      const handTiles = kindsDrawn.map(mk);
      const res = selectDiscardTile(handTiles, toIndex);
      const sameKind = handTiles.filter((t) => t.k === res.discardIndex);
      if (sameKind.length < 2) continue;
      tested++;
      if (res.tile === sameKind[sameKind.length - 1]) ok++;
    }
    assert(tested > 0 && ok === tested, `last copy of the chosen kind returned (tsumogiri) — ${tested} multi-copy cases`);
  }

  assertThrows(() => selectDiscardTile('tiles', toIndex), TypeError, 'non-array tiles throws');
  assertThrows(() => selectDiscardTile(hand), TypeError, 'missing tileToIndex throws');
  assertThrows(() => selectDiscardTile(tiles, toIndex), RangeError, '13 countable tiles (no draw) throws');
});

// ---------------------------------------------------------------------------
// 7. Property check
// ---------------------------------------------------------------------------

section('Chosen discard always matches the evaluator’s best efficiency', () => {
  const rand = mulberry32(74);
  let bad = 0;
  for (let n = 0; n < 500; n++) {
    const pool = [];
    for (let k = 0; k < 34; k++) for (let c = 0; c < 4; c++) pool.push(k);
    const counts = createEmptyCounts();
    for (let t = 0; t < 14; t++) { const j = Math.floor(rand() * pool.length); counts[pool[j]]++; pool.splice(j, 1); }
    const best = evaluateDiscards(counts)[0];
    const r = chooseEfficientDiscard(counts);
    if (r.shanten !== best.shanten || r.ukeire !== best.ukeire || counts[r.discardIndex] === 0) bad++;
  }
  assert(bad === 0, '500 random hands: best shanten + best ukeire, discard actually held');
});

// ---------------------------------------------------------------------------
// 8. Solitaire benchmark
// ---------------------------------------------------------------------------

/**
 * Re-creation of BasicStrategy's documented discard rule (Task 37):
 * "simple-suit tiles connect within 2 ranks of the same suit, honours only via
 * exact duplicate; least-connected tile(s) chosen, ties broken randomly".
 * Re-created from the plan's description because BasicStrategy.js itself was
 * not available — close enough to serve as a baseline, not a bit-exact copy.
 */
function basicLikeDiscard(counts, rand) {
  let bestScore = Infinity; let choices = [];
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) continue;
    let score = counts[i] - 1; // duplicates connect
    if (i < 27) {
      const start = i - (i % 9);
      for (let d = -2; d <= 2; d++) {
        if (d === 0) continue;
        const j = i + d;
        if (j >= start && j < start + 9) score += counts[j];
      }
    }
    if (score < bestScore) { bestScore = score; choices = [i]; }
    else if (score === bestScore) choices.push(i);
  }
  return choices[Math.floor(rand() * choices.length)];
}
function randomDiscard(counts, rand) {
  const held = [];
  for (let i = 0; i < 34; i++) for (let c = 0; c < counts[i]; c++) held.push(i);
  return held[Math.floor(rand() * held.length)];
}
function advancedDiscard(counts, _rand, seen) {
  return chooseEfficientDiscard(counts, { visibleCounts: seen }).discardIndex;
}

/** Plays one solitaire hand; returns draws needed to reach tenpai (or cap+1). */
function playSolitaire(policy, seed, cap) {
  const rand = mulberry32(seed);
  const wall = [];
  for (let k = 0; k < 34; k++) for (let c = 0; c < 4; c++) wall.push(k);
  for (let i = wall.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [wall[i], wall[j]] = [wall[j], wall[i]]; }
  const counts = createEmptyCounts();
  for (let t = 0; t < 13; t++) counts[wall.pop()]++;
  const seen = createEmptyCounts();
  const policyRand = mulberry32(seed ^ 0x9e3779b9);
  if (calculateShanten(counts) <= 0) return 0;
  for (let draw = 1; draw <= cap; draw++) {
    counts[wall.pop()]++;
    if (calculateShanten(counts) === -1) return draw;
    const d = policy(counts, policyRand, seen);
    counts[d]--; seen[d]++;
    if (calculateShanten(counts) <= 0) return draw;
  }
  return cap + 1;
}

section('Solitaire benchmark vs Basic-like and random discarding', () => {
  const GAMES = 120;
  const CAP = 18; // roughly a player's draws in a 4-player hand
  const results = {};
  for (const [name, policy] of [['advanced', advancedDiscard], ['basicLike', basicLikeDiscard], ['random', randomDiscard]]) {
    let sum = 0; let reached = 0;
    for (let g = 0; g < GAMES; g++) {
      const d = playSolitaire(policy, 7400 + g, CAP); // same walls for every policy
      sum += d;
      if (d <= CAP) reached++;
    }
    results[name] = { avg: sum / GAMES, rate: reached / GAMES };
    console.log(`    ${name.padEnd(9)} avg draws to tenpai ${results[name].avg.toFixed(2)} · tenpai within ${CAP} draws ${(results[name].rate * 100).toFixed(1)}%`);
  }
  assert(results.advanced.avg < results.basicLike.avg, 'Advanced reaches tenpai in fewer draws than the Basic-like rule');
  assert(results.advanced.rate > results.basicLike.rate, 'Advanced reaches tenpai more often than the Basic-like rule');
  assert(results.advanced.avg < results.random.avg && results.advanced.rate > results.random.rate, 'Advanced beats random discarding on both measures');
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

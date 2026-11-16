/**
 * defensivePlayEvaluator.test.mjs
 *
 * Task 76 — DefensivePlayEvaluator.js (danger-tile assessment).
 *
 * Sections:
 *   1.  Exports / weights frozen
 *   2.  Validation
 *   3.  visibleCountsFromTable
 *   4.  Threat — grows with discards and melds, capped, declaredTenpai = 1
 *   5.  Wait shapes — honours by unseen copies, terminals < edge < middle
 *   6.  Wall (kabe) — exhausted neighbours kill sequence waits
 *   7.  Suji — opponent's discard of k±3 lowers k (full under furiten)
 *   8.  Genbutsu — 0 under furiten, reduced otherwise
 *   9.  Flush signal — one-suit melds raise that suit, lower the others
 *  10.  Combining opponents + rankSafeDiscards
 *  11.  Purity + weights override
 *  12.  Validation against simulated opponents: opponents play efficiently
 *       (Task 74) until tenpai; their REAL winning tiles must rank as more
 *       dangerous than non-winning tiles (AUC), and the full model must beat
 *       a "threat only, every tile equal" baseline
 *
 * Run with:
 *   node tests/ai/defensivePlayEvaluator.test.mjs
 */

import {
  DEFAULT_DANGER_WEIGHTS,
  visibleCountsFromTable,
  assessOpponentThreat,
  assessDanger,
  rankSafeDiscards,
} from '../../src/ai/advanced/DefensivePlayEvaluator.js';
import {
  createEmptyCounts,
  calculateShanten,
  calculateUkeire,
} from '../../src/ai/advanced/HandEfficiencyEvaluator.js';
import { chooseEfficientDiscard } from '../../src/ai/advanced/AdvancedStrategy.js';

const SUIT_OFFSET = { a: 0, b: 9, c: 18 };
const HONOR_INDEX = { E: 27, S: 28, W: 29, N: 30, R: 31, G: 32, H: 33 };
const k = (spec) => {
  if (HONOR_INDEX[spec] !== undefined) return HONOR_INDEX[spec];
  const m = spec.match(/^(\d)([abc])$/);
  return SUIT_OFFSET[m[2]] + Number(m[1]) - 1;
};
const ks = (spec) => spec.trim().split(/\s+/).map(k);

let passed = 0; let failed = 0; const failures = []; let currentSection = '';
function section(name, fn) { currentSection = name; console.log(`\n▸ ${name}`); return fn(); }
function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(`[${currentSection}] ${message}`); console.error(`  ✗ FAIL: ${message}`); }
}
function assertThrows(fn, expectedType, message) {
  let threw = false; let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) assert(false, `${message} — expected throw, nothing thrown`);
  else if (expectedType && !(err instanceof expectedType)) assert(false, `${message} — wrong error type: ${err?.constructor?.name} (${err?.message})`);
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

/** Builds a state with one opponent whose discards are also the visible tiles. */
function oneOpp({ discards = [], melds = [], declaredTenpai, hand = createEmptyCounts(), extraVisible = [] } = {}) {
  const visible = visibleCountsFromTable({ discards: [discards], melds, extra: extraVisible });
  const opp = { discards, melds };
  if (declaredTenpai !== undefined) opp.declaredTenpai = declaredTenpai;
  return { handCounts: hand, visibleCounts: visible, opponents: [opp] };
}
const tenpaiOpp = (extra = {}) => oneOpp({ declaredTenpai: true, ...extra });

// ---------------------------------------------------------------------------
section('Exports', () => {
  assert(Object.isFrozen(DEFAULT_DANGER_WEIGHTS), 'DEFAULT_DANGER_WEIGHTS frozen');
  assert(DEFAULT_DANGER_WEIGHTS.maxThreat < 1, 'unknown-tenpai threat capped below 1');
});

// ---------------------------------------------------------------------------
section('Validation', () => {
  const ok = tenpaiOpp();
  assertThrows(() => assessDanger(null), TypeError, 'null state throws');
  assertThrows(() => assessDanger(ok, null), TypeError, 'null options throws');
  assertThrows(() => assessDanger({ ...ok, handCounts: [1] }), TypeError, 'bad handCounts throws');
  assertThrows(() => assessDanger({ ...ok, visibleCounts: null }), TypeError, 'bad visibleCounts throws');
  assertThrows(() => assessDanger({ ...ok, opponents: 'x' }), TypeError, 'non-array opponents throws');
  assertThrows(() => assessDanger({ ...ok, opponents: [{ discards: [40] }] }), TypeError, 'bad discard index throws');
  assertThrows(() => assessDanger({ ...ok, opponents: [{ melds: [[1, 2]] }] }), TypeError, 'meld of 2 tiles throws');
  assertThrows(() => assessDanger({ ...ok, opponents: [{ declaredTenpai: 'yes' }] }), TypeError, 'non-boolean declaredTenpai throws');
  assertThrows(() => assessDanger(ok, { furiten: 1 }), TypeError, 'non-boolean furiten throws');
  assertThrows(() => assessDanger(ok, { weights: { nope: 1 } }), TypeError, 'unknown weight throws');
  assertThrows(() => assessDanger(ok, { weights: { flushInSuit: -1 } }), TypeError, 'negative weight throws');
  const hand = createEmptyCounts(); hand[0] = 4;
  const vis = createEmptyCounts(); vis[0] = 1;
  assertThrows(() => assessDanger({ handCounts: hand, visibleCounts: vis, opponents: [] }), RangeError, 'hand + visible > 4 throws');
  assertThrows(() => rankSafeDiscards(createEmptyCounts(), {}), TypeError, 'rankSafeDiscards needs an assessment');
});

// ---------------------------------------------------------------------------
section('visibleCountsFromTable', () => {
  const v = visibleCountsFromTable({ discards: [[0, 0], [33]], melds: [[5, 6, 7]], extra: [0] });
  assert(v[0] === 3 && v[33] === 1 && v[6] === 1, 'counts discards, melds and extra');
  assert(visibleCountsFromTable().every((x) => x === 0), 'empty table → zeros');
  assertThrows(() => visibleCountsFromTable({ discards: [[1, 1, 1, 1, 1]] }), RangeError, 'fifth visible copy throws');
  assertThrows(() => visibleCountsFromTable(null), TypeError, 'null table throws');
});

// ---------------------------------------------------------------------------
section('Threat', () => {
  const t0 = assessOpponentThreat({ discards: [] });
  const t6 = assessOpponentThreat({ discards: [0, 1, 2, 3, 4, 5] });
  const t6m2 = assessOpponentThreat({ discards: [0, 1, 2, 3, 4, 5], melds: [[9, 10, 11], [12, 13, 14]] });
  assert(t0 < t6 && t6 < t6m2, 'threat grows with discards and melds');
  const long = assessOpponentThreat({ discards: new Array(25).fill(30), melds: [[0, 1, 2], [3, 4, 5], [6, 7, 8]] });
  assert(long === DEFAULT_DANGER_WEIGHTS.maxThreat, 'threat capped at maxThreat');
  assert(assessOpponentThreat({ declaredTenpai: true }) === 1, 'declaredTenpai → 1');
  assert(assessOpponentThreat({}, { threatBase: 0.5 }) === 0.5, 'weights override applies');
});

// ---------------------------------------------------------------------------
section('Wait shapes', () => {
  const d = assessDanger(tenpaiOpp()).combined;
  assert(d[k('1a')] < d[k('2a')] && d[k('2a')] < d[k('5a')], 'terminal < 2 < middle with nothing visible');
  assert(Math.abs(d[k('3a')] - d[k('5a')]) < 1e-9, '3 and 5 equally exposed (three wait forms each)');
  assert(d[k('E')] < d[k('1a')], 'honour (single waits only) safer than terminal');

  const seenTwoE = assessDanger(tenpaiOpp({ extraVisible: ks('E E') })).combined[k('E')];
  const seenThreeE = assessDanger(tenpaiOpp({ extraVisible: ks('E E E') })).combined[k('E')];
  assert(seenThreeE < seenTwoE && seenTwoE <= d[k('E')], 'honour danger falls as copies become visible');
  const hand = createEmptyCounts(); hand[k('E')] = 1;
  const allSeen = assessDanger({ ...tenpaiOpp({ extraVisible: ks('E E E') }), handCounts: hand }).combined[k('E')];
  assert(allSeen === 0, 'honour with no unseen copies → 0 danger');
});

// ---------------------------------------------------------------------------
section('Wall (kabe)', () => {
  const base = assessDanger(tenpaiOpp()).combined;
  const wall = assessDanger(tenpaiOpp({ extraVisible: ks('2a 2a 2a 2a') })).combined;
  assert(wall[k('1a')] < base[k('1a')], 'all four 2a visible → 1a safer (its only sequence wait used 2a)');
  assert(wall[k('3a')] < base[k('3a')], '3a also safer (two of its forms use 2a)');
  assert(wall[k('6a')] === base[k('6a')], 'unrelated 6a unchanged');
});

// ---------------------------------------------------------------------------
section('Suji', () => {
  const noDisc = assessDanger(oneOpp({ discards: ks('9c 9c 9c') })).combined;
  const with4 = assessDanger(oneOpp({ discards: ks('4a 9c 9c') })).combined;
  const with4f = assessDanger(oneOpp({ discards: ks('4a 9c 9c') }), { furiten: true }).combined;
  assert(with4[k('1a')] < noDisc[k('1a')] && with4[k('7a')] < noDisc[k('7a')], 'discarded 4a → 1a and 7a safer');
  assert(with4f[k('1a')] < with4[k('1a')], 'suji stronger under furiten');
  // 1a's only sequence form is (2a,3a) — killed fully by suji under furiten → only single waits remain.
  const single = DEFAULT_DANGER_WEIGHTS.singleWaitWeight;
  const max = 3 * DEFAULT_DANGER_WEIGHTS.sequenceFormWeight + single;
  const threat = assessOpponentThreat({ discards: ks('4a 9c 9c') });
  assert(Math.abs(with4f[k('1a')] - threat * (single / max)) < 1e-9, 'furiten suji leaves only the single-wait term for 1a');
  assert(with4[k('5a')] <= noDisc[k('5a')], '5a not made more dangerous');
});

// ---------------------------------------------------------------------------
section('Genbutsu', () => {
  const s = oneOpp({ discards: ks('5b 9c') });
  const noF = assessDanger(s).combined;
  const f = assessDanger(s, { furiten: true }).combined;
  const ref = assessDanger(oneOpp({ discards: ks('5c 9c') })).combined;
  assert(f[k('5b')] === 0, 'own discard perfectly safe under furiten');
  assert(noF[k('5b')] > 0 && noF[k('5b')] < ref[k('5b')], 'without furiten: reduced but not zero (vs. same tile not discarded)');
});

// ---------------------------------------------------------------------------
section('Flush signal', () => {
  const melds = [ks('1b 2b 3b'), ks('7b 8b 9b')];
  const flush = assessDanger(oneOpp({ melds, discards: ks('1a 5c') })).combined;
  const mixed = assessDanger(oneOpp({ melds: [ks('1b 2b 3b'), ks('7c 8c 9c')], discards: ks('1a 5c') })).combined;
  assert(flush[k('5b')] > mixed[k('5b')], 'flush suit more dangerous');
  assert(flush[k('5a')] < mixed[k('5a')], 'off-suit tiles less dangerous');
  assert(flush[k('E')] === mixed[k('E')], 'honours unaffected by flush bias');
  const one = assessDanger(oneOpp({ melds: [ks('1b 2b 3b')], discards: [] })).combined;
  const none = assessDanger(oneOpp({ melds: [ks('1c 2c 3c')], discards: [] })).combined;
  assert(one[k('5b')] === none[k('5c')], 'a single meld does not trigger the flush bias');
});

// ---------------------------------------------------------------------------
section('Combining opponents + ranking', () => {
  const vis = createEmptyCounts();
  const a = { discards: [], declaredTenpai: true };
  const b = { discards: ks('1a'), melds: [ks('E E E')] };
  const one = assessDanger({ handCounts: createEmptyCounts(), visibleCounts: vis, opponents: [a] });
  const two = assessDanger({ handCounts: createEmptyCounts(), visibleCounts: visibleCountsFromTable({ discards: [[], ks('1a')], melds: [ks('E E E')] }), opponents: [a, b] });
  assert(two.perOpponent.length === 2, 'per-opponent results returned');
  assert(two.combined[k('5a')] >= two.perOpponent[0].danger[k('5a')] && two.combined[k('5a')] >= two.perOpponent[1].danger[k('5a')], 'combined ≥ each opponent');
  assert(two.combined.every((x) => x >= 0 && x <= 1), 'combined within [0, 1]');
  const none = assessDanger({ handCounts: createEmptyCounts(), visibleCounts: vis, opponents: [] });
  assert(none.combined.every((x) => x === 0), 'no opponents → no danger');

  const hand = createEmptyCounts();
  for (const i of ks('1a 5a 5a E 9c')) hand[i]++;
  const ranked = rankSafeDiscards(hand, one);
  assert(ranked.length === 4, 'one entry per held kind');
  assert(ranked[0].index === k('E'), 'honour ranked safest');
  assert(ranked[ranked.length - 1].index === k('5a'), 'middle tile ranked most dangerous');
  assert(ranked.every((r, i) => i === 0 || ranked[i - 1].danger <= r.danger), 'sorted ascending');
});

// ---------------------------------------------------------------------------
section('Purity + weights override', () => {
  const s = oneOpp({ discards: ks('4a 9c'), melds: [ks('1b 2b 3b')] });
  const snap = JSON.stringify(s);
  assessDanger(s, { furiten: true });
  assert(JSON.stringify(s) === snap, 'state not mutated');
  const heavier = assessDanger(s, { weights: { flushInSuit: 3 } });
  assert(heavier.combined.every((x) => x <= 1), 'overrides still clamped to [0,1]');
  assert(DEFAULT_DANGER_WEIGHTS.flushInSuit === 1.6, 'defaults untouched by overrides');
});

// ---------------------------------------------------------------------------
// 12. Validation against simulated opponents
// ---------------------------------------------------------------------------

function simulateOpponents(seed, nOpp) {
  const rand = mulberry32(seed);
  const wall = [];
  for (let t = 0; t < 34; t++) for (let c = 0; c < 4; c++) wall.push(t);
  for (let i = wall.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [wall[i], wall[j]] = [wall[j], wall[i]]; }
  const myHand = createEmptyCounts();
  for (let t = 0; t < 13; t++) myHand[wall.pop()]++;
  const opps = [];
  for (let o = 0; o < nOpp; o++) {
    const counts = createEmptyCounts();
    for (let t = 0; t < 13; t++) counts[wall.pop()]++;
    opps.push({ counts, discards: [], tenpai: calculateShanten(counts) === 0 });
  }
  const allDiscards = [];
  for (let turn = 0; turn < 16; turn++) {
    for (const o of opps) {
      if (o.tenpai) { // tenpai: tsumogiri (draw and throw unless it wins)
        const t = wall.pop();
        o.counts[t]++;
        if (calculateShanten(o.counts) === -1) { o.counts[t]--; o.won = true; }
        else o.counts[t]--;
        o.discards.push(t); allDiscards.push(t);
        continue;
      }
      o.counts[wall.pop()]++;
      const vis = createEmptyCounts();
      for (const d of allDiscards) vis[d]++;
      const clamp = vis.map((v, i) => Math.min(v, 4 - o.counts[i]));
      const d = chooseEfficientDiscard(o.counts, { visibleCounts: clamp }).discardIndex;
      o.counts[d]--; o.discards.push(d); allDiscards.push(d);
      if (calculateShanten(o.counts) === 0) o.tenpai = true;
    }
  }
  return { myHand, opps, allDiscards };
}

/** AUC: probability a random winning tile scores higher than a random non-winning one (ties = ½). */
function auc(scores, isPositive) {
  const pos = []; const neg = [];
  scores.forEach((s, i) => (isPositive[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

section('Validation against simulated opponents’ real waits', () => {
  let fullSum = 0; let baseSum = 0; let cases = 0; let dealInRateSafe = 0; let dealInRateRandom = 0;
  for (let g = 0; g < 120; g++) {
    const { myHand, opps, allDiscards } = simulateOpponents(7600 + g, 3);
    const visible = createEmptyCounts();
    for (const d of allDiscards) visible[d]++;
    // Clamp: visible + my hand can't exceed 4 (re-drawn copies in the sim).
    for (let i = 0; i < 34; i++) visible[i] = Math.min(visible[i], 4 - myHand[i]);
    const state = {
      handCounts: myHand,
      visibleCounts: visible,
      opponents: opps.map((o) => ({ discards: o.discards })),
    };
    const { perOpponent, combined } = assessDanger(state);
    opps.forEach((o, oi) => {
      if (!o.tenpai) return;
      const waits = new Set(calculateUkeire(o.counts).tiles.map((t) => t.index));
      const candidates = [];
      for (let i = 0; i < 34; i++) if (4 - myHand[i] - visible[i] > 0 || myHand[i] > 0) candidates.push(i);
      const full = auc(candidates.map((i) => perOpponent[oi].danger[i]), candidates.map((i) => waits.has(i)));
      if (full === null) return;
      fullSum += full; baseSum += 0.5; cases++;
    });
    // Deal-in comparison from MY hand: safest held tile vs a random held tile.
    const held = []; for (let i = 0; i < 34; i++) for (let c = 0; c < myHand[i]; c++) held.push(i);
    const tenpaiWaits = new Set();
    for (const o of opps) if (o.tenpai) for (const t of calculateUkeire(o.counts).tiles) tenpaiWaits.add(t.index);
    const safest = rankSafeDiscards(myHand, { combined })[0].index;
    if (tenpaiWaits.has(safest)) dealInRateSafe++;
    dealInRateRandom += held.filter((t) => tenpaiWaits.has(t)).length / held.length;
  }
  const fullAuc = fullSum / cases;
  console.log(`    tenpai opponents assessed: ${cases} · mean AUC ${fullAuc.toFixed(3)} (0.5 = no better than chance)`);
  console.log(`    deal-in rate over 120 tables: safest-ranked tile ${(dealInRateSafe / 120 * 100).toFixed(1)}% vs random held tile ${(dealInRateRandom / 120 * 100).toFixed(1)}%`);
  assert(cases >= 50, 'enough tenpai opponents to measure');
  assert(fullAuc > 0.6, 'real winning tiles rank as more dangerous than non-winning tiles (AUC > 0.6)');
  assert(fullAuc > baseSum / cases, 'model beats a threat-only baseline (every tile equal)');
  assert(dealInRateSafe < dealInRateRandom / 2, 'safest-ranked discard deals in less than half as often as a random one');
});

console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) console.log(`✓ All ${passed} assertions passed.`);
else { console.log(`${passed} passed, ${failed} FAILED.`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }

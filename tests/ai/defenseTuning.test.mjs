/**
 * defenseTuning.test.mjs — Task 80b: Advanced AI defence tuning on the real
 * engine.
 *
 * Sections:
 *   1. visibleFanPotential — honour Pungs, double winds, flush / all-Pungs
 *      routes, Chi and off-suit melds killing routes
 *   2. readTable threat scaling — concealed opponents, melds below the
 *      minimum, melds that keep the minimum, seat winds from the dealer,
 *      no minimum fan / no dealer / threatValueScale:false → unscaled
 *   3. DefensivePlayEvaluator threatScale — scales threat, validated,
 *      omitted = Task 76 behaviour
 *   4. AdvancedStrategy options + tuned defaults
 *   5. Same-table harness (SeatDispatchStrategy) — routing, and the mirror
 *      control: two identical agents score EXACTLY the same on Basic and
 *      Advanced tables
 *   6. Real-engine guard on held-out walls (seeds 40000+): tuned defence vs
 *      no defence at an all-Advanced table — not clearly harmful; tuned beats
 *      the Task 77 defence head-to-head on the same deals
 *
 * Run: node tests/ai/defenseTuning.test.mjs   (≈1.5–2 min)
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { makeTileFactory } from '../_helpers/tiles.mjs';
import {
  AdvancedStrategy, readTable, visibleFanPotential, DEFAULT_THREAT_VALUE_SCALE, DEFAULT_DEFENSE_SETTINGS,
} from '../../src/ai/advanced/AdvancedStrategy.js';
import { assessOpponentThreat, assessDanger } from '../../src/ai/advanced/DefensivePlayEvaluator.js';
import { createEmptyCounts } from '../../src/ai/advanced/HandEfficiencyEvaluator.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { Meld } from '../../src/core/Hand.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AI_DIFFICULTY, SEAT_KIND, WIND, MELD_TYPE } from '../../src/utils/constants.js';
import { runBenchmark, compareAgents, SeatDispatchStrategy, summarize, AGENTS } from '../_helpers/aiBenchmark.mjs';
import { mulberry32 } from '../_helpers/harness.mjs';

const E = 27, S = 28, W = 29, RED = 31, GREEN = 32;

// ---------------------------------------------------------------------------
section('1. visibleFanPotential', () => {
  const pon = (k) => [k, k, k];
  assert(visibleFanPotential([pon(RED)], [false], E, E) === 1 + 3, 'dragon Pung (1) + both routes open (3)');
  assert(visibleFanPotential([pon(E)], [false], E, E) === 2 + 3, 'own seat wind that is also the prevailing wind counts twice');
  assert(visibleFanPotential([pon(S)], [false], E, E) === 0 + 3, 'a non-valuable wind Pung adds no fan; all-Pungs still open');
  assert(visibleFanPotential([[0, 1, 2], [3, 4, 5]], [true, true], E, E) === 3, 'two Chows in one suit: flush still possible');
  assert(visibleFanPotential([[0, 1, 2], [9, 10, 11]], [true, true], E, E) === 0, 'Chows in two suits: no flush, no all-Pungs → 0');
  assert(visibleFanPotential([[0, 1, 2], pon(10)], [true, false], E, E) === 0, 'a Chow kills all-Pungs, a second suit kills the flush');
  assert(visibleFanPotential([pon(4), pon(13)], [false, false], E, E) === 3, 'Pungs in two suits: all-Pungs still open');
  assert(visibleFanPotential([[0, 1, 2], pon(GREEN)], [true, false], E, E) === 1 + 3, 'Chow + dragon Pung: flush still open (honours allowed)');
});

// ---------------------------------------------------------------------------
section('2. readTable threat scaling', () => {
  const f = makeTileFactory();
  const me = new PlayerManager({ seatIndex: 1, seatKind: SEAT_KIND.AI, aiDifficulty: AI_DIFFICULTY.ADVANCED });
  me.seatWind = WIND.SOUTH;
  const chi = (a, b, c) => new Meld({ type: MELD_TYPE.CHI, tiles: [f(a), f(b), f(c)], calledFrom: 0 });
  const pon = (id) => new Meld({ type: MELD_TYPE.PON, tiles: [f(id), f(id), f(id)], calledFrom: 0 });
  const table = {
    discards: [[f('dots-9')], [], [f('bamboo-1')], [f('characters-1')]],
    melds: [
      [chi('dots-1', 'dots-2', 'dots-3'), chi('bamboo-4', 'bamboo-5', 'bamboo-6')], // seat 0: two suits → below 3 fan
      [],                                                                               // me
      [],                                                                               // seat 2: concealed
      [pon('wind-north')],                                                              // seat 3: see below
    ],
  };
  const ctx = (extra = {}) => ({ ruleEngine: new HongKongRules(), seatIndex: 1, playerCount: 4, seatWind: WIND.SOUTH, roundWind: WIND.EAST, dealerIndex: 0, table, ...extra });
  const opp = readTable(me, ctx()).opponents;
  assert(opp.length === 3, 'three opponents');
  assert(opp[0].threatScale === DEFAULT_THREAT_VALUE_SCALE.belowMinimum, 'seat 0 (Chows in two suits) → belowMinimum scale');
  assert(opp[1].threatScale === DEFAULT_THREAT_VALUE_SCALE.concealed, 'seat 2 (no melds) → concealed scale');
  assert(opp[2].threatScale === undefined, 'seat 3 (North Pung, all-Pungs route open) → unscaled');
  // Seat winds come from the dealer: with dealer 0, seat 3 is North → its North Pung is its seat wind (1 fan + 3).
  const north = readTable(me, ctx({ table: { ...table, melds: [[], [], [], [pon('wind-north'), chi('dots-1', 'dots-2', 'dots-3'), chi('bamboo-1', 'bamboo-2', 'bamboo-3')]] } })).opponents[2];
  assert(north.threatScale === DEFAULT_THREAT_VALUE_SCALE.belowMinimum, 'seat wind Pung (1) + no route (two-suit Chows) = 1 < 3 → belowMinimum');
  const dealer3 = readTable(me, ctx({ dealerIndex: 3, table: { ...table, melds: [[], [], [], [pon('wind-east'), pon('dragon-red')]] } })).opponents[2];
  assert(dealer3.threatScale === undefined, 'dealer 3 → seat 3 is East: East (seat + prevailing = 2) + red (1) + all-Pungs → unscaled');
  assert(readTable(me, ctx({ ruleEngine: undefined })).opponents.every((o) => o.threatScale === undefined), 'no rule engine (no minimum fan) → unscaled');
  assert(readTable(me, ctx({ ruleEngine: new HongKongRules({ minimumFan: 0 }) })).opponents.every((o) => o.threatScale === undefined), 'minimum 0 fan → unscaled');
  assert(readTable(me, ctx({ dealerIndex: undefined })).opponents.every((o) => o.threatScale === undefined), 'no dealer in context → unscaled');
  assert(readTable(me, ctx(), { threatValueScale: false }).opponents.every((o) => o.threatScale === undefined), 'threatValueScale:false → unscaled (Task 77 threat)');
  assert(readTable(me, ctx(), { threatValueScale: { concealed: 0.5, belowMinimum: 0 } }).opponents[1].threatScale === 0.5, 'custom scale used');
  assert(opp[0].melds.length === 2 && opp[0].discards.join() === '8', 'discards / melds unchanged');
});

// ---------------------------------------------------------------------------
section('3. DefensivePlayEvaluator threatScale', () => {
  const o = { discards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], melds: [] };
  const base = assessOpponentThreat(o);
  assert(Math.abs(assessOpponentThreat({ ...o, threatScale: 0.1 }) - base * 0.1) < 1e-12, 'threat × threatScale');
  assert(assessOpponentThreat({ ...o, threatScale: 1 }) === base, 'scale 1 = unscaled');
  assert(assessOpponentThreat({ ...o, declaredTenpai: true, threatScale: 0.1 }) === 1, 'declaredTenpai still 1');
  assertThrows(() => assessOpponentThreat({ ...o, threatScale: 1.5 }), TypeError, 'scale > 1 throws');
  assertThrows(() => assessOpponentThreat({ ...o, threatScale: -0.1 }), TypeError, 'negative scale throws');
  assertThrows(() => assessOpponentThreat({ ...o, threatScale: 'x' }), TypeError, 'non-number scale throws');
  const hand = createEmptyCounts(); hand[4] = 2; hand[13] = 2;
  const a = assessDanger({ handCounts: hand, visibleCounts: createEmptyCounts(), opponents: [o] });
  const b = assessDanger({ handCounts: hand, visibleCounts: createEmptyCounts(), opponents: [{ ...o, threatScale: 0.1 }] });
  assert(b.combined[4] < a.combined[4] && Math.abs(b.combined[4] - a.combined[4] * 0.1) < 1e-9, 'danger scales with the opponent\'s threat');
});

// ---------------------------------------------------------------------------
section('4. AdvancedStrategy options + tuned defaults', () => {
  assert(DEFAULT_DEFENSE_SETTINGS.progressWeight === 10 && DEFAULT_DEFENSE_SETTINGS.tenpaiProgressWeight === 30, 'tuned progress weights 10 / 30');
  assert(DEFAULT_DEFENSE_SETTINGS.pushBelowThreat === 0.25 && DEFAULT_DEFENSE_SETTINGS.foldAtThreat === 0.7 && DEFAULT_DEFENSE_SETTINGS.foldMinShanten === 3, 'thresholds unchanged');
  assert(Object.isFrozen(DEFAULT_THREAT_VALUE_SCALE) && DEFAULT_THREAT_VALUE_SCALE.concealed === 0.1 && DEFAULT_THREAT_VALUE_SCALE.belowMinimum === 0.05, 'threat value scale defaults');
  assert(new AdvancedStrategy() instanceof AdvancedStrategy && new AdvancedStrategy({ threatValueScale: false }) instanceof AdvancedStrategy, 'default and threatValueScale:false construct');
  assertThrows(() => new AdvancedStrategy({ threatValueScale: { concealed: 2, belowMinimum: 0 } }), TypeError, 'scale out of range throws');
  assertThrows(() => new AdvancedStrategy({ threatValueScale: { concealed: 0.1 } }), TypeError, 'missing scale key throws');
  assert(Object.keys(AGENTS).includes('advanced-task77-defense'), 'harness keeps the pre-80b defence as an agent');
});

// ---------------------------------------------------------------------------
section('5. Same-table harness', () => {
  const calls = [];
  const fake = (name) => ({ chooseDiscard: (p) => { calls.push(`${name}:d${p.seatIndex}`); return 'x'; }, chooseClaim: () => ({ type: 'pass' }), chooseWinDeclaration: () => true });
  const map = { 0: fake('a'), 1: fake('b') };
  const d = new SeatDispatchStrategy(AI_DIFFICULTY.ADVANCED, (seat) => map[seat]);
  d.chooseDiscard({ seatIndex: 1 }); d.chooseDiscard({ seatIndex: 0 });
  assert(d.getStrategyId() === 'advanced' && calls.join() === 'b:d1,a:d0', 'dispatches each decision to the asking seat\'s strategy');
  assert(d.chooseWinDeclaration({ seatIndex: 0 }) === true, 'win declaration routed');

  const same = (label) => ({ label, tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random }) });
  const basic = { label: 'basic', tier: AI_DIFFICULTY.BASIC, create: (random) => new BasicStrategy({ random }) };
  const X = same('x'); const Y = same('y');
  const r1 = runBenchmark({ lineup: [X, basic, Y, basic], seeds: 8, seedBase: 40000 });
  const c1 = compareAgents(r1, 'x', 'y');
  assert(c1.points.mean === 0 && c1.points.se === 0 && c1.wins.mean === 0 && c1.dealIns.mean === 0, 'mirror control on a Basic table: identical agents score exactly the same');
  const r2 = runBenchmark({ lineup: [X, Y, X, Y], seeds: 6, seedBase: 40000 });
  const c2 = compareAgents(r2, 'x', 'y');
  assert(c2.points.mean === 0 && c2.points.se === 0, 'mirror control on an all-Advanced table: exactly the same');
  assert(r1.invariants.errors + r2.invariants.errors === 0, 'no errors');
  assertThrows(() => runBenchmark({ lineup: [same('z'), basic, same('z')], seeds: 1 }), Error, 'two different agents sharing a label throw');
});

// ---------------------------------------------------------------------------
section('6. Real-engine guard (held-out walls 40000+)', () => {
  const tuned = { label: 'tuned', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random }) };
  const off = { label: 'off', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random, useDefense: false }) };
  const old = { ...AGENTS['advanced-task77-defense'], label: 'task77' };
  const fmt = (c, k = 1) => `${(c.mean * k).toFixed(2)} [${(c.lo * k).toFixed(2)}, ${(c.hi * k).toFixed(2)}]`;

  const r = runBenchmark({ lineup: [tuned, off, tuned, off], seeds: 80, seedBase: 40000 });
  const c = compareAgents(r, 'tuned', 'off');
  const m = summarize(r).tuned.discardModes;
  console.log(`    tuned − no defence, all-Advanced table, 160 hands: points ${fmt(c.points)} · wins ${fmt(c.wins, 100)} pp · deal-ins ${fmt(c.dealIns, 100)} pp · modes ${JSON.stringify(m)}`);
  assert(r.invariants.errors + r.invariants.conservationFailures + r.invariants.zeroSumFailures + r.invariants.underMinimumWins === 0, 'invariants hold');
  assert(c.points.hi > 0, 'tuned defence is not clearly harmful at an all-Advanced table (CI upper bound above 0)');
  assert(m.push > 0 && m.balance > 0 && m.fold > 0, 'all three modes still used');

  const h = runBenchmark({ lineup: [tuned, old, tuned, old], seeds: 80, seedBase: 40000 });
  const ch = compareAgents(h, 'tuned', 'task77');
  console.log(`    tuned − Task 77 defence, head-to-head, 160 hands: points ${fmt(ch.points)} · wins ${fmt(ch.wins, 100)} pp · deal-ins ${fmt(ch.dealIns, 100)} pp`);
  assert(ch.points.mean > 0 && ch.wins.mean > 0, 'tuned defence out-scores and out-wins the Task 77 defence on the same deals');
});

summary();

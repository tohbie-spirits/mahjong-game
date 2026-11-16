/**
 * aiBenchmark.test.mjs — Task 80: Advanced AI behaviour harness / benchmark
 * vs Basic AI.
 *
 * Uses tests/_helpers/aiBenchmark.mjs (duplicate format: each wall played
 * in every distinct seat rotation). All seeds here start at 20000 — a block
 * never used to tune anything (Tasks 74–78b tuned on 7800/7900/12000).
 *
 * Sections:
 *   1. Harness mechanics — rotations, agent validation, determinism,
 *      accounting identities, tile-conservation checker catches corruption,
 *      paired statistics on a synthetic report, report formatting
 *   2. Head-to-head, 4 players (Advanced/Basic/Advanced/Basic, 3 fan):
 *      Advanced ahead on points, wins and deal-ins with 95% CIs excluding 0
 *   3. Head-to-head, 3 players (Advanced vs two Basic, 3 fan)
 *   4. Behaviour on the real engine — Advanced's defence modes all occur,
 *      no fallbacks, decision latency
 *   5. Ablations, paired across runs on the same walls:
 *      fan-value layer (asserted: worth points), defence layer (MEASURED and
 *      logged — the open Task 77 question; see the plan's Known Issues)
 *
 * Runtime ≈ 3–4 minutes (skipped by run-all --fast).
 * Run: node tests/ai/aiBenchmark.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import {
  AGENTS, seatRotations, runBenchmark, summarize, compareAgents, compareRuns, formatReport, tilesConserved,
} from '../_helpers/aiBenchmark.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { createAIManagerForSeats, buildPlayerConfigs } from '../../src/ai/StrategyRegistry.js';

const HELD_OUT = 20000;
const strip = (r) => JSON.stringify(Object.fromEntries(Object.entries(r.stats).map(([k, v]) => [k, { ...v, decisionMs: v.decisionMs.length }])));
const log = (s) => console.log(s.split('\n').map((l) => `    ${l}`).join('\n'));
const fmt = (c, scale = 1, d = 1) => `${(c.mean * scale).toFixed(d)} [${(c.lo * scale).toFixed(d)}, ${(c.hi * scale).toFixed(d)}]`;

// ---------------------------------------------------------------------------
section('1. Harness mechanics', () => {
  assert(seatRotations(['a', 'b', 'a', 'b']).map((r) => r.join('')).join() === 'abab,baba', 'ABAB has 2 distinct rotations');
  assert(seatRotations(['a', 'b', 'b', 'b']).length === 4 && seatRotations(['a', 'b', 'b']).length === 3, 'ABBB → 4, ABB → 3');
  const rots = seatRotations(['a', 'b', 'b', 'b']);
  assert([0, 1, 2, 3].every((seat) => rots.filter((r) => r[seat] === 'a').length === 1), 'every agent sits in every seat once');
  assertThrows(() => runBenchmark({ lineup: ['advanced', 'basic'], seeds: 1 }), RangeError, 'two-seat line-up throws');
  assertThrows(() => runBenchmark({ lineup: ['advanced', 'basic', 'basic'], seeds: 0 }), RangeError, 'seeds 0 throws');
  assertThrows(() => runBenchmark({ lineup: ['advanced', 'expert', 'basic'], seeds: 1 }), TypeError, 'unknown agent throws');
  // Task 80b: variants of one tier may share a table (SeatDispatchStrategy).
  const shared = runBenchmark({ lineup: ['advanced', 'advanced-no-defense', 'basic'], seeds: 1, seedBase: HELD_OUT });
  assert(shared.invariants.errors === 0 && shared.stats['advanced-no-defense'].seatHands === 3, 'two variants of one tier can share a table (Task 80b)');
  assert(Object.keys(AGENTS).join() === 'basic,advanced,advanced-no-defense,advanced-fan-blind,advanced-speed-only,advanced-task77-defense,advanced-mcr-blind', 'built-in agents (incl. the pre-80b defence and, from Task 98, the MCR-blind baseline)');

  const r1 = runBenchmark({ lineup: ['advanced', 'basic', 'advanced', 'basic'], seeds: 4, seedBase: HELD_OUT });
  const r2 = runBenchmark({ lineup: ['advanced', 'basic', 'advanced', 'basic'], seeds: 4, seedBase: HELD_OUT });
  assert(strip(r1) === strip(r2) && JSON.stringify(r1.groups) === JSON.stringify(r2.groups), 'deterministic: same config → identical results');
  const s = r1.stats;
  assert(r1.outcomes.hands === 8 && s.advanced.seatHands === 16 && s.basic.seatHands === 16, '4 walls × 2 rotations = 8 hands, 16 seat-hands each');
  const all = Object.values(s);
  const wins = all.reduce((a, x) => a + x.wins, 0);
  assert(all.every((x) => x.wins === x.tsumo + x.ron), 'wins = tsumo + ron per agent');
  assert(all.reduce((a, x) => a + x.ron, 0) === all.reduce((a, x) => a + x.dealIns, 0), 'total Ron wins = total deal-ins');
  assert(all.reduce((a, x) => a + x.points, 0) === 0, 'points are zero-sum');
  assert(wins >= r1.outcomes.wins && r1.outcomes.wins + r1.outcomes.draws === r1.outcomes.hands, 'outcome accounting');
  const inv = r1.invariants;
  assert(inv.errors + inv.conservationFailures + inv.zeroSumFailures + inv.underMinimumWins === 0, 'invariants hold');

  // The conservation checker must catch a missing or duplicated tile.
  const cfg = buildPlayerConfigs({ playerCount: 4, difficulty: 'basic', humanSeatIndex: -1 });
  const gm = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg), eventBus: new EventBus(), seed: HELD_OUT, maxHands: 1 });
  for (let i = 0; i < 12; i++) gm.playAITurn();
  assert(tilesConserved(gm), 'conserved mid-hand');
  const hand = gm.getPlayer(1).getHand();
  const t = hand.concealedTiles[0];
  hand.removeConcealedTile(t);
  assert(!tilesConserved(gm), 'a removed tile is detected');
  hand.addConcealedTile(t); hand.addConcealedTile(gm.getPlayer(2).getHand().concealedTiles[0]);
  assert(!tilesConserved(gm), 'a duplicated tile is detected');

  // Paired statistics on a synthetic report.
  const synth = { labels: ['x', 'y'], groups: [1, 2, 3, 4].map((k) => ({ x: { points: 4 * k, wins: 2, dealIns: 0, seatHands: 2 }, y: { points: -4 * k, wins: 0, dealIns: 2, seatHands: 2 } })) };
  const c = compareAgents(synth, 'x', 'y');
  assert(c.points.mean === 10 && c.points.n === 4 && c.points.lo < 10 && c.points.hi > 10, 'compareAgents: mean of per-seed differences, CI around it');
  assert(c.wins.mean === 1 && c.wins.se === 0 && c.dealIns.mean === -1, 'constant differences have zero SE');
  assertThrows(() => compareAgents(synth, 'x', 'z'), Error, 'unknown agent in compareAgents throws');
  const text = formatReport(r1, { compare: ['advanced', 'basic'] });
  assert(/advanced − basic per seat-hand/.test(text) && /Invariants: all held/.test(text) && /discard modes/.test(text), 'formatReport prints table, comparison, modes and invariants');
});

// ---------------------------------------------------------------------------
let main4;
section('2. Head-to-head, 4 players (A/B/A/B, 3 fan, held-out walls)', () => {
  main4 = runBenchmark({ lineup: ['advanced', 'basic', 'advanced', 'basic'], seeds: 120, seedBase: HELD_OUT });
  log(formatReport(main4, { compare: ['advanced', 'basic'] }));
  const inv = main4.invariants;
  assert(inv.errors === 0 && inv.conservationFailures === 0 && inv.zeroSumFailures === 0 && inv.underMinimumWins === 0, `240 hands: no errors, tiles conserved, zero-sum, every win ≥ 3 fan`);
  const c = compareAgents(main4, 'advanced', 'basic');
  assert(c.points.lo > 0, `Advanced out-scores Basic per seat-hand, 95% CI above 0 (${fmt(c.points)})`);
  assert(c.wins.lo > 0, `Advanced wins more often, CI above 0 (${fmt(c.wins, 100)} pp)`);
  assert(c.dealIns.hi < 0, `Advanced deals in less, CI below 0 (${fmt(c.dealIns, 100)} pp)`);
  const sm = summarize(main4);
  assert(sm.advanced.winRate > 2 * sm.basic.winRate, `Advanced win rate more than double Basic's (${(100 * sm.advanced.winRate).toFixed(1)}% vs ${(100 * sm.basic.winRate).toFixed(1)}%)`);
});

// ---------------------------------------------------------------------------
section('3. Head-to-head, 3 players (A/B/B, 3 fan, held-out walls)', () => {
  const r = runBenchmark({ lineup: ['advanced', 'basic', 'basic'], seeds: 60, seedBase: HELD_OUT });
  log(formatReport(r, { compare: ['advanced', 'basic'] }));
  const inv = r.invariants;
  assert(inv.errors + inv.conservationFailures + inv.zeroSumFailures + inv.underMinimumWins === 0, '180 three-player hands: all invariants hold');
  const c = compareAgents(r, 'advanced', 'basic');
  assert(c.points.lo > 0 && c.wins.lo > 0, `Advanced ahead on points (${fmt(c.points)}) and wins (${fmt(c.wins, 100)} pp), CIs above 0`);
});

// ---------------------------------------------------------------------------
section('4. Behaviour on the real engine', () => {
  const sm = summarize(main4).advanced;
  const modes = sm.discardModes;
  assert(modes.push > 0 && modes.balance > 0 && modes.fold > 0, `all three defence modes occur on real tables (push ${modes.push}, balance ${modes.balance}, fold ${modes.fold}) — in Task 77's simplified table FOLD never triggered`);
  assert(sm.fallbacks === 0, 'no Advanced decision fell back to Basic');
  assert(sm.decisionMs.p95 < 150, `decision latency p95 ${sm.decisionMs.p95.toFixed(1)} ms < 150 ms (max ${sm.decisionMs.max.toFixed(0)} ms, logged)`);
  assert(sm.avgFan >= 3, `Advanced wins average ≥ 3 fan (${sm.avgFan.toFixed(2)})`);
});

// ---------------------------------------------------------------------------
section('5. Ablations (paired across runs on the same walls)', () => {
  const lineupOf = (label) => [label, 'basic', label, 'basic'];
  const blind = runBenchmark({ lineup: lineupOf('advanced-fan-blind'), seeds: 120, seedBase: HELD_OUT });
  const noDef = runBenchmark({ lineup: lineupOf('advanced-no-defense'), seeds: 120, seedBase: HELD_OUT });
  for (const r of [blind, noDef]) {
    const inv = r.invariants;
    assert(inv.errors + inv.conservationFailures + inv.zeroSumFailures + inv.underMinimumWins === 0, `${r.config.lineup[0]}: invariants hold`);
  }
  const value = compareRuns(main4, 'advanced', blind, 'advanced-fan-blind');
  console.log(`    fan-value layer (Advanced − fan-blind, relative to Basic): points ${fmt(value.points)} · wins ${fmt(value.wins, 100)} pp · deal-ins ${fmt(value.dealIns, 100)} pp`);
  assert(value.points.lo > 0 && value.wins.lo > 0, 'the Task 78b fan-value layer is worth points and wins (CIs above 0)');
  const fb = compareAgents(blind, 'advanced-fan-blind', 'basic');
  assert(fb.points.mean < 0, `fan-blind Advanced still loses to Basic at 3 fan (${fmt(fb.points)}) — the Task 78 finding, reproduced on held-out walls`);

  const def = compareRuns(main4, 'advanced', noDef, 'advanced-no-defense');
  const nd = summarize(noDef)['advanced-no-defense'];
  console.log(`    defence layer (Advanced − no-defence, relative to Basic): points ${fmt(def.points)} · wins ${fmt(def.wins, 100)} pp · deal-ins ${fmt(def.dealIns, 100)} pp`);
  assert(Object.keys(nd.discardModes).join() === 'efficient', 'useDefense:false never leaves the efficient path');
  // MEASURED, not asserted to be positive: on 300 held-out walls the defence
  // layer is net-neutral (Known Issues → Task 80b). Guard only against it
  // becoming clearly harmful.
  assert(def.points.hi > 0, 'defence layer is not clearly harmful (CI upper bound above 0)');
});

summary();

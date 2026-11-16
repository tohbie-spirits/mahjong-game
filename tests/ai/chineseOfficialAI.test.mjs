/**
 * chineseOfficialAI.test.mjs — Task 98: the Chinese Official (MCR) AI
 * adaptation layer (ChineseOfficialAIHelpers.js + Basic / Advanced hooks).
 *
 * Sections:
 *   1. Helpers — context detection, valuable honours, base points, the MCR
 *      value routes (every route, melds that rule routes out, qualification)
 *   2. Basic — claim policy (closed by default; valuable honours; flush suits)
 *   3. Advanced — value of waiting hands (real-engine tenpai incl. special
 *      shapes, Tsumo-only waits, dead tenpai), discards keep a route
 *   4. Whole games — 4P / 3P × Basic / Advanced: no errors, no fallbacks,
 *      every tile accounted for (flowers too), every win valid
 *   5. Benchmarks (duplicate format) — Advanced vs Basic; Advanced vs an
 *      Advanced without the MCR routes
 *
 * Slow suite (≈ 5 minutes).  Run: node tests/ai/chineseOfficialAI.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { tiles, hand } from '../_helpers/tiles.mjs';
import { tilesConserved, runBenchmark, compareAgents, summarize } from '../_helpers/aiBenchmark.mjs';
import {
  isChineseOfficialContext, valuableHonorKinds, mcrBasePoints, analyzeMcrRoutes, mcrWaitKinds, MCR_ROUTE,
} from '../../src/ai/ChineseOfficialAIHelpers.js';
import { countsFromTiles } from '../../src/rules/chineseOfficial/ChineseOfficialHandAnalysis.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { Tile } from '../../src/core/Tile.js';
import { ACTION_TYPE, WIND } from '../../src/utils/constants.js';

const C = (spec) => countsFromTiles(tiles(spec));
const route = (spec, melds = [], roles = {}) => analyzeMcrRoutes(C(spec), melds, roles);
const best = (spec, melds, roles) => { const r = route(spec, melds, roles); return `${r.best.route}:${r.valueShanten}`; };
const rules = new ChineseOfficialRules();
const ctx = (extra = {}) => ({ ruleEngine: rules, seatWind: WIND.SOUTH, roundWind: WIND.EAST, wallRemaining: 50, ...extra });
const player = (spec, melds = [], seatIndex = 1) => { const h = hand(spec, melds); return { seatIndex, seatWind: WIND.SOUTH, getHand: () => h }; };
const E = 27; const S = 28; const RED = 31;

// ---------------------------------------------------------------------------
section('1. Helpers', () => {
  assert(isChineseOfficialContext(ctx()) && !isChineseOfficialContext({ ruleEngine: new HongKongRules() }) && !isChineseOfficialContext({ ruleEngine: new RiichiRules() }) && !isChineseOfficialContext({}), 'context detection');
  const v = valuableHonorKinds({ seatWindIndex: S, roundWindIndex: E });
  assert(v.has(31) && v.has(32) && v.has(33) && v.has(S) && v.has(E) && !v.has(29), 'valuable honours: dragons + seat + prevalent');
  assert(mcrBasePoints(C('123d 456b'), [], {}) === 2, 'a closed hand is worth 2 already');
  assert(mcrBasePoints(C('123d RRR'), [], {}) === 4 && mcrBasePoints(C('123d EEE'), [], { seatWindIndex: E, roundWindIndex: E }) === 6, 'valuable honour Pungs: 2 per role');
  assert(mcrBasePoints(C('123d'), [{ type: 'pon', kinds: [29, 29, 29], concealed: false }], {}) === 0, 'open + a non-valuable wind Pung → 0');

  assert(best('123d 456b 789c 111d E') === `${MCR_ROUTE.MIXED_STRAIGHT}:0`, 'Mixed Straight tenpai → 0');
  assert(best('123d 456d 789d 11b 5c E') === `${MCR_ROUTE.PURE_STRAIGHT}:1` || route('123d 456d 789d 11b 5c E').routes.some((r) => r.route === MCR_ROUTE.PURE_STRAIGHT && r.shanten === 1), 'Pure Straight route');
  assert(route('234d 234b 23c 11d 567b').routes.some((r) => r.route === MCR_ROUTE.MIXED_TRIPLE_CHOW && r.start === 2 && r.shanten === 0), 'Mixed Triple Chow route (missing 4c)');
  assert(best('11d 33d 55d 77b 99b EE R') === `${MCR_ROUTE.SEVEN_PAIRS}:0`, 'Seven Pairs');
  assert(best('19d 19b 19c ESWNRG H') === `${MCR_ROUTE.THIRTEEN_ORPHANS}:0`, 'Thirteen Orphans');
  assert(best('147d 258b 369c ESWR') === `${MCR_ROUTE.HONORS_KNITTED}:0`, 'Honors and Knitted Tiles');
  assert(route('147d 258b 36c 555c EE').routes.some((r) => r.route === MCR_ROUTE.KNITTED_STRAIGHT && r.shanten === 0), 'Knitted Straight (missing 9c)');
  assert(route('123d 345d 678d 999d 1d').routes.some((r) => r.route === MCR_ROUTE.FULL_FLUSH && r.shanten === 0), 'Full Flush');

  // Melds rule routes out.
  const chiOff = [{ type: 'chi', kinds: [9, 10, 11], concealed: false }];
  const r1 = route('123d 456d 789d 1d', chiOff);
  assert(!r1.routes.some((r) => r.route === MCR_ROUTE.ALL_PUNGS) && !r1.routes.some((r) => r.route === MCR_ROUTE.FULL_FLUSH && r.suit === 0), 'an exposed bamboo Chow: no All Pungs, no dots flush');
  assert(!r1.routes.some((r) => [MCR_ROUTE.SEVEN_PAIRS, MCR_ROUTE.HONORS_KNITTED, MCR_ROUTE.THIRTEEN_ORPHANS].includes(r.route)), 'any meld: no closed special shapes');
  const r2 = route('456b 789c 11d EE', [{ type: 'chi', kinds: [0, 1, 2], concealed: false }]);
  assert(r2.routes.some((r) => r.route === MCR_ROUTE.MIXED_STRAIGHT && r.shanten === 0), 'a melded 123d satisfies the Mixed Straight\'s first chow');
  const twoOdd = [{ type: 'pon', kinds: [29, 29, 29], concealed: false }, { type: 'pon', kinds: [30, 30, 30], concealed: false }];
  assert(!route('456b 789c 1d', twoOdd).routes.some((r) => r.route === MCR_ROUTE.MIXED_STRAIGHT), 'two unrelated melds leave no room for a straight');

  // Qualification.
  const open = [{ type: 'chi', kinds: [3, 4, 5], concealed: false }];
  const hf = route('123d 789d SS 9d W', open).routes.filter((r) => r.route === MCR_ROUTE.HALF_FLUSH && r.suit === 0)[0];
  assert(hf && hf.points === 6 && !hf.qualifies, 'an open Half Flush alone (6) does not qualify');
  const hfClosed = route('123d 456d 789d SS 9d W').routes.filter((r) => r.route === MCR_ROUTE.HALF_FLUSH && r.suit === 0)[0];
  assert(hfClosed.qualifies && hfClosed.points === 8, 'a closed Half Flush (6 + 2) qualifies');
  assert(route('123d 789d RR 9d W', open).routes.some((r) => r.route === MCR_ROUTE.HALF_FLUSH_HONOR && r.qualifies), '…an open one with a dragon pair to finish does');
  const plainOnly = analyzeMcrRoutes(C('159d 159b 159c E'), [{ type: 'pon', kinds: [29, 29, 29], concealed: false }], {});
  assert(plainOnly.valueShanten >= plainOnly.best.shanten, 'value shanten never below the best route');
  assertThrows(() => analyzeMcrRoutes([1, 2], []), TypeError, 'counts validated');

  assert(mcrWaitKinds(C('147d 258b 369c ESWR'), 0).length === 3 && mcrWaitKinds(C('123d 456b 789c 111d E'), 0).join() === String(E), 'waits by every MCR shape');
});

// ---------------------------------------------------------------------------
section('2. Basic', () => {
  const b = new BasicStrategy({ random: () => 0 });
  const offer = (p, faceId, fromSeat = 0) => rules.getLegalActions({ kind: 'discard', seatIndex: p.seatIndex, playerCount: 4, discard: { tile: Tile.fromId(faceId, `${faceId}#o`), fromSeat }, wallRemaining: 50 }, p).filter((a) => a.type !== ACTION_TYPE.WIN);
  const p = player('23d 55b 55c 789c 1d RR SS');
  assert(b.chooseClaim(p, offer(p, 'bamboo-5'), ctx()).type === ACTION_TYPE.PASS, 'a plain Pung → pass (stay closed)');
  assert(b.chooseClaim(p, offer(p, 'dots-4'), ctx()).type === ACTION_TYPE.PASS, 'a plain Chow → pass');
  assert(b.chooseClaim(p, offer(p, 'dragon-red'), ctx()).type === ACTION_TYPE.PON, 'a dragon Pung → claim');
  assert(b.chooseClaim(p, offer(p, 'wind-south'), ctx()).type === ACTION_TYPE.PON, 'the seat wind Pung → claim');
  const flush = player('23d 55d 678d 99d 1d RR');
  assert(b.chooseClaim(flush, offer(flush, 'dots-4'), ctx()).type === ACTION_TYPE.CHI, 'a Chow in the suit the hand is flushing → claim');
  assert(b.chooseClaim(flush, offer(flush, 'dots-5'), ctx()).type === ACTION_TYPE.PON, '…or a Pung');
  const hk = new BasicStrategy({ random: () => 0 });
  assert(hk.chooseClaim(p, offer(p, 'bamboo-5'), { ruleEngine: new HongKongRules() }).type === ACTION_TYPE.PON, 'Hong Kong unchanged: Basic still Pons everything');
  const win = { type: ACTION_TYPE.WIN, validation: { valid: true } };
  assert(b.chooseWinDeclaration(p, win, ctx()) === true && b.chooseWinDeclaration(p, { ...win, validation: { valid: false } }, ctx()) === false, 'wins follow the engine\'s validation');
});

// ---------------------------------------------------------------------------
section('3. Advanced', () => {
  const a = new AdvancedStrategy({ random: () => 0 });
  const value = (spec, melds = []) => {
    const p = player(spec, melds);
    return a._valueOfWaitingHand(C(spec), [], p.getHand().clone(), p, ctx(), null);
  };
  assert(value('123d 456b 789c 111d E').vs === 0, 'a Ron-able 8-point wait → 0');
  assert(value('234d 678b 345c 66d 45c').vs === 0.5, 'All Chows + All Simples: 6 on a discard, 8 self-drawn (Fully Concealed) → 0.5 (Tsumo only)');
  assert(value('147d 258b 369c ESWR').vs === 0, 'Honors and Knitted tenpai is recognised (special-shape waits)');
  assert(value('147d 258b 36c 555c EE').vs === 0, 'Knitted Straight tenpai is recognised');
  const blind = new AdvancedStrategy({ random: () => 0 });
  const p = player('147d 258b 369c ESWR');
  const bctx = ctx({ ruleEngine: Object.create(rules, { getRulesetId: { value: () => 'x' } }) });
  assert(blind._valueOfWaitingHand(C('147d 258b 369c ESWR'), [], p.getHand().clone(), p, bctx, null).vs > 0, 'without the MCR layer the same hand looks far from complete');

  // Discard: keep the Mixed Straight, throw the junk.
  const d = player('123d 456b 78c 11d 5b E S', [], 1);
  d.getHand().addConcealedTile(Tile.fromId('characters-9', 'characters-9#d'));
  const gmCtx = ctx({ seatIndex: 1, playerCount: 4, dealerIndex: 0, table: { discards: [[], [], [], []], melds: [[], [], [], []], dealerIndex: 0, roundWind: WIND.EAST, wallRemaining: 50, bonusTiles: [[], [], [], []] } });
  const t = a.chooseDiscard(d, gmCtx);
  assert(['bamboo-5', 'bamboo-9', 'wind-east', 'wind-south'].includes(t.id), `with 123d 456b 789c in hand the discard is junk, not a straight tile (${t.id})`);
  assert(a.getFallbackCount() === 0, 'no fallbacks');
});

// ---------------------------------------------------------------------------
section('4. Whole games', () => {
  for (const [n, tier] of [[4, 'basic'], [4, 'advanced'], [3, 'basic'], [3, 'advanced']]) {
    const strategies = [];
    const factories = {
      basic: () => { const s = new BasicStrategy({ random: () => 0.37 }); strategies.push(s); return s; },
      advanced: () => { const s = new AdvancedStrategy({ random: () => 0.37 }); strategies.push(s); return s; },
    };
    const cfg = buildPlayerConfigs({ playerCount: n, difficulty: tier, humanSeatIndex: -1 });
    const gm = new GameManager({ ruleEngine: new ChineseOfficialRules({ playerCount: n }), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories }), eventBus: new EventBus(), seed: 980 + n });
    let hands = 0; let wins = 0; let bad = 0; let errors = 0; let flowers = 0;
    try {
      for (let h = 0; h < 8; h++) {
        while (!gm.isRoundOver()) {
          gm.playAITurn();
          if (!gm.isRoundOver() && !tilesConserved(gm)) bad++;
        }
        hands++;
        flowers += gm.getTurnFlow().getSetAsideTiles().length;
        if (!tilesConserved(gm)) bad++;
        const o = gm.getLastOutcome();
        if (o.type === 'win') {
          wins++;
          for (const w of o.winners) if (!w.meetsMinimum || w.score.validation.points < 8) bad++;
        }
        gm.settleRound();
        if (gm.getPlayers().reduce((s, p) => s + p.score, 0) !== 0) bad++;
        if (gm.isGameComplete()) break;
        gm.startNextHand();
      }
    } catch (e) { errors++; console.error(e); }
    const fallbacks = strategies.filter((s) => typeof s.getFallbackCount === 'function').reduce((x, s) => x + s.getFallbackCount(), 0);
    assert(errors === 0 && bad === 0 && gm.isGameComplete() && hands === n, `${n}P ${tier}: ${hands} hands (${wins} won, ${flowers} flowers), complete, tiles + zero-sum + 8-point wins every turn / hand`);
    assert(fallbacks === 0, `${n}P ${tier}: no AI fallbacks (${fallbacks})`);
  }
});

// ---------------------------------------------------------------------------
section('5. Benchmarks', () => {
  const ci = (m, k = 1) => `${(k * m.mean).toFixed(2)} [${(k * (m.mean - 1.96 * m.se)).toFixed(2)}, ${(k * (m.mean + 1.96 * m.se)).toFixed(2)}]`;
  const run = (a, b, seeds) => {
    const rep = runBenchmark({ lineup: [a, b, a, b], seeds, seedBase: 9800, minimumFan: 0, ruleEngineFactory: () => new ChineseOfficialRules() });
    const sum = summarize(rep); const c = compareAgents(rep, a, b);
    console.log(`  ${a} vs ${b}, ${rep.outcomes.hands} hands: ${a} win ${(100 * sum[a].winRate).toFixed(1)}% deal-in ${(100 * sum[a].dealInRate).toFixed(1)}% ${sum[a].pointsPerHand.toFixed(1)} pts/hand · ${b} win ${(100 * sum[b].winRate).toFixed(1)}% deal-in ${(100 * sum[b].dealInRate).toFixed(1)}% ${sum[b].pointsPerHand.toFixed(1)} pts/hand`);
    console.log(`  difference per seat-hand: points ${ci(c.points)}, wins ${ci(c.wins, 100)} pp, deal-ins ${ci(c.dealIns, 100)} pp`);
    const inv = rep.invariants;
    assert(inv.errors + inv.conservationFailures + inv.zeroSumFailures + inv.underMinimumWins === 0, `${a} vs ${b}: no errors, tiles + zero-sum + minimum held`);
    return c;
  };
  const vb = run('advanced', 'basic', 40);
  assert(vb.points.mean - 1.96 * vb.points.se > 0 && vb.wins.mean - 1.96 * vb.wins.se > 0, 'Advanced beats Basic in MCR on points and wins (95% CIs above 0)');
  const vm = run('advanced', 'advanced-mcr-blind', 120);
  assert(vm.points.mean - 1.96 * vm.points.se > 0, 'the MCR value routes beat the generic planner on points (95% CI above 0)');
});

summary();

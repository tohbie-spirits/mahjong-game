/**
 * handValuePlanner.test.mjs — Task 78b: fan-aware Advanced AI.
 *
 * Sections:
 *   1. calculateShantenUnchecked / calculatePungsShanten (evaluator additions)
 *   2. honorPungFan / guaranteedFan
 *   3. analyzeValueRoutes — routes, qualification against the minimum fan,
 *      melds that kill routes, minimumFan 0 ≡ plain shanten, validation
 *   4. AdvancedStrategy value behaviour — avoids a "dead" (too-cheap) tenpai,
 *      refuses a Chi that kills every qualifying route, takes a dragon Pon,
 *      useValue:false keeps the Task 78 path
 *   5. Held-out benchmark at the real 3-fan minimum (seeds 12000, never used
 *      for tuning): Advanced vs Basic, seats swapped
 *
 * Run: node tests/ai/handValuePlanner.test.mjs
 */
import { section, assert, assertThrows, summary, mulberry32 } from '../_helpers/harness.mjs';
import { tiles, makeTileFactory } from '../_helpers/tiles.mjs';
import { AdvancedStrategy, tileToKindIndex } from '../../src/ai/advanced/AdvancedStrategy.js';
import { countsFromTiles, calculateShanten, calculateShantenUnchecked, calculatePungsShanten } from '../../src/ai/advanced/HandEfficiencyEvaluator.js';
import { ROUTE, ROUTE_FAN, honorPungFan, guaranteedFan, analyzeValueRoutes } from '../../src/ai/advanced/HandValuePlanner.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { ACTION_TYPE, AI_DIFFICULTY, SEAT_KIND, WIND } from '../../src/utils/constants.js';

const C = (spec) => countsFromTiles(tiles(spec), tileToKindIndex);
const E = 27, S = 28, N = 30, RED = 31;
const roles = { seatWindIndex: S, roundWindIndex: E };
const opt3 = { minimumFan: 3, ...roles };

section('Evaluator additions', () => {
  assert(calculateShantenUnchecked(C('123d 456b 789c 55c 99b')) === 0, 'unchecked = regular shanten on a 13-tile tenpai');
  assert(calculateShantenUnchecked(C('123d 456d 78d 99d')) === 2, 'fewer tiles allowed (flush projection): missing tiles count as distance (10 tiles → 2)');
  assert(calculateShantenUnchecked(C('123d 456d 99d'), 1) === 1, 'meldCount reduces the sets needed');
  assert(calculatePungsShanten(C('111d 222b 333c 44c 99b')) === 0, 'four sets… three pungs + two pairs → tenpai for all pungs');
  assert(calculatePungsShanten(C('123d 456b 789c 55c 99b')) === 6, 'no triplets, two pairs → far from all pungs');
  assert(calculatePungsShanten(C('111d 22b 99b'), 2) === 0, 'with two exposed pungs, one triplet + two pairs = tenpai');
  assert(calculatePungsShanten(C('111d 222b 99b'), 2) === -1, 'with two exposed pungs, two triplets + pair = complete (−1)');
  assert(calculatePungsShanten(C('11d 22b 33c 44c 55d 6b 7b')) === 3, 'five pairs: 2·4 − 4 partials − eye = 3');
});

section('honorPungFan / guaranteedFan', () => {
  assert(honorPungFan(RED, roles) === 1 && honorPungFan(S, roles) === 1 && honorPungFan(E, roles) === 1, 'dragon / seat wind / prevailing wind = 1 each');
  assert(honorPungFan(N, roles) === 0 && honorPungFan(5, roles) === 0, 'ordinary wind and suit tiles = 0');
  assert(honorPungFan(E, { seatWindIndex: E, roundWindIndex: E }) === 2, 'dealer in the East round: East pung = 2');
  assert(guaranteedFan(C('123d 456b 789c 55c 99b'), []) === ROUTE_FAN.concealed, 'fully concealed → 1');
  assert(guaranteedFan(C('123d 456b RRR 5c'), [{ type: 'chi', kinds: [18, 19, 20], concealed: false }], roles) === 1, 'concealed dragon triplet counts, exposed chi loses Concealed');
  assert(guaranteedFan(C('123d 456b 5c 6c'), [{ type: 'pon', kinds: [S, S, S], concealed: false }], roles) === 1, 'exposed seat-wind pon counts');
});

section('analyzeValueRoutes', () => {
  const cheap = analyzeValueRoutes(C('123d 456b 789c 55c 99b'), [], opt3);
  const plain = cheap.routes.find((r) => r.route === ROUTE.PLAIN);
  assert(plain.shanten === 0 && plain.fan === 1 && !plain.qualifies, 'cheap tenpai: plain route is tenpai but only 1 fan → does not qualify');
  assert(cheap.valueShanten > 0 && cheap.best.qualifies, `value shanten comes from a qualifying route (${cheap.best.route}, ${cheap.valueShanten})`);

  const pungs = analyzeValueRoutes(C('111d 222b 333c 44c 99b'), [], opt3);
  assert(pungs.valueShanten === 0 && pungs.best.route === ROUTE.ALL_PUNGS && pungs.best.fan >= 3, 'all-pungs tenpai qualifies (3 + concealed)');

  const flush = analyzeValueRoutes(C('123d 456d 789d 22d 5b 9c'), [], opt3);
  assert(flush.valueShanten === 1 && flush.best.route === ROUTE.FLUSH && flush.best.suit === 0, 'one-suit hand: dots flush route at the plain distance');

  const dealer = analyzeValueRoutes(C('EE 123d 456b 789c 5c 7c'), [], { minimumFan: 3, seatWindIndex: E, roundWindIndex: E });
  const hp = dealer.routes.find((r) => r.route === ROUTE.HONOR_PUNG);
  assert(hp && hp.honor === E && hp.fan === 3 && hp.qualifies, 'double-East pair → honour-pung route worth 3 (2 + concealed)');
  assert(!analyzeValueRoutes(C('NN 123d 456b 789c 5c 7c'), [], opt3).routes.some((r) => r.route === ROUTE.HONOR_PUNG), 'ordinary-wind pair → no honour route');

  const chi = { type: 'chi', kinds: [0, 1, 2], concealed: false };
  const withChi = analyzeValueRoutes(C('111b 222b 33c 4c 5c 6c'), [chi], opt3).routes.map((r) => r.route + (r.suit ?? ''));
  assert(!withChi.includes(ROUTE.ALL_PUNGS), 'an exposed chi kills all pungs');
  assert(withChi.includes('flush0') && !withChi.includes('flush1') && !withChi.includes('flush2'), 'a dots meld kills the bamboo and character flushes');

  const redPon = analyzeValueRoutes(C('234d 567d 88d 9d 1d'), [{ type: 'pon', kinds: [RED, RED, RED], concealed: false }], opt3);
  assert(redPon.routes.find((r) => r.route === ROUTE.PLAIN).fan === 1, 'exposed dragon pon: plain route keeps its 1 fan (no Concealed)');
  assert(redPon.routes.find((r) => r.route === ROUTE.FLUSH && r.suit === 0).fan === 4, 'dragon pon does not block a dots flush (1 + 3)');

  for (const spec of ['123d 456b 789c 55c 9b E', '11d 22b 33c 44c 55d 6b 7b 9c', 'RR 123d 456b 789c 5c 7c']) {
    assert(analyzeValueRoutes(C(spec), [], { minimumFan: 0 }).valueShanten === calculateShanten(C(spec)), `minimumFan 0 → value shanten = plain shanten (${spec})`);
  }
  assertThrows(() => analyzeValueRoutes([1, 2], []), TypeError, 'bad counts throw');
  assertThrows(() => analyzeValueRoutes(C('1d'), [{ type: 'x', kinds: [] }]), TypeError, 'bad meld throws');
  assertThrows(() => analyzeValueRoutes(C('1d'), [], { minimumFan: -1 }), TypeError, 'negative minimum throws');
});

function aiPlayer(spec, seatIndex = 1, f = makeTileFactory()) {
  const p = new PlayerManager({ seatIndex, seatKind: SEAT_KIND.AI, aiDifficulty: AI_DIFFICULTY.ADVANCED });
  for (const t of tiles(spec, f)) p.addTileToHand(t);
  p.seatWind = WIND.SOUTH;
  return p;
}
const emptyTable = () => ({ discards: [[], [], [], []], melds: [[], [], [], []] });
const ctx = (extra = {}) => ({ ruleEngine: new HongKongRules(), seatIndex: 1, playerCount: 4, seatWind: WIND.SOUTH, roundWind: WIND.EAST, wallRemaining: 50, table: emptyTable(), ...extra });
function claimsFor(p, disc, rules = new HongKongRules()) {
  return rules.getLegalActions({ kind: 'discard', seatIndex: 1, playerCount: 4, discard: { tile: disc, fromSeat: 0 }, wallRemaining: 50, seatWind: WIND.SOUTH, roundWind: WIND.EAST }, p)
    .filter((a) => a.type !== ACTION_TYPE.WIN);
}

section('AdvancedStrategy value behaviour', () => {
  // 22c 23d 567d 7d 89d NNN E — dropping East reaches a 1-fan tenpai (North is
  // nobody's wind here) that can never be declared at 3 fan.
  const p = aiPlayer('22c 23567789d NNN E');
  const blind = new AdvancedStrategy({ useValue: false });
  const value = new AdvancedStrategy();
  const b = blind.chooseDiscard(p, ctx());
  const v = value.chooseDiscard(p, ctx());
  assert(b.id === 'wind-east', 'fan-blind: throws East for the fastest (dead) tenpai');
  assert(v.id !== 'wind-east' && v.id === 'characters-2', `value-aware: breaks the off-suit pair toward a dots flush instead (${v.id})`);
  assert(value.lastValueShanten === 1, 'value-aware records value shanten 1 for that plan');
  assert(new AdvancedStrategy().chooseDiscard(p, ctx({ ruleEngine: new HongKongRules({ minimumFan: 1 }) })).id === 'wind-east', 'at a 1-fan minimum the cheap tenpai is fine again');

  const f = makeTileFactory();
  const chiHand = aiPlayer('33b 7b 2c 55c 89d G N WWW', 1, f);
  const d7 = f('dots-7');
  const acts = claimsFor(chiHand, d7);
  const c = ctx({ table: { discards: [[d7], [], [], []], melds: [[], [], [], []] }, discard: { tile: d7, fromSeat: 0 } });
  assert(acts.some((a) => a.type === ACTION_TYPE.CHI), 'fixture: a Chi of 7-8-9 dots is legal');
  assert(blind.chooseClaim(chiHand, acts, c).type === ACTION_TYPE.CHI, 'fan-blind: takes the Chi (pure progress)');
  assert(value.chooseClaim(chiHand, acts, c).type === ACTION_TYPE.PASS, 'value-aware: passes — opening with a chi throws away Concealed with no fan in sight');

  const ponHand = aiPlayer('1b 5b 8b 6c 1234d HH EE S', 1, f);
  const dw = f('dragon-white');
  const ponActs = claimsFor(ponHand, dw);
  const pon = value.chooseClaim(ponHand, ponActs, ctx({ table: { discards: [[dw], [], [], []], melds: [[], [], [], []] }, discard: { tile: dw, fromSeat: 0 } }));
  assert(pon.type === ACTION_TYPE.PON && pon.faceId === 'dragon-white', 'value-aware: Pon of a dragon (guaranteed fan) accepted');
  assert(value.getFallbackCount() === 0 && blind.getFallbackCount() === 0, 'no fallbacks');
});

function playHands({ kinds, games, seedBase, strategies, minimumFan }) {
  const rules = new HongKongRules({ minimumFan });
  const res = { errors: 0, underMin: 0, winsBy: { advanced: 0, basic: 0 }, pointsBy: { advanced: 0, basic: 0 }, dealInsBy: { advanced: 0, basic: 0 } };
  const cfg = kinds.map((k, i) => ({ seatIndex: i, displayName: `${k} ${i}`, seatKind: SEAT_KIND.AI, aiDifficulty: k }));
  for (let g = 0; g < games; g++) {
    const gm = new GameManager({ ruleEngine: rules, playerConfigs: cfg, aiManager: new AIManager({ strategies: strategies(g) }), eventBus: new EventBus(), seed: seedBase + g });
    try {
      const out = gm.playRoundWithAI({ maxTurns: 800 });
      gm.settleRound();
      if (out.type === 'win') {
        for (const w of out.winners) {
          res.winsBy[kinds[w.seatIndex]]++;
          if (!w.meetsMinimum) res.underMin++;
          if (w.winType === 'discard') res.dealInsBy[kinds[w.calledFrom]]++;
        }
      }
      gm.getPlayers().forEach((pl, i) => { res.pointsBy[kinds[i]] += pl.score; });
    } catch (e) {
      res.errors++;
      if (res.errors < 3) console.error(e);
    }
  }
  return res;
}

section('Held-out benchmark (3-fan minimum, seeds 12000)', () => {
  const G = 150;
  const advs = [];
  const strategies = (g) => { const a = new AdvancedStrategy({ random: mulberry32(g + 999) }); advs.push(a); return [new BasicStrategy({ random: mulberry32(g) }), a]; };
  const a = playHands({ kinds: ['advanced', 'basic', 'advanced', 'basic'], games: G, seedBase: 12000, strategies, minimumFan: 3 });
  const b = playHands({ kinds: ['basic', 'advanced', 'basic', 'advanced'], games: G, seedBase: 12000, strategies, minimumFan: 3 });
  const sum = (f, k) => a[f][k] + b[f][k];
  const w = { A: sum('winsBy', 'advanced'), B: sum('winsBy', 'basic') };
  const d = { A: sum('dealInsBy', 'advanced'), B: sum('dealInsBy', 'basic') };
  const pts = { A: sum('pointsBy', 'advanced'), B: sum('pointsBy', 'basic') };
  console.log(`    ${2 * G} hands: wins A ${w.A} / B ${w.B} · deal-ins A ${d.A} / B ${d.B} · points A ${pts.A} / B ${pts.B}`);
  assert(a.errors + b.errors === 0 && pts.A + pts.B === 0, 'no errors; points zero-sum');
  assert(a.underMin + b.underMin === 0, 'every win meets the minimum fan');
  assert(w.A > 1.5 * w.B, 'Advanced wins clearly more hands than Basic (>1.5×)');
  assert(pts.A > 0 && d.A < d.B, 'Advanced finishes ahead on points and deals in less');
  assert(advs.every((s) => s.getFallbackCount() === 0), 'no decision fell back to Basic');
});

summary();

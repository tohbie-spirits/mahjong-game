/**
 * chineseOfficialFullGameSimulation.test.mjs — Task 100: headless full-game
 * simulation of the Chinese Official (MCR) ruleset (the counterpart of Task
 * 34's Hong Kong and Task 92's Riichi simulations).
 *
 * Whole sessions are played all-AI through the real GameManager, turn by
 * turn, with invariants checked after EVERY turn and every hand.
 *
 * Sections:
 *   1. Breadth — 12 East-round sessions (4P / 3P × basic / advanced / mixed ×
 *      2 seeds). Per turn: every tile accounted for (hands, melds, discards,
 *      the wall and the flowers set aside), hand sizes 13 / 14 net of Kongs,
 *      no flower ever in a hand. Per hand: at most one winner; every win
 *      re-checked — a valid MCR win worth ≥ 8 points WITHOUT flowers, the
 *      points equal to its fans, no fan beside a fan that excludes it, the
 *      flower points equal to the winner's flowers; transfers exactly MCR's
 *      base-8 settlement; zero-sum; the deal passes every hand.
 *   2. Full games — 16 hands (4P, East → North) and 12 hands (3P)
 *   3. Determinism — the same seed and seats replay the identical session
 *   4. Save / restore at a hand boundary — plays to the end under the same
 *      invariants; the hand already dealt replays exactly
 *   5. Plausibility — over every hand above: win / draw rates, Ron vs Tsumo,
 *      average points, flowers, Chicken Hands, the variety of fans
 *
 * Run: node tests/core/chineseOfficialFullGameSimulation.test.mjs   (slow suite)
 */
import { section, assert, summary } from '../_helpers/harness.mjs';
import { tilesConserved } from '../_helpers/aiBenchmark.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { MCR_FANS } from '../../src/rules/chineseOfficial/ChineseOfficialScoring.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { RULESET_ID, WIND } from '../../src/utils/constants.js';

const STATS = { hands: 0, wins: 0, ron: 0, tsumo: 0, draws: 0, points: 0, flowers: 0, flowerWins: 0, chicken: 0, turns: 0, fans: new Map(), maxPoints: 0 };

function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const factoriesFor = (rng) => ({ basic: () => new BasicStrategy({ random: rng }), advanced: () => new AdvancedStrategy({ random: rng }) });

function newGame(n, tier, seed, extra = {}) {
  const cfg = buildPlayerConfigs({ playerCount: n, difficulty: tier === 'mixed' ? 'basic' : tier, humanSeatIndex: -1 });
  if (tier === 'mixed') cfg.forEach((c, i) => { c.aiDifficulty = i % 2 ? 'basic' : 'advanced'; });
  const rng = makeRng(seed * 7919);
  const gm = new GameManager({ ruleEngine: new ChineseOfficialRules({ playerCount: n }), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: factoriesFor(rng) }), eventBus: new EventBus(), seed, ...extra });
  gm.__rng = rng;
  return gm;
}

const scoreSum = (gm) => gm.getPlayers().reduce((a, p) => a + p.score, 0);

function turnProblems(gm) {
  const out = [];
  if (!tilesConserved(gm)) out.push('tiles not conserved');
  for (const p of gm.getPlayers()) {
    const h = p.getHand();
    if (h.concealedTiles.some((t) => t.isBonus)) out.push(`seat ${p.seatIndex} holds a flower`);
    const kongs = h.melds.filter((m) => m.type === 'kong').length;
    const size = h.allTiles.length - kongs;
    if (size !== 13 && size !== 14) out.push(`seat ${p.seatIndex} holds ${size} tiles (net of Kongs)`);
  }
  return out;
}

function winProblems(gm, w, transfers, n) {
  const out = []; const tag = `seat ${w.seatIndex}`;
  const v = w.score?.validation;
  if (!v || !v.valid || !w.meetsMinimum) return [`${tag}: not a valid win`];
  if (v.points < 8) out.push(`${tag}: ${v.points} points (flowers excluded)`);
  if (v.points !== v.fans.reduce((a, f) => a + f.points, 0)) out.push(`${tag}: points ≠ sum of fans`);
  const ids = v.fans.map((f) => f.id);
  if (ids.some((id) => ids.some((o) => MCR_FANS[o].excludes.includes(id)))) out.push(`${tag}: a fan beside one that excludes it (${ids.join(' ')})`);
  if (ids.includes('chicken-hand') && ids.length > 1) out.push(`${tag}: Chicken Hand with other fans`);
  const flowers = gm.getTurnFlow().getFlowerCount(w.seatIndex);
  if (v.flowerPoints !== flowers || w.points !== v.points + flowers) out.push(`${tag}: flower points ${v.flowerPoints} / total ${w.points} with ${flowers} flowers`);
  const want = [];
  for (let s = 0; s < n; s++) if (s !== w.seatIndex) want.push(`${s}:${w.winType === 'self' || s === w.calledFrom ? 8 + w.points : 8}`);
  const got = transfers.map((t) => `${t.from}:${t.amount}`);
  if (want.sort().join() !== got.sort().join() || transfers.some((t) => t.to !== w.seatIndex)) out.push(`${tag}: transfers ${got.join()} ≠ ${want.join()}`);
  return out;
}

/** Plays a whole session turn by turn. `onHandBoundary(gm, hands)` may return a replacement GameManager. */
function playSession(gm, { onHandBoundary = null, label = '' } = {}) {
  const n = gm.getPlayers().length;
  const problems = []; const log = [];
  const note = (msg) => { if (problems.length < 20) problems.push(`${label} hand ${log.length + 1}: ${msg}`); };
  let hands = 0;
  try {
    for (let guard = 0; guard < 40; guard++) {
      const dealerBefore = gm.getDealerIndex();
      let turns = 0;
      while (!gm.isRoundOver()) {
        if (turns++ > 800) throw new Error('turn limit reached');
        const r = gm.playAITurn();
        if (r.type === 'not-applicable') throw new Error(`playAITurn: ${r.reason}`);
        if (!gm.isRoundOver()) for (const m of turnProblems(gm)) note(m);
      }
      hands++; STATS.turns += turns; STATS.hands++;
      const outcome = gm.getLastOutcome();
      if (!tilesConserved(gm)) note('tiles not conserved at the end');
      const flowersThisHand = gm.getTurnFlow().getSetAsideTiles().length;
      STATS.flowers += flowersThisHand;
      const st = gm.settleRound();
      if (scoreSum(gm) !== 0) note(`scores sum to ${scoreSum(gm)}`);
      if (outcome.type === 'win') {
        STATS.wins++;
        if (outcome.winners.length !== 1) note(`${outcome.winners.length} winners`);
        for (const w of outcome.winners) {
          if (w.winType === 'discard') STATS.ron++; else STATS.tsumo++;
          STATS.points += w.points;
          STATS.maxPoints = Math.max(STATS.maxPoints, w.points);
          if (w.score.validation.flowerPoints > 0) STATS.flowerWins++;
          for (const f of w.score.validation.fans) { STATS.fans.set(f.id, (STATS.fans.get(f.id) ?? 0) + 1); if (f.id === 'chicken-hand') STATS.chicken++; }
          for (const m of winProblems(gm, w, st.transfers, n)) note(m);
        }
      } else if (outcome.type === 'draw') {
        STATS.draws++;
        if (st.transfers.length) note('points moved on a draw');
      } else note(`unexpected outcome ${outcome.type}`);
      log.push(`${outcome.type}:${outcome.type === 'win' ? outcome.winners.map((w) => `${w.seatIndex}${w.winType[0]}${w.points}`).join('+') : ''}|${gm.getPlayers().map((p) => p.score).join(',')}`);
      if (gm.isGameComplete()) break;
      gm.startNextHand();
      if (gm.getDealerIndex() !== (dealerBefore + 1) % n) note('the deal did not pass');
      if (onHandBoundary) gm = onHandBoundary(gm, hands) ?? gm;
    }
  } catch (e) {
    problems.push(`${label}: threw ${e.message}`);
  }
  return { hands, problems, log, gm };
}

const runs = [];

// ---------------------------------------------------------------------------
section('1. Breadth — 12 East-round sessions', () => {
  let seed = 1000;
  for (const n of [4, 3]) {
    for (const tier of ['basic', 'advanced', 'mixed']) {
      for (let k = 0; k < 2; k++) {
        const gm = newGame(n, tier, ++seed);
        const label = `${n}P ${tier} seed ${seed}`;
        const r = playSession(gm, { label });
        runs.push({ n, tier, seed, ...r });
        assert(r.problems.length === 0 && r.gm.isGameComplete() && r.hands === n, `${label}: ${r.hands} hands, complete, every invariant held${r.problems.length ? ' — ' + r.problems.slice(0, 3).join(' | ') : ''}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
section('2. Full games', () => {
  const g4 = newGame(4, 'advanced', 1100, { finalRoundWind: WIND.NORTH });
  const r4 = playSession(g4, { label: '4P full' });
  assert(r4.problems.length === 0 && r4.hands === 16 && r4.gm.isGameComplete(), `4P Advanced, East → North: 16 hands, every invariant${r4.problems.length ? ' — ' + r4.problems.slice(0, 3).join(' | ') : ''}`);
  const g3 = newGame(3, 'mixed', 1101, { finalRoundWind: WIND.NORTH });
  const r3 = playSession(g3, { label: '3P full' });
  assert(r3.problems.length === 0 && r3.hands === 12 && r3.gm.isGameComplete(), `3P mixed, East → North: 12 hands, every invariant${r3.problems.length ? ' — ' + r3.problems.slice(0, 3).join(' | ') : ''}`);
});

// ---------------------------------------------------------------------------
section('3. Determinism', () => {
  for (const [n, tier, seed] of [[4, 'mixed', 1005], [3, 'advanced', 1009]]) {
    const ref = runs.find((x) => x.n === n && x.tier === tier && x.seed === seed);
    const again = playSession(newGame(n, tier, seed), { label: 'replay' });
    assert(ref && again.log.join('\n') === ref.log.join('\n'), `${n}P ${tier} seed ${seed}: the replay is identical hand for hand`);
  }
});

// ---------------------------------------------------------------------------
section('4. Save / restore at a hand boundary', () => {
  for (const [n, tier, seed] of [[4, 'basic', 1001], [3, 'mixed', 1011]]) {
    const ref = runs.find((x) => x.n === n && x.tier === tier && x.seed === seed);
    let restored = 0;
    const r = playSession(newGame(n, tier, seed), {
      label: 'restored',
      onHandBoundary: (gm, hands) => {
        if (hands !== 1) return null;
        restored++;
        const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.CHINESE_OFFICIAL, difficulty: tier })));
        const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: { [RULESET_ID.CHINESE_OFFICIAL]: () => new ChineseOfficialRules({ playerCount: n }) }, STRATEGY_FACTORIES: factoriesFor(gm.__rng), eventBus: new EventBus() });
        back.__rng = gm.__rng;
        return back;
      },
    });
    assert(restored === 1 && r.problems.length === 0 && r.gm.isGameComplete(), `${n}P ${tier}: saved and restored after hand 1, played to the end with every invariant${r.problems.length ? ' — ' + r.problems.slice(0, 3).join(' | ') : ''}`);
    // The wall RNG is not saved by design, so only the hand already dealt can be compared.
    assert(ref && r.log.slice(0, 2).join('\n') === ref.log.slice(0, 2).join('\n'), `${n}P ${tier}: the hand dealt before the save plays out exactly as in the uninterrupted session`);
  }
});

// ---------------------------------------------------------------------------
section('5. Plausibility', () => {
  const S = STATS; const pc = (x) => `${(100 * x).toFixed(1)}%`;
  const winRate = S.wins / S.hands; const ronShare = S.ron / Math.max(1, S.ron + S.tsumo);
  const avg = S.points / Math.max(1, S.wins);
  const top = [...S.fans.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, c]) => `${id} ${c}`).join(', ');
  console.log(`  ${S.hands} hands: won ${pc(winRate)} (Ron ${pc(ronShare)}), drawn ${pc(S.draws / S.hands)}; avg ${avg.toFixed(1)} points per win (max ${S.maxPoints}); ${(S.flowers / S.hands).toFixed(2)} flowers set aside per hand, flowers in ${pc(S.flowerWins / Math.max(1, S.wins))} of wins; Chicken Hands ${S.chicken}; ${S.fans.size} different fans; ${(S.turns / S.hands).toFixed(0)} AI turns / hand`);
  console.log(`  most common fans: ${top}`);
  assert(S.hands >= 60, `enough hands simulated (${S.hands})`);
  assert(winRate >= 0.3 && winRate <= 0.95, `win rate ${pc(winRate)} is plausible (30–95%)`);
  assert(S.draws > 0, 'some hands end in a draw');
  assert(ronShare > 0.2 && ronShare < 0.95, `both Ron and Tsumo happen (Ron ${pc(ronShare)})`);
  assert(avg >= 8 && avg <= 60, `average points per win ${avg.toFixed(1)} is plausible`);
  assert(S.flowers / S.hands > 3 && S.flowers / S.hands <= 8, `flowers set aside per hand ${(S.flowers / S.hands).toFixed(2)} (8 in the wall; most come out)`);
  assert(S.fans.size >= 20, `a wide variety of fans scored (${S.fans.size})`);
});

summary();

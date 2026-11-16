/**
 * riichiFullGameSimulation.test.mjs — Task 92: headless full-game simulation
 * of the Riichi ruleset (the Riichi counterpart of Task 34's HK simulation).
 *
 * Whole sessions are played all-AI through the real GameManager — turn by
 * turn, with invariants checked after EVERY turn and after every hand — for
 * 4- and 3-player tables with Basic, Advanced and mixed seats.
 *
 * Sections:
 *   1. Breadth — 12 East-round sessions (4P / 3P × basic / advanced / mixed ×
 *      2 seeds). Per turn: tile conservation (hands, discards, live wall,
 *      dead wall, tiles cut off by Kans), hand sizes, riichi hands closed.
 *      Per hand: scores + table sticks = starting total; every win valid
 *      (a real yaku besides dora, han = sum of the breakdown, fu a multiple of
 *      10 or 25 for Seven Pairs, base points / limit / payments by the
 *      formula, the winner gains at least the payment); draws and abortive
 *      draws zero-sum; honba and dealer continuation by the rules. Per session:
 *      ends within the cap, final scores alone sum exactly (leftover sticks).
 *   2. Half-game (East + South) — 4P and 3P: the session reaches the South
 *      round (or ends early on a bust) with every invariant intact.
 *   3. Determinism — the same seed and seats replay the identical session.
 *   4. Save / restore at a hand boundary — the restored game plays to the end
 *      under the same invariants; the hand already dealt replays exactly (later
 *      walls are fresh by design — the wall RNG is not saved).
 *   5. Plausibility — over every hand played above: win / draw / abortive
 *      rates, Ron vs Tsumo, riichi frequency, average han, limit hands.
 *   6. Advanced vs Basic, points — duplicate-format benchmark on Riichi.
 *
 * Run: node tests/core/riichiFullGameSimulation.test.mjs   (slow suite, a few minutes)
 */
import { section, assert, summary } from '../_helpers/harness.mjs';
import { tilesConserved, runBenchmark, compareAgents, summarize } from '../_helpers/aiBenchmark.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { Tile } from '../../src/core/Tile.js';
import { faceIds } from '../_helpers/tiles.mjs';
import { resolveExhaustiveDraw } from '../../src/core/DrawResolver.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { RULESET_ID, WIND } from '../../src/utils/constants.js';

const START = { 4: 100000, 3: 105000 };
const ceil100 = (x) => Math.ceil(x / 100) * 100;

/** Aggregate statistics over every hand of every session (section 5). */
const STATS = { hands: 0, wins: 0, ron: 0, tsumo: 0, multiRon: 0, draws: 0, abortive: 0, riichiHands: 0, riichiDeclarations: 0, winHan: 0, winsScored: 0, limitWins: 0, yakuman: 0, sevenPairs: 0, turns: 0, nagashi: 0 };

function seatsFor(n, tier) {
  const cfg = buildPlayerConfigs({ playerCount: n, difficulty: tier === 'mixed' ? 'basic' : tier, humanSeatIndex: -1 });
  if (tier === 'mixed') cfg.forEach((c, i) => { c.aiDifficulty = i % 2 ? 'basic' : 'advanced'; });
  return cfg;
}

/**
 * The AIs break ties with `random` (Math.random by default), so the wall seed
 * alone does not replay a game. Each simulated game gets one seeded generator
 * shared by its seats; a restored game is handed the SAME generator, so the
 * draw order of random numbers carries on exactly as if never interrupted.
 */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const factoriesFor = (rng) => ({ basic: () => new BasicStrategy({ random: rng }), advanced: () => new AdvancedStrategy({ random: rng }) });

function newGame(n, tier, seed, extra = {}) {
  const cfg = seatsFor(n, tier);
  const rng = makeRng(seed * 7919);
  const gm = new GameManager({ ruleEngine: new RiichiRules({ playerCount: n }), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: factoriesFor(rng) }), eventBus: new EventBus(), seed, ...extra });
  gm.__rng = rng;
  return gm;
}

const scoreSum = (gm) => gm.getPlayers().reduce((a, p) => a + p.score, 0);
const tableTotal = (gm) => scoreSum(gm) + gm.getTurnFlow().riichiSticks * 1000;

/** Problems found in the current state, mid-hand (empty = fine). */
function turnProblems(gm) {
  const out = [];
  if (!tilesConserved(gm)) out.push('tiles not conserved');
  const flow = gm.getTurnFlow();
  for (const p of gm.getPlayers()) {
    const h = p.getHand();
    const kans = h.melds.filter((m) => m.type === 'kong').length;
    const size = h.allTiles.length - kans;
    if (size !== 13 && size !== 14) out.push(`seat ${p.seatIndex} holds ${size} tiles (net of Kans)`);
    if (flow.isRiichi(p.seatIndex) && !h.melds.every((m) => m.concealed)) out.push(`seat ${p.seatIndex} in riichi with an open meld`);
  }
  return out;
}

/** Checks one scored winner; returns problems. */
function winProblems(gm, w, transfers, n) {
  const out = []; const s = w.score; const tag = `seat ${w.seatIndex}`;
  if (!s || !s.meetsMinimum) return [`${tag}: win below the minimum`];
  const yaku = s.breakdown.filter((b) => !b.isDora);
  if (!yaku.length) out.push(`${tag}: no yaku besides dora`);
  if (s.yakuman > 0) {
    if (s.basePoints !== 8000 * s.yakuman) out.push(`${tag}: yakuman base ${s.basePoints}`);
  } else {
    const hanSum = s.breakdown.reduce((a, b) => a + (b.han || 0), 0);
    if (hanSum !== s.han) out.push(`${tag}: han ${s.han} ≠ breakdown ${hanSum}`);
    if (s.han < 1) out.push(`${tag}: ${s.han} han`);
    if (!(s.fu === 25 ? s.structure === 'seven-pairs' : s.fu % 10 === 0 && s.fu >= 20 && s.fu <= 110)) out.push(`${tag}: fu ${s.fu}`);
    if (s.han < 5) {
      const b = s.fu * 2 ** (s.han + 2);
      const expect = b >= 2000 ? 2000 : b;
      if (s.basePoints !== expect || (b < 2000) !== (s.limit === null)) out.push(`${tag}: base ${s.basePoints} for ${s.han} han ${s.fu} fu`);
    } else if (s.limit === null) out.push(`${tag}: ${s.han} han but no limit`);
  }
  const b = s.basePoints; const p = s.payments;
  if (w.winType === 'discard') {
    if (p.ron !== ceil100(b * (s.isDealer ? 6 : 4))) out.push(`${tag}: Ron payment ${p.ron} for base ${b}`);
  } else if (s.isDealer) {
    if (p.nonDealer !== ceil100(b * 2) || p.total !== p.nonDealer * (n - 1)) out.push(`${tag}: dealer Tsumo payments ${JSON.stringify(p)}`);
  } else if (p.dealer !== ceil100(b * 2) || p.nonDealer !== ceil100(b) || p.total !== p.dealer + p.nonDealer * (n - 2)) out.push(`${tag}: Tsumo payments ${JSON.stringify(p)}`);
  const paid = transfers.filter((t) => t.to === w.seatIndex && t.from !== null && t.reason !== 'honba' && t.reason !== 'leftover-sticks').reduce((a, t) => a + t.amount, 0);
  if (paid !== p.total) out.push(`${tag}: received ${paid} for the hand, payment is ${p.total} (${JSON.stringify(transfers)})`);
  if (s.points !== p.total) out.push(`${tag}: points ${s.points} ≠ payments total ${p.total}`);
  return out;
}

/**
 * Plays a whole session turn by turn. Returns { hands, problems, log, gm }.
 * `log` is a per-hand fingerprint used for determinism checks.
 * `onHandBoundary(gm, hands)` may return a replacement GameManager.
 */
function playSession(gm, { maxTurnsPerHand = 800, onHandBoundary = null, label = '' } = {}) {
  const n = gm.getPlayers().length;
  const start = START[n];
  const problems = []; const log = [];
  const note = (msg) => { if (problems.length < 20) problems.push(`${label} hand ${log.length + 1}: ${msg}`); };
  let hands = 0;
  try {
    for (let guard = 0; guard <= gm.getMaxHands(); guard++) {
      const flow = gm.getTurnFlow();
      const honbaBefore = flow.honba;
      const dealerBefore = gm.getDealerIndex();
      const before = gm.getPlayers().map((p) => p.score);
      const sticksBefore = flow.riichiSticks;
      let turns = 0; const riichiSeen = new Set();
      while (!gm.isRoundOver()) {
        if (turns++ > maxTurnsPerHand) throw new Error('turn limit reached');
        const r = gm.playAITurn();
        if (r.type === 'not-applicable') throw new Error(`playAITurn: ${r.reason}`);
        for (const s of flow.getRiichiSeats()) riichiSeen.add(s);
        if (!gm.isRoundOver()) for (const m of turnProblems(gm)) note(m);
      }
      hands++;
      STATS.turns += turns;
      const outcome = gm.getLastOutcome();
      if (!tilesConserved(gm)) note('tiles not conserved at the end');
      const st = gm.settleRound();
      const complete = gm.isGameComplete();
      const deltas = gm.getPlayers().map((p, i) => p.score - before[i]);
      const leftover = st.transfers.find((t) => t.reason === 'leftover-sticks');

      // Points: scores + sticks on the table never change.
      if (tableTotal(gm) !== start) note(`scores + sticks = ${tableTotal(gm)}`);
      if (leftover && !complete) note('leftover sticks paid mid-session');

      STATS.hands++;
      STATS.riichiDeclarations += riichiSeen.size;
      if (riichiSeen.size) STATS.riichiHands++;
      if (outcome.type === 'win') {
        STATS.wins++;
        if (outcome.winners.length > 1) STATS.multiRon++;
        for (const w of outcome.winners) {
          if (w.winType === 'discard') STATS.ron++; else STATS.tsumo++;
          if (w.score.yakuman > 0) STATS.yakuman++;
          else { STATS.winHan += w.score.han; STATS.winsScored++; }
          if (w.score.limit) STATS.limitWins++;
          if (w.score.structure === 'seven-pairs') STATS.sevenPairs++;
          for (const m of winProblems(gm, w, st.transfers, n)) note(m);
        }
        const won = st.transfers.filter((t) => t.reason === 'riichi-sticks').reduce((a, t) => a + t.amount, 0);
        if (won < sticksBefore * 1000) note(`only ${won} of the ${sticksBefore} earlier sticks went to the winner`);
        if (gm.getTurnFlow().riichiSticks !== 0) note(`${gm.getTurnFlow().riichiSticks} sticks left on the table after a win`);
      } else if (outcome.type === 'draw') {
        STATS.draws++;
        if (st.transfers.some((t) => t.reason === 'nagashi' || t.reason === 'nagashi-mangan')) STATS.nagashi++;
        if (st.transfers.some((t) => t.from === null && t.reason !== 'leftover-sticks')) note('a draw paid out of the table');
      } else if (outcome.type === 'abortive') {
        STATS.abortive++;
        if (st.transfers.some((t) => t.reason !== 'leftover-sticks')) note('points moved on an abortive draw');
      } else note(`unknown outcome ${outcome.type}`);

      // Honba and dealer continuation.
      const keeps = gm.getTurnFlow().dealerKeeps(outcome);
      const nonDealerWin = outcome.type === 'win' && !keeps;
      if (gm.getTurnFlow().honba !== (nonDealerWin ? 0 : honbaBefore + 1)) note(`honba ${honbaBefore} → ${gm.getTurnFlow().honba} after ${outcome.type}`);
      log.push(`${outcome.type}:${outcome.type === 'win' ? outcome.winners.map((w) => `${w.seatIndex}${w.winType[0]}${w.score.han}/${w.score.fu}`).join('+') : outcome.reason ?? ''}|${gm.getPlayers().map((p) => p.score).join(',')}`);

      if (complete) {
        if (scoreSum(gm) !== start) note(`final scores sum to ${scoreSum(gm)}`);
        break;
      }
      gm.startNextHand();
      if (keeps !== (gm.getDealerIndex() === dealerBefore)) note('dealer continuation does not match dealerKeeps');
      if (onHandBoundary) gm = onHandBoundary(gm, hands) ?? gm;
    }
  } catch (e) {
    problems.push(`${label}: threw ${e.message}`);
  }
  return { hands, problems, log, gm };
}

const runs = [];

// ---------------------------------------------------------------------------
section('0. Regression — exhaustive draw with four copies in hand', () => {
  // Found by this suite (benchmark seed 9208): at an exhaustive draw
  // DrawResolver probes every face, including a 5th copy of a kind the hand
  // already holds four of — RiichiRules#checkWin threw "more than four copies".
  const rules = new RiichiRules();
  const p = new PlayerManager({ seatIndex: 0, displayName: 'P0', seatKind: 'human', aiDifficulty: null });
  let i = 0;
  const q = new PlayerManager({ seatIndex: 1, displayName: 'P1', seatKind: 'human', aiDifficulty: null });
  for (const id of faceIds('3333c 5c 456d 789b 11d')) p.addTileToHand(Tile.fromId(id, `${id}#r${++i}`));
  for (const id of faceIds('3333c 456d 789b 123b')) q.addTileToHand(Tile.fromId(id, `${id}#r${++i}`));
  let res = null; let err = null;
  try { res = resolveExhaustiveDraw([p, q], rules); } catch (e) { err = e; }
  assert(!err, `no throw on a 5th-copy probe${err ? ' — ' + err.message : ''}`);
  assert(res && res[0].tenpai && res[0].waits.join() === 'characters-4', `3333c 5c 456d 789b 11d waits on 4c only (${res?.[0].waits.join(', ')})`);
  assert(res && !res[1].tenpai, '3333c 456d 789b 123b "waits" only on a 5th 3c → not tenpai');
});

// ---------------------------------------------------------------------------
section('1. Breadth — 12 East-round sessions', () => {
  let seed = 920;
  for (const n of [4, 3]) {
    for (const tier of ['basic', 'advanced', 'mixed']) {
      for (let k = 0; k < 2; k++) {
        const gm = newGame(n, tier, ++seed);
        const label = `${n}P ${tier} seed ${seed}`;
        const r = playSession(gm, { label });
        runs.push({ n, tier, seed, ...r });
        assert(r.problems.length === 0 && r.gm.isGameComplete(), `${label}: ${r.hands} hands, session complete, every invariant held${r.problems.length ? ' — ' + r.problems.slice(0, 3).join(' | ') : ''}`);
        assert(r.hands >= n && r.hands <= r.gm.getMaxHands(), `${label}: hand count ${r.hands} within [${n}, cap]`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
section('2. Half-game (East + South)', () => {
  for (const [n, seed] of [[4, 960], [3, 961]]) {
    const gm = newGame(n, 'basic', seed, { finalRoundWind: WIND.SOUTH });
    let reachedSouth = false;
    const r = playSession(gm, { label: `${n}P hanchan`, onHandBoundary: (g) => { if (g.getRoundWind() === WIND.SOUTH) reachedSouth = true; } });
    const bust = r.gm.getPlayers().some((p) => p.score < 0);
    assert(r.problems.length === 0 && r.gm.isGameComplete(), `${n}P East+South: ${r.hands} hands, complete, invariants held${r.problems.length ? ' — ' + r.problems.slice(0, 3).join(' | ') : ''}`);
    assert(reachedSouth || bust, `${n}P East+South: the South round was played${bust ? ' (or the session ended on a bust)' : ''}`);
  }
});

// ---------------------------------------------------------------------------
section('3. Determinism', () => {
  for (const [n, tier, seed] of [[4, 'mixed', 925], [3, 'advanced', 929]]) {
    const ref = runs.find((x) => x.n === n && x.tier === tier && x.seed === seed);
    const again = playSession(newGame(n, tier, seed), { label: 'replay' });
    assert(ref && again.log.join('\n') === ref.log.join('\n'), `${n}P ${tier} seed ${seed}: the replay is identical hand for hand (${again.hands} hands)`);
  }
});

// ---------------------------------------------------------------------------
section('4. Save / restore at a hand boundary', () => {
  for (const [n, tier, seed] of [[4, 'basic', 921], [3, 'mixed', 931]]) {
    const ref = runs.find((x) => x.n === n && x.tier === tier && x.seed === seed);
    let restored = 0;
    const r = playSession(newGame(n, tier, seed), {
      label: 'restored',
      onHandBoundary: (gm, hands) => {
        if (hands !== 2) return null;
        restored++;
        const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.RIICHI, difficulty: tier })));
        const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: { [RULESET_ID.RIICHI]: () => new RiichiRules({ playerCount: n }) }, STRATEGY_FACTORIES: factoriesFor(gm.__rng), eventBus: new EventBus() });
        back.__rng = gm.__rng;
        return back;
      },
    });
    assert(restored === 1 && r.problems.length === 0 && r.gm.isGameComplete(), `${n}P ${tier}: saved and restored after hand 2, played to the end with every invariant${r.problems.length ? ' — ' + r.problems.slice(0, 3).join(' | ') : ''}`);
    // The wall RNG is deliberately not saved (GameSnapshot: future hands get fresh
    // random walls), so only the hand that was in progress can be compared.
    assert(ref && ref.log.length >= 3 && r.log.slice(0, 3).join('\n') === ref.log.slice(0, 3).join('\n'), `${n}P ${tier}: the hand dealt before the save plays out exactly as in the uninterrupted session`);
  }
});

// ---------------------------------------------------------------------------
section('5. Plausibility', () => {
  const S = STATS; const pc = (x) => `${(100 * x).toFixed(1)}%`;
  const winRate = S.wins / S.hands; const drawRate = S.draws / S.hands; const abortRate = S.abortive / S.hands;
  const avgHan = S.winHan / Math.max(1, S.winsScored);
  const ronShare = S.ron / Math.max(1, S.ron + S.tsumo);
  console.log(`  ${S.hands} hands: won ${pc(winRate)} (Ron ${pc(ronShare)}, multi-Ron ${S.multiRon}), drawn ${pc(drawRate)} (nagashi ${S.nagashi}), abortive ${pc(abortRate)}; riichi in ${pc(S.riichiHands / S.hands)} of hands (${S.riichiDeclarations} declarations); avg ${avgHan.toFixed(2)} han; limit hands ${S.limitWins}, yakuman ${S.yakuman}, Seven Pairs ${S.sevenPairs}; ${(S.turns / S.hands).toFixed(0)} AI turns / hand`);
  assert(S.hands >= 60, `enough hands simulated (${S.hands})`);
  assert(winRate >= 0.4 && winRate <= 0.95, `win rate ${pc(winRate)} is plausible (40–95%)`);
  assert(drawRate + abortRate >= 0.03, `some hands end drawn (${pc(drawRate + abortRate)})`);
  assert(abortRate <= 0.15, `abortive draws are rare (${pc(abortRate)})`);
  assert(ronShare > 0.2 && ronShare < 0.9, `both Ron and Tsumo happen (Ron ${pc(ronShare)})`);
  assert(S.riichiHands / S.hands >= 0.2, `riichi is declared regularly (${pc(S.riichiHands / S.hands)} of hands)`);
  assert(avgHan >= 1.5 && avgHan <= 6, `average han ${avgHan.toFixed(2)} is plausible`);
});

// ---------------------------------------------------------------------------
section('6. Advanced vs Basic — points', () => {
  const rep = runBenchmark({ lineup: ['advanced', 'basic', 'advanced', 'basic'], seeds: 20, seedBase: 9200, minimumFan: 1, ruleEngineFactory: () => new RiichiRules() });
  const sum = summarize(rep); const cmp = compareAgents(rep, 'advanced', 'basic');
  const ci = (m) => `${m.mean.toFixed(1)} [${(m.mean - 1.96 * m.se).toFixed(1)}, ${(m.mean + 1.96 * m.se).toFixed(1)}]`;
  console.log(`  ${rep.outcomes.hands} hands: advanced ${sum.advanced.pointsPerHand.toFixed(0)} pts/hand, win ${(100 * sum.advanced.winRate).toFixed(1)}%, deal-in ${(100 * sum.advanced.dealInRate).toFixed(1)}% · basic ${sum.basic.pointsPerHand.toFixed(0)} pts/hand, win ${(100 * sum.basic.winRate).toFixed(1)}%, deal-in ${(100 * sum.basic.dealInRate).toFixed(1)}%`);
  console.log(`  advanced − basic per seat-hand: points ${ci(cmp.points)}, wins ${ci({ mean: 100 * cmp.wins.mean, se: 100 * cmp.wins.se })} pp, deal-ins ${ci({ mean: 100 * cmp.dealIns.mean, se: 100 * cmp.dealIns.se })} pp`);
  const inv = rep.invariants;
  assert(inv.errors + inv.conservationFailures + inv.zeroSumFailures + inv.underMinimumWins === 0, `benchmark invariants held (errors, tiles, zero-sum, minimum) ${JSON.stringify({ ...inv, errorSamples: undefined })}`);
  assert(cmp.points.mean - 1.96 * cmp.points.se > 0, `Advanced out-scores Basic in Riichi (95% CI above 0: ${ci(cmp.points)})`);
  assert(cmp.wins.mean > 0, 'Advanced wins more seat-hands than Basic');
});

summary();

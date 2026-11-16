/**
 * regressionMatrix.test.mjs — Task 118: the full regression QA pass.
 *
 * Every ruleset × every player count × every AI line-up, played as COMPLETE
 * games (start to isGameComplete) through the same GameManager calls the UI
 * makes, with the whole app-side bookkeeping alongside (saves at each hand
 * start, statistics, leaderboard).
 *
 *   rulesets:  Hong Kong, Riichi, Chinese Official
 *   players:   4, 3
 *   line-ups:  all Basic · all Advanced · mixed (Basic / Advanced alternating)
 *              · "human" — seat 0 played by following the hints (HintAdvisor),
 *                the other seats Advanced: the human's draw / Kong / riichi /
 *                tsumo / discard paths AND its calls on others' discards
 *                (Task 118: setHumanClaimPrompts, as GameScreen turns on),
 *                not just playAITurn
 *
 * Sections:
 *   1. The matrix — 24 configurations × 2 seeds = 48 complete games. Per game:
 *      no errors; the game ends within the hand cap; tiles conserved after
 *      every turn; points (scores + Riichi deposits) conserved after every
 *      hand; every win meets the ruleset's minimum; the event bus reports
 *      each hand once (hand-started, round-over, round-settled); the start-of-
 *      hand save restores to the identical table every hand; statistics and
 *      leaderboard record the game exactly as the app does
 *   2. Determinism — every all-AI configuration replayed with the same seed
 *      gives the same hands, scores and final standings
 *   3. Coverage — across the matrix every ruleset produced wins and draws,
 *      self-drawn and discard wins, claims (and riichi in Riichi)
 *
 * Run: node tests/core/regressionMatrix.test.mjs   (slow: ~2–3 min; skipped by run-all --fast)
 */
import { section, assert, summary } from '../_helpers/harness.mjs';
import { tilesConserved } from '../_helpers/aiBenchmark.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { HintAdvisor } from '../../src/ai/HintAdvisor.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { StorageManager, MemoryStorage } from '../../src/persistence/StorageManager.js';
import { StatisticsManager, STAT_KEYS } from '../../src/persistence/StatisticsManager.js';
import { LeaderboardManager } from '../../src/persistence/LeaderboardManager.js';
import { deriveHandWon, deriveGameResult } from '../../src/ui/components/GameScreen.js';
import { RULESET_ID, TURN_PHASE, ACTION_TYPE } from '../../src/utils/constants.js';

const ENGINES = {
  [RULESET_ID.HONG_KONG]: (n) => new HongKongRules({ playerCount: n }),
  [RULESET_ID.RIICHI]: (n) => new RiichiRules({ playerCount: n }),
  [RULESET_ID.CHINESE_OFFICIAL]: (n) => new ChineseOfficialRules({ playerCount: n }),
};
const LINEUPS = ['basic', 'advanced', 'mixed', 'human'];
const SEEDS = [11, 23];
const makeRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const factoriesFor = (rng) => ({ basic: () => new BasicStrategy({ random: rng }), advanced: () => new AdvancedStrategy({ random: rng }) });
const tablePoints = (gm) => gm.getPlayers().reduce((a, p) => a + p.score, 0) + (gm.getTurnFlow()?.riichiSticks ?? 0) * 1000;
const view = (gm) => JSON.stringify({
  table: gm.getTableView(), wall: gm.getWall().remainingCount, flow: gm.getTurnFlow()?.toJSON() ?? null,
  hands: gm.getPlayers().map((p) => p.getHand().concealedTiles.map((t) => t.instanceId).join()),
  scores: gm.getPlayers().map((p) => p.score),
}, (k, v) => (v && typeof v === 'object' && 'instanceId' in v && 'id' in v ? v.instanceId : v));

function setup(id, n, lineup, seed) {
  const human = lineup === 'human';
  const cfg = buildPlayerConfigs({ playerCount: n, difficulty: lineup === 'basic' ? 'basic' : 'advanced', humanSeatIndex: human ? 0 : -1 });
  if (lineup === 'mixed') cfg.forEach((c, i) => { c.aiDifficulty = i % 2 ? 'advanced' : 'basic'; });
  const rng = makeRng(seed * 7919 + n);
  const bus = new EventBus();
  const gm = new GameManager({ ruleEngine: ENGINES[id](n), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: factoriesFor(rng) }), eventBus: bus, seed });
  return { gm, bus, rng, human };
}

/** Seat 0's turn, played by following the hints (as a player pressing Hint every time would). */
function playHumanTurn(gm, advisor, stats) {
  const tm = gm.getTurnManager();
  if (tm.getPhase() === TURN_PHASE.AWAITING_DRAW) {
    const d = gm.performDraw();
    if (d.type === 'exhausted' || gm.isRoundOver()) return;
    let acts = d.actions;
    for (let k = 0; k < 4; k++) {
      if (!acts.some((a) => [ACTION_TYPE.WIN, ACTION_TYPE.KONG, ACTION_TYPE.RIICHI, ACTION_TYPE.ABORTIVE_DRAW].includes(a.type))) break;
      const a = advisor.actionHint(gm.getPlayer(0), acts, gm.getDecisionContext(0));
      stats.choices++;
      if (a.action.type === ACTION_TYPE.WIN) { gm.declareTsumo(); return; }
      if (a.action.type === ACTION_TYPE.ABORTIVE_DRAW) { gm.declareAbortiveDraw(); return; }
      if (a.action.type === ACTION_TYPE.RIICHI) { gm.declareRiichi(a.tile); return; }
      if (a.action.type === ACTION_TYPE.KONG) {
        const kg = gm.declareKong(a.action);
        if (kg.robbed || !kg.draw || kg.draw.type === 'exhausted' || gm.isRoundOver()) return;
        acts = kg.draw.actions; continue;
      }
      break;
    }
  }
  if (gm.isRoundOver() || tm.getCurrentPlayerIndex() !== 0 || tm.getPhase() !== TURN_PHASE.AWAITING_DISCARD) return;
  const h = advisor.discardHint(gm.getPlayer(0), gm.getDecisionContext(0));
  stats.hints++;
  gm.performDiscard(h.tile);
}

/** One complete game with all the app-side bookkeeping; returns its record. */
function playGame(id, n, lineup, seed) {
  const { gm, bus, rng, human } = setup(id, n, lineup, seed);
  const RF = { [id]: () => ENGINES[id](n) };
  const counts = { 'game:hand-started': 0, 'game:round-over': 0, 'game:round-settled': 0, 'game:claim': 0, 'game:riichi': 0 };
  for (const e of Object.keys(counts)) bus.on(e, () => { counts[e]++; });
  const storage = new StorageManager({ storage: new MemoryStorage() });
  const stats = new StatisticsManager(storage); const board = new LeaderboardManager(storage);
  const advisor = human ? new HintAdvisor() : null;
  const hs = { hints: 0, choices: 0, offers: 0, calls: 0 };
  if (human) gm.setHumanClaimPrompts(true);
  const problems = []; const log = []; const outcomes = [];
  const start = tablePoints(gm);
  let hands = 0; let humanWins = 0;
  try {
    for (;;) {
      hands++;
      stats.recordHandPlayed();
      // The app saves at every hand start: that save must restore to the same table.
      const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: id, difficulty: lineup === 'basic' ? 'basic' : 'advanced' })));
      const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: RF, STRATEGY_FACTORIES: factoriesFor(rng), eventBus: new EventBus() });
      if (view(back) !== view(gm)) problems.push(`hand ${hands}: the start-of-hand save restores differently`);
      for (let turn = 0; !gm.isRoundOver(); turn++) {
        if (turn > 2000) { problems.push(`hand ${hands}: no end after 2000 turns`); break; }
        if (human && gm.getTurnManager().getCurrentPlayerIndex() === 0) playHumanTurn(gm, advisor, hs);
        else {
          const r = gm.playAITurn();
          if (r.type === 'awaiting-claim') {
            const pend = gm.getPendingClaim();
            if (!pend || pend.seatIndex !== 0 || !pend.options.length) problems.push(`hand ${hands}: a bad call offer`);
            const h = advisor.claimHint(gm.getPlayer(0), pend.options, gm.getDecisionContext(0));
            hs.offers++; if (h.reason === 'claim') hs.calls++;
            gm.resolveHumanClaim(h.action);
          } else if (r.type === 'not-applicable') { problems.push(`hand ${hands}: playAITurn not applicable (${r.reason})`); break; }
        }
        if (!gm.isRoundOver() && !tilesConserved(gm)) { problems.push(`hand ${hands}: tiles not conserved`); break; }
      }
      const o = gm.getLastOutcome();
      outcomes.push(o);
      if (o.type === 'win' && !o.winners.every((w) => w.meetsMinimum)) problems.push(`hand ${hands}: a win below the minimum`);
      const won = deriveHandWon(o, 0);
      if (won) { stats.recordHandWin(won); humanWins++; }
      gm.settleRound();
      if (tablePoints(gm) !== start) problems.push(`hand ${hands}: points ${tablePoints(gm)} ≠ ${start}`);
      log.push(`${o.type}:${(o.winners ?? []).map((w) => w.seatIndex).join('+')}|${gm.getPlayers().map((p) => p.score).join(',')}`);
      if (gm.isGameComplete()) break;
      if (hands >= gm.getMaxHands()) { problems.push('passed the hand cap without completing'); break; }
      gm.startNextHand();
    }
  } catch (e) { problems.push(`threw: ${e.stack?.split('\n').slice(0, 2).join(' ')}`); }
  // Event bus: once per hand (the first hand-started is emitted by the constructor, before we subscribed).
  if (counts['game:round-over'] !== hands || counts['game:round-settled'] !== hands || counts['game:hand-started'] !== hands - 1) {
    problems.push(`events: ${JSON.stringify(counts)} for ${hands} hands`);
  }
  // End of game, as the app records it.
  const result = deriveGameResult(gm.getPlayers(), 0);
  stats.recordGameResult(result);
  const rec = board.recordGameResult({ score: gm.getPlayer(0).score, rulesetId: id, difficulty: lineup === 'basic' ? 'basic' : 'advanced', playerCount: n, handsPlayed: hands, won: result.won, drawn: result.drawn });
  const st = stats.getAll();
  if (st[STAT_KEYS.HANDS_PLAYED] !== hands || st[STAT_KEYS.HANDS_WON] !== humanWins || st[STAT_KEYS.GAMES_PLAYED] !== 1) problems.push(`statistics: ${JSON.stringify(st)}`);
  if (!rec?.entry || board.getEntries({ rulesetId: id }).length !== 1 || board.getRecords(id).highestScore?.value !== gm.getPlayer(0).score) problems.push('leaderboard did not record the game');
  return { gm, hands, log, outcomes, problems, counts, hs, complete: gm.isGameComplete() };
}

const results = {};
// ---------------------------------------------------------------------------
section('1. The matrix', () => {
  for (const id of Object.keys(ENGINES)) {
    for (const n of [4, 3]) {
      for (const lineup of LINEUPS) {
        const runs = SEEDS.map((seed) => playGame(id, n, lineup, seed));
        results[`${id}/${n}/${lineup}`] = runs;
        const problems = runs.flatMap((r) => r.problems);
        const hands = runs.map((r) => r.hands).join(' + ');
        const sum = (k) => runs.reduce((a, r) => a + r.hs[k], 0);
        const extra = lineup === 'human' ? `, ${sum('hints')} hinted discards, ${sum('choices')} hinted choices, ${sum('offers')} call offers / ${sum('calls')} taken` : '';
        assert(problems.length === 0 && runs.every((r) => r.complete), `${id} ${n}P ${lineup}: 2 complete games (${hands} hands${extra}) — tiles, points, wins, events, saves, stats, leaderboard all consistent${problems.length ? ' — ' + problems.slice(0, 3).join(' | ') : ''}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
section('2. Determinism', () => {
  for (const id of Object.keys(ENGINES)) {
    for (const n of [4, 3]) {
      for (const lineup of ['basic', 'mixed']) {
        const again = playGame(id, n, lineup, SEEDS[0]);
        const first = results[`${id}/${n}/${lineup}`][0];
        assert(again.log.join('\n') === first.log.join('\n'), `${id} ${n}P ${lineup}: the same seed replays the same ${first.hands} hands and standings`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
section('3. Coverage', () => {
  for (const id of Object.keys(ENGINES)) {
    const runs = Object.entries(results).filter(([k]) => k.startsWith(`${id}/`)).flatMap(([, v]) => v);
    const outs = runs.flatMap((r) => r.outcomes);
    const wins = outs.filter((o) => o.type === 'win');
    const types = new Set(wins.flatMap((o) => o.winners.map((w) => w.winType ?? o.winType)));
    const claims = runs.reduce((a, r) => a + r.counts['game:claim'], 0);
    const riichi = runs.reduce((a, r) => a + r.counts['game:riichi'], 0);
    const humanWins = runs.filter((r, i) => r.outcomes.some((o) => o.type === 'win' && o.winners.some((w) => w.seatIndex === 0))).length;
    assert(wins.length > 0 && outs.some((o) => o.type !== 'win'), `${id}: ${outs.length} hands — ${wins.length} wins and ${outs.length - wins.length} draws`);
    assert(types.size >= 2, `${id}: both self-drawn and discard wins (${[...types].join(', ')})`);
    assert(claims > 0, `${id}: ${claims} claims`);
    if (id === RULESET_ID.RIICHI) assert(riichi > 0, `Riichi: ${riichi} riichi declarations`);
    assert(humanWins > 0, `${id}: seat 0 won hands in ${humanWins} of ${runs.length} games`);
    const human = Object.entries(results).filter(([k]) => k.startsWith(`${id}/`) && k.endsWith('/human')).flatMap(([, v]) => v);
    assert(human.reduce((a, r) => a + r.hs.calls, 0) > 0, `${id}: the human seat was offered calls and took some (${human.reduce((a, r) => a + r.hs.offers, 0)} offers, ${human.reduce((a, r) => a + r.hs.calls, 0)} taken)`);
  }
});

summary();

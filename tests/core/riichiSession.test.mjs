/**
 * riichiSession.test.mjs — Task 91: Riichi GameManager wiring (3- and 4-player).
 *
 * Sections:
 *   1. Settlement through the flow — Ron with honba + sticks, dealer Tsumo,
 *      exhaustive-draw tenpai payments, abortive draw; honba / sticks / dealer
 *      continuation across startNextHand
 *   2. Full sessions, all-AI — 4P East round and 3P East round (Basic and
 *      Advanced): every hand's points + table sticks add up to the starting
 *      total, honba follows the rules, the session ends, leftover sticks go to
 *      the top player so the final scores alone add up
 *   3. Bust ends the session (option), and is ignored with bustEndsGame:false
 *   4. Save / restore mid-hand — flow state (riichi, sticks, honba, dora,
 *      furiten, drawn tile) survives JSON and the hand plays on
 *   5. Hong Kong untouched — same settlement and next-hand behaviour
 *
 * Run: node tests/core/riichiSession.test.mjs   (≈1–2 min)
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { faceIds } from '../_helpers/tiles.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { WallManager } from '../../src/core/WallManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { ACTION_TYPE, SEAT_KIND, TURN_PHASE, WIND, RULESET_ID } from '../../src/utils/constants.js';

let uid = 0;
const mk = (id) => Tile.fromId(id, `${id}#s${++uid}`);
const many = (spec) => faceIds(spec).map(mk);
const humans = (n) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, displayName: `P${i}`, seatKind: SEAT_KIND.HUMAN, aiDifficulty: null }));
const IDLE = ['19d 19b 19c ESWN RG 5d', '28d 28b 28c ESWN RG 6d', '37d 37b 37c ESWN RG 4b'];

function rig(gm, hands, draws, dealer = gm.getDealerIndex()) {
  gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const t of many(hands[i])) p.addTileToHand(t); });
  const wall = new WallManager([...many(draws), ...many('8c 8c 8c 8c'), ...many('1b 1b 1b 1b 9c 1c 1c 1c 1c 9c 9c 9c 9c 9c')]);
  wall.reserveDeadWall(14);
  gm._wall = wall;
  gm.getTurnFlow().onHandStart();
  gm.getTurnManager().forceSetTurn(dealer, TURN_PHASE.AWAITING_DRAW);
}
const find = (gm, seat, id) => gm.getPlayer(seat).getHand().concealedTiles.filter((t) => t.id === id).pop();
const total = (gm) => gm.getPlayers().reduce((a, p) => a + p.score, 0) + gm.getTurnFlow().riichiSticks * 1000;
const scores = (gm) => gm.getPlayers().map((p) => p.score).join(',');

// ---------------------------------------------------------------------------
section('1. Settlement through the flow', () => {
  const gm = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 3 });
  const flow = gm.getTurnFlow();
  flow.honba = 2;
  rig(gm, ['23d 456b 789b 123c EE', '78d 234b 456b 678c 55c', IDLE[0], IDLE[1]], '9d 1b');
  gm.performDraw();
  gm.declareRiichi(find(gm, 0, 'dots-9')); // seat 1 Rons the declaration tile → riichi void
  const s = gm.settleRound();
  // Seat 1: Pinfu 1 han 30 fu → 1000 + 2 honba × 300.
  assert(scores(gm) === '23400,26600,25000,25000' && s.transfers.some((t) => t.reason === 'honba'), `Ron + 2 honba from the discarder (${scores(gm)})`);
  assert(flow.honba === 0 && !gm.isGameComplete(), 'non-dealer win: honba reset, session goes on');
  assert(gm.settleRound() === s, 'settleRound is idempotent');
  gm.startNextHand();
  assert(gm.getDealerIndex() === 1 && gm.getPlayer(1).seatWind === WIND.EAST, 'the deal passes to seat 1');

  // Riichi stands, then the dealer (seat 1) wins by Tsumo with 1 stick on the table.
  rig(gm, [IDLE[0], '23d 456b 789b 123c EE', IDLE[1], IDLE[2]], '9d 2b 3b 4b 1d', 1);
  gm.performDraw(); gm.declareRiichi(find(gm, 1, 'dots-9'));
  for (const s2 of [2, 3, 0]) { gm.performDraw(); gm.performDiscard(gm.getPlayer(s2).getHand().concealedTiles.slice(-1)[0]); }
  gm.performDraw();
  const before = gm.getPlayers().map((p) => p.score);
  const w = gm.declareTsumo();
  gm.settleRound();
  const each = w.score.payments.nonDealer;
  assert(gm.getPlayer(1).score - before[1] === 3 * each + 1000 && flow.riichiSticks === 0, `dealer Tsumo: ${each} from each + the stick (${scores(gm)})`);
  assert(flow.honba === 1, 'dealer win: honba +1');
  gm.startNextHand();
  assert(gm.getDealerIndex() === 1, 'dealer win: the dealer keeps the deal (renchan)');

  // Exhaustive draw: only seat 2 tenpai → +3000 from the others; dealer (seat 1) noten → deal passes.
  rig(gm, [IDLE[0], IDLE[1], '23d 456b 789b 123c EE', IDLE[2]], '', 1);
  const b2 = gm.getPlayers().map((p) => p.score);
  for (const s3 of [1, 2, 3, 0]) { gm.performDraw(); gm.performDiscard(gm.getPlayer(s3).getHand().concealedTiles.slice(-1)[0]); }
  const r = gm.performDraw();
  assert(r.type === 'exhausted' && r.results.filter((x) => x.tenpai).map((x) => x.seatIndex).join() === '2', 'wall exhausted with only seat 2 tenpai');
  gm.settleRound();
  const d = gm.getPlayers().map((p, i) => p.score - b2[i]).join(',');
  assert(d === '-1000,-1000,3000,-1000' && flow.honba === 2, `noten payments ${d}; honba +1`);
  gm.startNextHand();
  assert(gm.getDealerIndex() === 2, 'dealer noten at the draw → the deal passes');
});

// ---------------------------------------------------------------------------
section('2. Full sessions, all-AI', () => {
  for (const [n, tier, seed] of [[4, 'basic', 11], [4, 'advanced', 12], [3, 'basic', 13], [3, 'advanced', 14]]) {
    const cfg = buildPlayerConfigs({ playerCount: n, difficulty: tier, humanSeatIndex: -1 });
    const gm = new GameManager({ ruleEngine: new RiichiRules({ playerCount: n }), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg), eventBus: new EventBus(), seed });
    const start = n === 4 ? 100000 : 105000;
    let hands = 0; let conserved = true; let honbaOk = true; let errors = 0;
    try {
      for (let guard = 0; guard < 40; guard++) {
        const honbaBefore = gm.getTurnFlow().honba;
        const dealerBefore = gm.getDealerIndex();
        gm.playRoundWithAI({ maxTurns: 800 });
        hands++;
        const outcome = gm.getLastOutcome();
        gm.settleRound();
        const complete = gm.isGameComplete();
        if (!complete && total(gm) !== start) conserved = false;
        const keeps = gm.getTurnFlow().dealerKeeps(outcome);
        const nonDealerWin = outcome.type === 'win' && !keeps;
        if (gm.getTurnFlow().honba !== (nonDealerWin ? 0 : honbaBefore + 1)) honbaOk = false;
        if (complete) break;
        gm.startNextHand();
        if (keeps !== (gm.getDealerIndex() === dealerBefore)) honbaOk = false;
      }
    } catch (e) { errors++; console.error(e); }
    const final = gm.getPlayers().reduce((a, p) => a + p.score, 0);
    assert(errors === 0 && gm.isGameComplete(), `${n}P ${tier}: a full East-round session completes (${hands} hands)`);
    assert(conserved, `${n}P ${tier}: after every hand, scores + table sticks = ${start}`);
    assert(final === start && gm.getTurnFlow().riichiSticks === 0, `${n}P ${tier}: leftover sticks went to the top player — final scores sum to ${start} (${scores(gm)})`);
    assert(honbaOk, `${n}P ${tier}: honba +1 after draws / dealer wins, reset after non-dealer wins; dealer continuation matches`);
  }
});

// ---------------------------------------------------------------------------
section('2b. Leftover sticks at the end', () => {
  // One-hand session, nobody tenpai at the draw, two sticks on the table, all tied → the starting dealer (seat 0) gets them.
  const gm = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 6, maxHands: 1 });
  gm.getTurnFlow().riichiSticks = 2;
  gm.getPlayer(1).addScore(-2000); // as if seat 1 and seat 2 had declared earlier — keeps scores + sticks at 100000
  rig(gm, IDLE.concat([IDLE[0]]), '');
  for (const s3 of [0, 1, 2, 3]) { gm.performDraw(); gm.performDiscard(gm.getPlayer(s3).getHand().concealedTiles.slice(-1)[0]); }
  gm.performDraw();
  const st = gm.settleRound();
  assert(gm.isGameComplete() && st.transfers.some((t) => t.reason === 'leftover-sticks' && t.to === 0 && t.amount === 2000), 'end of session: the 2 sticks go to the top player (tie → closest to the starting dealer)');
  assert(gm.getTurnFlow().riichiSticks === 0 && gm.getPlayers().reduce((a, p) => a + p.score, 0) === 100000, 'final scores alone add up to 100000');
  const g2 = new GameManager({ ruleEngine: new RiichiRules({ leftoverSticksToTop: false }), playerConfigs: humans(4), eventBus: new EventBus(), seed: 6, maxHands: 1 });
  g2.getTurnFlow().riichiSticks = 2;
  rig(g2, IDLE.concat([IDLE[0]]), '');
  for (const s3 of [0, 1, 2, 3]) { g2.performDraw(); g2.performDiscard(g2.getPlayer(s3).getHand().concealedTiles.slice(-1)[0]); }
  g2.performDraw();
  assert(!g2.settleRound().transfers.some((t) => t.reason === 'leftover-sticks') && g2.getTurnFlow().riichiSticks === 2, 'leftoverSticksToTop:false → they stay on the table');
});

// ---------------------------------------------------------------------------
section('3. Bust', () => {
  const gm = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 4 });
  rig(gm, ['23d 456b 789b 123c EE', '78d 234b 456b 678c 55c', IDLE[0], IDLE[1]], '9d 1b');
  gm.getPlayer(0).addScore(-24500); // 500 left
  gm.performDraw(); gm.performDiscard(find(gm, 0, 'dots-9'));
  assert(gm.isGameComplete() && gm.getPlayer(0).score < 0, 'a player below 0 ends the session');
  const g2 = new GameManager({ ruleEngine: new RiichiRules({ bustEndsGame: false }), playerConfigs: humans(4), eventBus: new EventBus(), seed: 4 });
  rig(g2, ['23d 456b 789b 123c EE', '78d 234b 456b 678c 55c', IDLE[0], IDLE[1]], '9d 1b');
  g2.getPlayer(0).addScore(-24500);
  g2.performDraw(); g2.performDiscard(find(g2, 0, 'dots-9'));
  assert(!g2.isGameComplete(), 'bustEndsGame:false → play on');
});

// ---------------------------------------------------------------------------
section('4. Save / restore', () => {
  const gm = new GameManager({ ruleEngine: new RiichiRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 5 });
  gm.getTurnFlow().honba = 3;
  rig(gm, ['23d 456b 789b 123c EE', ...IDLE], '9d 2b 3b 4b 7c 5d');
  gm.performDraw(); gm.declareRiichi(find(gm, 0, 'dots-9'));
  for (const s of [1, 2, 3]) { gm.performDraw(); gm.performDiscard(gm.getPlayer(s).getHand().concealedTiles.slice(-1)[0]); }
  gm.performDraw(); // seat 0 (in riichi) has drawn 7c — mid-turn
  gm.getTurnFlow().getDoraState().revealKanDora(); // a kan-dora indicator showing
  const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.RIICHI, difficulty: 'basic' })));
  assert(snap.flowState && snap.flowState.honba === 3 && snap.flowState.riichiSticks === 1 && snap.lastDrawnTile, 'the snapshot carries the flow state and the drawn tile');
  const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: { [RULESET_ID.RIICHI]: () => new RiichiRules() }, eventBus: new EventBus() });
  const f = back.getTurnFlow();
  assert(f.honba === 3 && f.riichiSticks === 1 && f.isRiichi(0) && f.getDoraIndicators().length === 2, 'restored: honba, sticks, riichi, revealed dora indicators');
  const da = back.getSelfActions().find((a) => a.type === ACTION_TYPE.DISCARD);
  assert(da.allowedTiles.length === 1 && da.allowedTiles[0].id === 'characters-7', 'restored mid-turn: the riichi lock still knows the drawn tile');
  back.performDiscard(da.allowedTiles[0]);
  assert(back.getTurnManager().getCurrentPlayerIndex() === 1, 'the restored hand plays on');
  assertThrows(() => f.restoreState({ honba: -1, riichiSticks: 0 }), TypeError, 'restoreState validates');
});

// ---------------------------------------------------------------------------
section('5. Hong Kong untouched', () => {
  const cfg = buildPlayerConfigs({ playerCount: 4, difficulty: 'basic', humanSeatIndex: -1 });
  const gm = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg), eventBus: new EventBus(), seed: 21 });
  gm.playRoundWithAI();
  const s = gm.settleRound();
  assert(gm.getTurnFlow() === null && gm.getPlayers().reduce((a, p) => a + p.score, 0) === 0 && s.transfers.every((t) => t.from !== null && t.to !== null), 'HK: no flow, zero-sum transfers between players');
});

summary();

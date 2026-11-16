/**
 * chineseOfficialSession.test.mjs — Task 99: Chinese Official GameManager
 * wiring — whole sessions for 3 and 4 players, settlement, dealer and round
 * progression, saves (Task 91's counterpart for MCR).
 *
 * Sections:
 *   1. Full games — a 16-hand 4-player game (East → North, each seat deals
 *      once per wind), a 12-hand 3-player game; zero-sum after every hand;
 *      every transfer matches MCR's base-8 settlement of the hand's winner
 *   2. East-round sessions — 4P / 3P × Basic / Advanced
 *   3. Settlement through real wins — Ron and Tsumo amounts with flowers
 *   4. Saves mid-turn — after a flower replacement and after a Kong
 *      replacement: the restored game offers the same win, worth the same
 *      (flowers, Out with Replacement Tile)
 *   5. Saves between hands — dealer, prevailing wind, hand index, scores
 *
 * Run: node tests/core/chineseOfficialSession.test.mjs
 */
import { section, assert, summary } from '../_helpers/harness.mjs';
import { faceIds } from '../_helpers/tiles.mjs';
import { tilesConserved } from '../_helpers/aiBenchmark.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { WallManager } from '../../src/core/WallManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { ACTION_TYPE, SEAT_KIND, TURN_PHASE, KONG_TYPE, RULESET_ID, WIND } from '../../src/utils/constants.js';

let uid = 0;
const mk = (id) => Tile.fromId(id, `${id}#s${++uid}`);
const tl = (spec) => spec.split(' ').filter(Boolean).flatMap((part) => (/^[FS][1-4]$/.test(part) ? [mk(`${part[0] === 'F' ? 'flower' : 'season'}-${part[1]}`)] : faceIds(part).map(mk)));
const humans = (n) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, displayName: `P${i}`, seatKind: SEAT_KIND.HUMAN, aiDifficulty: null }));
const IDLE = ['19d 19b 19c ESWN RG 5d', '28d 28b 28c ESWN RG 6d', '37d 37b 37c ESWN RG 4b', '46d 46b 46c ESWN RG 5b'];
const rngFor = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const factories = (rng) => ({ basic: () => new BasicStrategy({ random: rng }), advanced: () => new AdvancedStrategy({ random: rng }) });
const sum = (gm) => gm.getPlayers().reduce((a, p) => a + p.score, 0);

function aiGame(n, tier, seed, extra = {}) {
  const cfg = buildPlayerConfigs({ playerCount: n, difficulty: tier, humanSeatIndex: -1 });
  return new GameManager({ ruleEngine: new ChineseOfficialRules({ playerCount: n }), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: factories(rngFor(seed)) }), eventBus: new EventBus(), seed, ...extra });
}

/** Expected transfers for an outcome (MCR base 8). */
function expected(outcome, n) {
  if (outcome.type !== 'win') return [];
  const w = outcome.winners[0];
  const out = [];
  for (let s = 0; s < n; s++) {
    if (s === w.seatIndex) continue;
    out.push({ from: s, amount: w.winType === 'self' || s === w.calledFrom ? 8 + w.points : 8 });
  }
  return out;
}

/** Plays a session; returns { hands, dealers, winds, problems }. */
function play(gm) {
  const n = gm.getPlayerCount();
  const problems = []; const dealers = []; const winds = [];
  let hands = 0;
  for (let guard = 0; guard < 40; guard++) {
    dealers.push(gm.getDealerIndex()); winds.push(gm.getRoundWind().id);
    while (!gm.isRoundOver()) {
      gm.playAITurn();
      if (!gm.isRoundOver() && !tilesConserved(gm)) problems.push(`hand ${hands + 1}: tiles`);
    }
    hands++;
    const o = gm.getLastOutcome();
    if (o.type === 'win' && o.winners.length !== 1) problems.push(`hand ${hands}: ${o.winners.length} winners`);
    const st = gm.settleRound();
    const want = expected(o, n).map((t) => `${t.from}:${t.amount}`).sort().join();
    const got = st.transfers.map((t) => `${t.from}:${t.amount}`).sort().join();
    if (want !== got) problems.push(`hand ${hands}: transfers ${got} ≠ ${want}`);
    if (sum(gm) !== 0) problems.push(`hand ${hands}: sum ${sum(gm)}`);
    if (gm.isGameComplete()) break;
    gm.startNextHand();
  }
  return { hands, dealers, winds, problems };
}

// ---------------------------------------------------------------------------
section('1. Full games', () => {
  const g4 = aiGame(4, 'basic', 991, { finalRoundWind: WIND.NORTH });
  const r4 = play(g4);
  assert(r4.problems.length === 0, `4P full game: no problems${r4.problems.length ? ' — ' + r4.problems.slice(0, 3).join(' | ') : ''}`);
  assert(r4.hands === 16 && g4.isGameComplete(), `16 hands (${r4.hands})`);
  assert(r4.dealers.join('') === '0123012301230123', `the deal passes every hand (${r4.dealers.join('')})`);
  assert(r4.winds.join(',') === [...Array(4).fill('east'), ...Array(4).fill('south'), ...Array(4).fill('west'), ...Array(4).fill('north')].join(','), 'four hands per prevailing wind, East → North');
  const g3 = aiGame(3, 'basic', 992, { finalRoundWind: WIND.NORTH });
  const r3 = play(g3);
  assert(r3.problems.length === 0 && r3.hands === 12 && r3.dealers.join('') === '012012012012', `3P full game: 12 hands, each seat deals once per wind${r3.problems.length ? ' — ' + r3.problems.slice(0, 3).join(' | ') : ''}`);
});

// ---------------------------------------------------------------------------
section('2. East-round sessions', () => {
  for (const [n, tier, seed] of [[4, 'basic', 993], [4, 'advanced', 994], [3, 'basic', 995], [3, 'advanced', 996]]) {
    const gm = aiGame(n, tier, seed);
    const r = play(gm);
    assert(r.problems.length === 0 && r.hands === n && gm.isGameComplete() && gm.getTurnFlow().getSetAsideTiles().every((t) => t.isBonus), `${n}P ${tier}: ${r.hands} hands, every settlement exact, zero-sum${r.problems.length ? ' — ' + r.problems.slice(0, 3).join(' | ') : ''}`);
  }
  const capped = aiGame(4, 'basic', 997, { finalRoundWind: WIND.NORTH, maxHands: 5 });
  assert(play(capped).hands === 5, 'maxHands caps the session');
});

// ---------------------------------------------------------------------------
section('3. Settlement through real wins', () => {
  const rig = (hands, front, back, dealer = 0) => {
    const gm = new GameManager({ ruleEngine: new ChineseOfficialRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 1, dealerIndex: dealer });
    gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const t of tl(hands[i])) p.addTileToHand(t); });
    gm._wall = new WallManager([...tl(front), ...tl('9b 9b 9b 9b 8b 8b 8b 8b'), ...tl(back)]);
    gm.getTurnFlow().onHandStart();
    gm.getTurnManager().forceSetTurn(dealer, TURN_PHASE.AWAITING_DRAW);
    return gm;
  };
  // Seat 0 discards East; seat 2 (123d 456b 789c 111d E, a flower set aside) Rons: 14 + 1 flower = 15.
  const gm = rig(['E 19d 19b 19c SWN RG 5d', IDLE[1], '123d 456b 789c 111d E', IDLE[3]], '', '');
  gm.getTurnFlow().onBonusTile(2, mk('season-2'));
  gm.getTurnManager().forceSetTurn(0, TURN_PHASE.AWAITING_DISCARD);
  const r = gm.performDiscard(gm.getPlayer(0).getHand().concealedTiles.find((t) => t.id === 'wind-east'));
  const w = r.winners[0];
  const st = gm.settleRound();
  assert(w.seatIndex === 2 && w.points === w.score.validation.points + 1, `Ron worth ${w.score.validation.points} + 1 flower = ${w.points}`);
  assert(st.transfers.find((t) => t.from === 0).amount === 8 + w.points && st.transfers.filter((t) => t.from !== 0).every((t) => t.amount === 8), 'the discarder pays 8 + points, the others 8');
  assert(gm.getPlayer(2).score === 24 + w.points && sum(gm) === 0, `winner +${24 + w.points}, zero-sum`);
});

// ---------------------------------------------------------------------------
section('4. Saves mid-turn', () => {
  const RF = { [RULESET_ID.CHINESE_OFFICIAL]: () => new ChineseOfficialRules() };
  const roundTrip = (gm) => hydrateGameManager(JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.CHINESE_OFFICIAL, difficulty: 'basic' }))), { RULE_ENGINE_FACTORIES: RF, eventBus: new EventBus() });
  const winOf = (gm) => gm.getSelfActions().find((a) => a.type === ACTION_TYPE.WIN);
  const rig = (hands, front, back) => {
    const gm = new GameManager({ ruleEngine: new ChineseOfficialRules(), playerConfigs: humans(4), eventBus: new EventBus(), seed: 1 });
    gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const t of tl(hands[i])) p.addTileToHand(t); });
    gm._wall = new WallManager([...tl(front), ...tl('9b 9b 9b 9b 8b 8b 8b 8b'), ...tl(back)]);
    gm.getTurnFlow().onHandStart();
    gm.getTurnManager().forceSetTurn(0, TURN_PHASE.AWAITING_DRAW);
    return gm;
  };

  // After a flower replacement: Tsumo on East worth 16 + 2 flowers.
  const a = rig(['123d 456b 789c 111d E', IDLE[1], IDLE[2], IDLE[3]], 'F1', 'E F2');
  a.performDraw();
  const before = winOf(a);
  const back = roundTrip(a);
  const after = winOf(back);
  assert(before && after && after.score.points === before.score.points && after.validation.flowerPoints === 2, `the restored game offers the same Tsumo (${after?.score.points} with 2 flowers)`);
  assert(back.getTurnFlow().getFlowerCount(0) === 2 && back.getWall().remainingCount === a.getWall().remainingCount && back.getLastDrawnTile()?.id === 'wind-east', 'flowers, wall and the drawn tile restored');
  assert(back.declareTsumo().points === before.score.points, 'and declaring it scores the same');

  // After a Kong replacement: Out with Replacement Tile survives the save (the Task 99 fix).
  const k = rig(['111d 234d 789c 99b EE', IDLE[1], IDLE[2], IDLE[3]], '1d', 'E');
  k.performDraw();
  k.declareKong(k.getSelfActions().find((x) => x.type === ACTION_TYPE.KONG && x.kongType === KONG_TYPE.CONCEALED));
  const kw = winOf(k);
  assert(k.wasLastDrawReplacement() && kw && kw.validation.fans.some((f) => f.id === 'out-with-replacement'), 'a win on the Kong replacement scores Out with Replacement Tile');
  const kb = roundTrip(k);
  assert(kb.wasLastDrawReplacement() === true && winOf(kb)?.validation.fans.some((f) => f.id === 'out-with-replacement') && winOf(kb).score.points === kw.score.points, 'still true after a save + restore');
  const snap = buildSnapshot(k, { rulesetId: RULESET_ID.CHINESE_OFFICIAL, difficulty: 'basic' });
  delete snap.lastDrawWasReplacement;
  assert(hydrateGameManager(JSON.parse(JSON.stringify(snap)), { RULE_ENGINE_FACTORIES: RF, eventBus: new EventBus() }).wasLastDrawReplacement() === false, 'an older save without the field restores as an ordinary draw');
});

// ---------------------------------------------------------------------------
section('5. Saves between hands', () => {
  const gm = aiGame(4, 'basic', 998, { finalRoundWind: WIND.SOUTH });
  for (let h = 0; h < 5; h++) { while (!gm.isRoundOver()) gm.playAITurn(); gm.settleRound(); gm.startNextHand(); }
  const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.CHINESE_OFFICIAL, difficulty: 'basic' })));
  const cfg = buildPlayerConfigs({ playerCount: 4, difficulty: 'basic', humanSeatIndex: -1 });
  const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: { [RULESET_ID.CHINESE_OFFICIAL]: () => new ChineseOfficialRules() }, aiManager: createAIManagerForSeats(cfg), eventBus: new EventBus() });
  assert(back.getDealerIndex() === 1 && back.getRoundWind() === WIND.SOUTH && back.getHandIndex() === 5, 'hand 6: dealer seat 1, South round');
  assert(back.getPlayers().map((p) => p.score).join() === gm.getPlayers().map((p) => p.score).join() && sum(back) === 0, 'scores restored, zero-sum');
  assert(JSON.stringify(back.getTurnFlow().toJSON()) === JSON.stringify(gm.getTurnFlow().toJSON()), 'flowers of the new deal restored');
  const r = play(back);
  assert(r.problems.length === 0 && back.isGameComplete() && r.hands === 3, `the restored session plays out its last 3 hands${r.problems.length ? ' — ' + r.problems.slice(0, 3).join(' | ') : ''}`);
});

summary();

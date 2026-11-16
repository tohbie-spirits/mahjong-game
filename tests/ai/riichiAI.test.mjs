/**
 * riichiAI.test.mjs — Task 90: AI adaptation layer for Riichi (Basic + Advanced).
 *
 * Sections:
 *   1. Helpers — isRiichiContext, valuableHonorFaces, liveCount,
 *      chooseRiichiDeclaration (most live waits, drawn tile preferred, minLive)
 *   2. Basic — trusts the engine's win validation; respects allowedDiscards;
 *      Riichi claims only Yakuhai, never Chi, self Kans fine; HK unchanged;
 *      chooseRiichi / chooseAbortiveDraw
 *   3. Advanced — forced single discard; allowed-kind fallback; riichi seats
 *      read as declared tenpai; 1-han value minimum in Riichi; closed tenpai
 *      counts as winnable; chooseRiichi / chooseAbortiveDraw (11+ kinds keeps)
 *   4. AIManager pass-through + defaults for strategies without the methods
 *   5. Real Riichi hands — Basic and Advanced, 4P and 3P, all-AI: no errors,
 *      riichi declared, every win legal with a yaku; Advanced beats Basic on
 *      wins in a small seeded head-to-head (points need Task 91's settlement)
 *
 * Run: node tests/ai/riichiAI.test.mjs   (≈1 min)
 */
import { section, assert, summary } from '../_helpers/harness.mjs';
import { tiles, hand, makeTileFactory } from '../_helpers/tiles.mjs';
import { isRiichiContext, valuableHonorFaces, liveCount, chooseRiichiDeclaration, distinctTerminalHonorKinds } from '../../src/ai/RiichiAIHelpers.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy, readTable, tileToKindIndex } from '../../src/ai/advanced/AdvancedStrategy.js';
import { countsFromTiles } from '../../src/ai/advanced/HandEfficiencyEvaluator.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { AIStrategyInterface } from '../../src/ai/AIStrategyInterface.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { ACTION_TYPE, MELD_TYPE, WIND, WIN_SOURCE } from '../../src/utils/constants.js';
import { runBenchmark, compareAgents } from '../_helpers/aiBenchmark.mjs';

const R = new RiichiRules();
const player = (spec, melds = [], seatIndex = 1) => { const h = hand(spec, melds, makeTileFactory()); return { seatIndex, seatWind: WIND.SOUTH, score: 25000, getHand: () => h }; };
const ctx = (extra = {}) => ({ ruleEngine: R, seatWind: WIND.SOUTH, roundWind: WIND.EAST, table: { discards: [[], [], [], []], melds: [[], [], [], []] }, ...extra });
const disc = (id) => Tile.fromId(id, `${id}#x${Math.random()}`);
const selfState = (p) => ({ kind: 'self', seatIndex: p.seatIndex, playerCount: 4, drawnTile: p.getHand().concealedTiles.slice(-1)[0], wallRemaining: 40, score: 25000 });

// ---------------------------------------------------------------------------
section('1. Helpers', () => {
  assert(isRiichiContext({ ruleEngine: R }) && !isRiichiContext({ ruleEngine: new HongKongRules() }) && !isRiichiContext({}), 'isRiichiContext');
  const v = valuableHonorFaces({ seatWind: WIND.SOUTH }, { roundWind: WIND.EAST });
  assert([...v].sort().join() === 'dragon-green,dragon-red,dragon-white,wind-east,wind-south', 'dragons + seat + round wind');
  const p = player('23d 456b 789b 123c EE 9d');
  const seen = ctx({ table: { discards: [[disc('dots-1'), disc('dots-1')], [], [], []], melds: [[], [], [], []] } });
  assert(liveCount(['dots-1', 'dots-4'], p, seen) === 2 + 4, 'live = 4 − held − visible (1d: two discarded → 2; 4d: 4)');
  const riichi = R.getLegalActions(selfState(p), p).find((a) => a.type === ACTION_TYPE.RIICHI);
  assert(chooseRiichiDeclaration(p, riichi, ctx()).id === 'dots-9', 'the only riichi discard (9d)');
  const multi = player('234d 456b 789b 123c E R');
  const m = R.getLegalActions(selfState(multi), multi).find((a) => a.type === ACTION_TYPE.RIICHI);
  const seenE = ctx({ table: { discards: [[disc('wind-east'), disc('wind-east')], [], [], []], melds: [[], [], [], []] } });
  assert(chooseRiichiDeclaration(multi, m, seenE).id === 'wind-east', 'two Easts are gone → keep the Red wait (discard East)');
  const allSeen = ctx({ table: { discards: [[disc('dots-1'), disc('dots-1'), disc('dots-1'), disc('dots-4'), disc('dots-4'), disc('dots-4'), disc('dots-4')], [], [], []], melds: [[], [], [], []] } });
  assert(chooseRiichiDeclaration(p, riichi, allSeen, { minLive: 2 }) === null, 'fewer live tiles than minLive → no declaration');
  assert(distinctTerminalHonorKinds(tiles('19d 19b 1c ESWN 2d 3d 5b 6b 7b')) === 9, 'distinctTerminalHonorKinds');
});

// ---------------------------------------------------------------------------
section('2. Basic', () => {
  const b = new BasicStrategy({ random: () => 0 });
  const p = player('23d 456b 789b 123c EE');
  assert(b.chooseWinDeclaration(p, { type: ACTION_TYPE.WIN, winType: WIN_SOURCE.DISCARD, tile: disc('dots-1'), validation: { valid: true } }, ctx()) === true, 'a validated win is accepted (no re-score that would miss riichi)');
  assert(b.chooseWinDeclaration(p, { type: ACTION_TYPE.WIN, winType: WIN_SOURCE.DISCARD, tile: disc('dots-1'), validation: { valid: false } }, ctx()) === false, 'an invalid one is refused');
  const q = player('23d 456b 789b 123c EE 9d');
  const allowed = [q.getHand().concealedTiles.find((t) => t.id === 'wind-east')];
  assert(b.chooseDiscard(q, ctx({ allowedDiscards: allowed })) === allowed[0], 'only allowed discards are considered');
  const claimP = player('RR 55d 34d 789b 123c W');
  const actions = (faceId, from = 0) => R.getLegalActions({ kind: 'discard', seatIndex: 1, playerCount: 4, wallRemaining: 40, discard: { tile: disc(faceId), fromSeat: from } }, claimP);
  assert(b.chooseClaim(claimP, actions('dragon-red'), ctx()).type === ACTION_TYPE.PON, 'Riichi: Pons a dragon (Yakuhai)');
  assert(b.chooseClaim(claimP, actions('dots-5'), ctx()).type === ACTION_TYPE.PASS, 'Riichi: never Pons a plain tile (would leave the hand without a yaku)');
  assert(b.chooseClaim(claimP, actions('dots-2'), ctx()).type === ACTION_TYPE.PASS, 'Riichi: never Chis');
  const hkCtx = { ruleEngine: new HongKongRules(), seatWind: WIND.SOUTH, roundWind: WIND.EAST };
  assert(b.chooseClaim(claimP, actions('dots-5'), hkCtx).type === ACTION_TYPE.PON, 'Hong Kong unchanged: Pon always');
  const kanP = player('1111d 23b 456c 789c E 9b');
  const selfKan = R.getLegalActions(selfState(kanP), kanP).filter((a) => a.type === ACTION_TYPE.KONG);
  assert(b.chooseClaim(kanP, selfKan, ctx()).type === ACTION_TYPE.KONG, 'Riichi: self-declared Kans are fine');
  const riichi = R.getLegalActions(selfState(q), q).find((a) => a.type === ACTION_TYPE.RIICHI);
  assert(b.chooseRiichi(q, riichi, ctx()).id === 'dots-9' && b.chooseAbortiveDraw() === true, 'chooseRiichi / chooseAbortiveDraw');
});

// ---------------------------------------------------------------------------
section('3. Advanced', () => {
  const a = new AdvancedStrategy({ random: () => 0 });
  const p = player('23d 456b 789b 123c EE 9d');
  const drawn = p.getHand().concealedTiles.slice(-1)[0];
  assert(a.chooseDiscard(p, ctx({ allowedDiscards: [drawn] })) === drawn && a.lastDiscardMode === 'forced', 'riichi lock: the single allowed tile, no evaluation');
  const free = a.chooseDiscard(p, ctx());
  const notThat = p.getHand().concealedTiles.filter((t) => t.id !== free.id);
  const restricted = a.chooseDiscard(p, ctx({ allowedDiscards: notThat }));
  assert(notThat.includes(restricted), 'when its favourite is forbidden it takes the best allowed kind');
  const table = { discards: [[], [], [], []], melds: [[], [], [], []], riichiSeats: [2] };
  const view = readTable(p, { ...ctx({ table }), dealerIndex: 0 });
  assert(view.opponents[1].declaredTenpai === true && !view.opponents[0].declaredTenpai, 'a seat in riichi is read as declared tenpai (threat 1)');
  assert(a._valueOptions(p, ctx()).minimumFan === 1 && a._valueOptions(p, { ruleEngine: new HongKongRules({ minimumFan: 3 }) }).minimumFan === 3, 'value planner minimum: 1 han in Riichi, the HK setting otherwise');
  // A closed tenpai with no yaku of its own: still winnable (riichi) → value 0.
  const w = player('23d 456b 789b 123c EE');
  const counts = countsFromTiles(w.getHand().concealedTiles, tileToKindIndex);
  const v = a._valueOfWaitingHand(counts, [], w.getHand(), w, ctx({ seatWind: WIND.EAST }), new Array(34).fill(0));
  assert(v.vs === 0 && v.ukeire > 0, 'a closed Riichi tenpai counts as winnable (riichi supplies the yaku)');
  const riichi = R.getLegalActions(selfState(p), p).find((x) => x.type === ACTION_TYPE.RIICHI);
  assert(a.chooseRiichi(p, riichi, ctx()).id === 'dots-9', 'chooseRiichi');
  assert(a.chooseAbortiveDraw(player('19d 19b 1c ESWN 2d 3d 5b 6b 7b')) === true, '9 kinds → redeal');
  assert(a.chooseAbortiveDraw(player('19d 19b 19c ESWN RG 5b')) === false, '12 kinds → keep and try Thirteen Orphans');
  assert(a.chooseWinDeclaration(p, { type: ACTION_TYPE.WIN, winType: WIN_SOURCE.SELF, tile: drawn, validation: { valid: true } }, ctx()) === true, 'trusts validated wins too');
});

// ---------------------------------------------------------------------------
section('4. AIManager', () => {
  class Minimal extends AIStrategyInterface {
    constructor() { super('basic'); }
    chooseDiscard(p) { return p.getHand().concealedTiles[0]; }
    chooseClaim() { return { type: ACTION_TYPE.PASS }; }
    chooseWinDeclaration() { return true; }
  }
  const ai = new AIManager({ strategies: [new Minimal()] });
  const p = { ...player('23d 456b 789b 123c EE 9d'), aiDifficulty: 'basic' };
  assert(ai.chooseRiichi(p, {}, {}) === null && ai.chooseAbortiveDraw(p, {}, {}) === false, 'strategies without the Riichi methods never declare');
  const ai2 = new AIManager({ strategies: [new BasicStrategy()] });
  const riichi = R.getLegalActions(selfState(p), p).find((x) => x.type === ACTION_TYPE.RIICHI);
  assert(ai2.chooseRiichi(p, riichi, ctx()).id === 'dots-9' && ai2.chooseAbortiveDraw(p, {}, {}) === true, 'pass-through to strategies that have them');
});

// ---------------------------------------------------------------------------
section('5. Real Riichi hands', () => {
  for (const [tier, n, seeds] of [['basic', 4, 30], ['advanced', 4, 12], ['basic', 3, 20], ['advanced', 3, 8]]) {
    let errors = 0; let invalid = 0; let wins = 0; let riichi = 0; let hands = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const cfg = buildPlayerConfigs({ playerCount: n, difficulty: tier, humanSeatIndex: -1 });
      try {
        const gm = new GameManager({ ruleEngine: new RiichiRules({ playerCount: n }), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg), eventBus: new EventBus(), seed: 9000 + seed, maxHands: 1 });
        for (let i = 0; i < 600 && !gm.isRoundOver(); i++) { const r = gm.playAITurn(); if (r.riichi) riichi++; }
        hands++;
        const o = gm.getLastOutcome();
        if (o.type === 'win') for (const w of o.winners) { wins++; if (!w.meetsMinimum || !w.score.breakdown.some((y) => !y.isDora)) invalid++; }
      } catch (e) { errors++; if (errors < 2) console.error(e); }
    }
    assert(errors === 0 && hands === seeds && invalid === 0, `${tier} ${n}P: ${hands} hands, ${wins} wins (all legal with a yaku), ${riichi} riichi declarations, no errors`);
    assert(riichi > 0 && wins > 0, `${tier} ${n}P: the AI declares riichi and wins`);
  }
  const r = runBenchmark({ lineup: ['advanced', 'basic', 'advanced', 'basic'], seeds: 25, seedBase: 50000, ruleEngineFactory: (pc) => new RiichiRules({ playerCount: pc }) });
  const c = compareAgents(r, 'advanced', 'basic');
  console.log(`    Riichi A/B/A/B, 50 hands: wins ${(100 * c.wins.mean).toFixed(1)} pp [${(100 * c.wins.lo).toFixed(1)}, ${(100 * c.wins.hi).toFixed(1)}] · deal-ins ${(100 * c.dealIns.mean).toFixed(1)} pp`);
  assert(r.invariants.errors === 0 && r.invariants.conservationFailures === 0, 'head-to-head: no errors, tiles conserved');
  assert(c.wins.lo > 0, 'Advanced wins more Riichi hands than Basic (CI above 0)');
});

summary();

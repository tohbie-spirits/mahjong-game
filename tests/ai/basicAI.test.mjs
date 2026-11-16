/**
 * basicAI.test.mjs — rebuilt Tasks 35–42: AIStrategyInterface, AIManager,
 * PacingController, BasicStrategy, GameManager AI integration, and an
 * AI-vs-AI behaviour harness (Task 42).
 * Run: node tests/ai/basicAI.test.mjs
 */
import { section, sectionAsync, assert, assertThrows, summary, mulberry32 } from '../_helpers/harness.mjs';
import { tiles, makeTileFactory } from '../_helpers/tiles.mjs';
import { AIStrategyInterface, isValidAIStrategy } from '../../src/ai/AIStrategyInterface.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { PacingController, PACING_MOMENT, DEFAULT_WATCHABLE_PACING_PROFILE } from '../../src/ai/PacingController.js';
import { BasicStrategy, connectedness } from '../../src/ai/basic/BasicStrategy.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { Tile } from '../../src/core/Tile.js';
import { ACTION_TYPE, AI_DIFFICULTY, SEAT_KIND, WIND } from '../../src/utils/constants.js';

function aiPlayer(spec, seatIndex = 1) {
  const p = new PlayerManager({ seatIndex, seatKind: SEAT_KIND.AI, aiDifficulty: AI_DIFFICULTY.BASIC });
  for (const t of tiles(spec, makeTileFactory())) p.addTileToHand(t);
  p.seatWind = WIND.SOUTH;
  return p;
}
const configs = (n) => Array.from({ length: n }, (_, i) => ({ seatIndex: i, displayName: `AI ${i}`, seatKind: SEAT_KIND.AI, aiDifficulty: AI_DIFFICULTY.BASIC }));

section('Interface + manager', () => {
  assertThrows(() => new AIStrategyInterface('basic'), TypeError, 'abstract interface');
  const basic = new BasicStrategy();
  assert(isValidAIStrategy(basic) && basic.getStrategyId() === 'basic' && basic.getDisplayName() === 'Basic', 'BasicStrategy is a valid strategy');
  assert(!isValidAIStrategy({}), 'plain object rejected');
  const ai = new AIManager({ strategies: [basic] });
  assert(ai.hasStrategy('basic') && ai.getStrategyIds().join() === 'basic', 'registry');
  const p = aiPlayer('123d E');
  assert(ai.getStrategyForPlayer(p) === basic, 'routes by aiDifficulty');
  const adv = new PlayerManager({ seatIndex: 2, seatKind: SEAT_KIND.AI, aiDifficulty: AI_DIFFICULTY.ADVANCED });
  assertThrows(() => ai.getStrategyForPlayer(adv), Error, 'unregistered difficulty throws');
  assertThrows(() => ai.registerStrategy({}), TypeError, 'invalid strategy rejected');
});

await sectionAsync('Pacing', async () => {
  const pc = new PacingController();
  assert(pc.delayFor(PACING_MOMENT.BEFORE_DISCARD) === 0, 'instant by default');
  const waits = [];
  const fast = new PacingController({ profile: DEFAULT_WATCHABLE_PACING_PROFILE, speed: 2, sleep: async (ms) => { waits.push(ms); } });
  assert(fast.delayFor(PACING_MOMENT.BEFORE_DISCARD) === DEFAULT_WATCHABLE_PACING_PROFILE.beforeDiscard / 2, 'speed multiplier');
  const ai = new AIManager({ strategies: [new BasicStrategy()], pacingController: fast });
  const tile = await ai.chooseDiscardPaced(aiPlayer('123d E'), {});
  assert(tile && waits.length === 1 && waits[0] > 0, 'paced call waits then decides');
  assertThrows(() => pc.setSpeed(0), TypeError, 'speed must be positive');
  assertThrows(() => ai.setPacingController({}), TypeError, 'setPacingController validates');
});

section('BasicStrategy discard', () => {
  const s = new BasicStrategy({ random: mulberry32(1) });
  const p = aiPlayer('123d 456b 99c 1c N');
  assert(s.chooseDiscard(p).id === 'wind-north', 'isolated honour discarded first');
  const ts = p.getHand().concealedTiles;
  const n = ts.find((t) => t.id === 'wind-north');
  assert(connectedness(n, ts) === 0, 'lone honour has 0 connections');
  const d2 = ts.find((t) => t.id === 'dots-2');
  assert(connectedness(d2, ts) === 2, 'suited tile connects within 2 ranks');
  assertThrows(() => s.chooseDiscard(aiPlayer('')), Error, 'empty hand throws');
});

section('BasicStrategy claims', () => {
  const s = new BasicStrategy({ random: mulberry32(2) });
  const p = aiPlayer('34d 77b 1c 9c E S');
  const t = Tile.fromId('dots-5', 'dots-5#4');
  const hand = p.getHand().concealedTiles;
  const chi = { type: ACTION_TYPE.CHI, seatIndex: 1, tile: t, handTiles: hand.filter((x) => x.id === 'dots-3' || x.id === 'dots-4'), sequence: ['dots-3', 'dots-4', 'dots-5'], fromSeat: 0 };
  const pon = { type: ACTION_TYPE.PON, seatIndex: 1, tile: Tile.fromId('bamboo-7', 'bamboo-7#4'), handTiles: hand.filter((x) => x.id === 'bamboo-7'), fromSeat: 0 };
  const kong = { type: ACTION_TYPE.KONG, seatIndex: 1, kongType: 'concealed', faceId: 'x', tiles: [] };
  assert(s.chooseClaim(p, [chi, pon, kong]) === kong, 'Kong always accepted');
  assert(s.chooseClaim(p, [chi, pon]) === pon, 'Pon always accepted');
  assert(s.chooseClaim(p, [chi]) === chi, 'Chi accepted when it rescues tiles whose only connection is the partner');
  const q = aiPlayer('34d 56d 77b 1c 9c E');
  const qh = q.getHand().concealedTiles;
  const chi2 = { ...chi, handTiles: qh.filter((x) => x.id === 'dots-3' || x.id === 'dots-4') };
  assert(s.chooseClaim(q, [chi2]).type === ACTION_TYPE.PASS, 'Chi passed when both hand tiles are otherwise connected');
  assert(s.chooseClaim(q, []).type === ACTION_TYPE.PASS, 'no actions → pass');
});

section('BasicStrategy win declaration', () => {
  const s = new BasicStrategy();
  const rules = new HongKongRules();
  const p = aiPlayer('123d 456d 789b 234c E');
  const win = { type: ACTION_TYPE.WIN, winType: 'discard', tile: Tile.fromId('wind-east', 'wind-east#4'), fromSeat: 0 };
  assert(s.chooseWinDeclaration(p, win, { ruleEngine: rules, roundWind: WIND.EAST, wallRemaining: 20 }) === false, 'rejects a 2-fan Ron under a 3-fan minimum (complete hand scored)');
  assert(s.chooseWinDeclaration(p, win, { ruleEngine: new HongKongRules({ minimumFan: 1 }), roundWind: WIND.EAST, wallRemaining: 20 }) === true, 'accepts when it meets the minimum');
  assert(s.chooseWinDeclaration(p, win, {}) === true, 'no rule engine → accept');
});

function runHarness({ games, n, minimumFan, seedBase }) {
  let hands = 0; let wins = 0; let draws = 0; let errors = 0; let unterminated = 0; let underMin = 0; let conservationOk = true;
  const rules = new HongKongRules({ minimumFan });
  for (let g = 0; g < games; g++) {
    const ai = new AIManager({ strategies: [new BasicStrategy({ random: mulberry32(seedBase + g) })] });
    const gm = new GameManager({ ruleEngine: rules, playerConfigs: configs(n), aiManager: ai, eventBus: new EventBus(), seed: seedBase + g });
    try {
      const out = gm.playRoundWithAI({ maxTurns: 600 });
      hands++;
      const ids = new Set();
      for (const p of gm.getPlayers()) { for (const t of p.getHand().allTiles) ids.add(t.instanceId); for (const t of p.getDiscardPile().tiles) ids.add(t.instanceId); }
      const snap = gm.getWall().getWallStateSnapshot();
      for (const t of snap.tiles.slice(snap.drawIndex, snap.liveWallEnd)) ids.add(t.instanceId);
      if (out.type === 'win') ids.forEach(() => {}); // winners' hands are views; real tiles already counted
      if (ids.size !== 136) conservationOk = false;
      if (out.type === 'win') { wins++; if (out.winners.some((w) => !w.meetsMinimum)) underMin++; } else draws++;
    } catch (e) {
      if (/turn limit/.test(e.message)) unterminated++; else { errors++; if (errors < 3) console.error(e); }
    }
  }
  return { hands, wins, draws, errors, unterminated, underMin, conservationOk };
}

section('AI-vs-AI harness (Task 42)', () => {
  const r4 = runHarness({ games: 150, n: 4, minimumFan: 3, seedBase: 4200 });
  const r3 = runHarness({ games: 60, n: 3, minimumFan: 3, seedBase: 4300 });
  console.log(`    4p: ${r4.hands} hands, ${r4.wins} wins (${(r4.wins / r4.hands * 100).toFixed(1)}%), ${r4.draws} draws`);
  console.log(`    3p: ${r3.hands} hands, ${r3.wins} wins (${(r3.wins / r3.hands * 100).toFixed(1)}%), ${r3.draws} draws`);
  for (const [label, r] of [['4-player', r4], ['3-player', r3]]) {
    assert(r.errors === 0, `${label}: zero exceptions`);
    assert(r.unterminated === 0, `${label}: every hand terminates`);
    assert(r.conservationOk, `${label}: tile conservation`);
    assert(r.wins > 0, `${label}: nonzero win rate`);
    assert(r.underMin === 0, `${label}: every recorded win meets the minimum fan`);
  }
});

summary();

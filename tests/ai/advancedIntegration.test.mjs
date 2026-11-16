/**
 * advancedIntegration.test.mjs — Task 78: Advanced AI integration for the
 * Hong Kong ruleset on the rebuilt engine.
 *
 * Sections:
 *   1. tileToKindIndex / faceIdToKindIndex — all 34 faces map uniquely and in
 *      the evaluator's layout; bonus tiles → null
 *   2. readTable — visible counts dedupe claimed discards, exclude the claimed
 *      tile on request, clamp to 4 − held; opponents; valuable honours
 *   3. Strategy contract — valid AI strategy registered as 'advanced'
 *   4. chooseDiscard — a real tile from the hand; equals pure efficiency when
 *      nobody threatens; defence engages against a threatening table
 *   5. chooseClaim — real ACTION_TYPE actions mapped to claims and back
 *      (accept progress, pass on a harmful Pon, self-Kong decisions)
 *   6. chooseWinDeclaration — respects the minimum fan
 *   7. Full games: 4 Advanced seats (no errors, no fallbacks, wins meet the
 *      minimum, tile conservation) and mixed tables, 2 Advanced vs 2 Basic,
 *      on identical seeded walls with seats swapped. Advanced must beat Basic
 *      on wins and points at both the 1-fan and the real 3-fan minimum
 *      (Task 78b made it fan-aware; before that, 3 fan was a known gap).
 *
 * Sections 4–5 pin the pure-speed behaviour with { useValue: false } (the
 * Task 78 fan-blind path, still available); the value layer itself is
 * covered by tests/ai/handValuePlanner.test.mjs.
 *
 * Run: node tests/ai/advancedIntegration.test.mjs
 */
import { section, assert, assertThrows, summary, mulberry32 } from '../_helpers/harness.mjs';
import { tiles, makeTileFactory } from '../_helpers/tiles.mjs';
import { AdvancedStrategy, tileToKindIndex, faceIdToKindIndex, readTable, chooseEfficientDiscard } from '../../src/ai/advanced/AdvancedStrategy.js';
import { countsFromTiles } from '../../src/ai/advanced/HandEfficiencyEvaluator.js';
import { isValidAIStrategy } from '../../src/ai/AIStrategyInterface.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { Meld } from '../../src/core/Hand.js';
import { Tile } from '../../src/core/Tile.js';
import { generateTileSet, STANDARD_FACE_IDS } from '../../src/core/TileSetGenerator.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { ACTION_TYPE, AI_DIFFICULTY, SEAT_KIND, WIND, MELD_TYPE, KONG_TYPE } from '../../src/utils/constants.js';

function aiPlayer(spec, seatIndex = 1, difficulty = AI_DIFFICULTY.ADVANCED, f = makeTileFactory()) {
  const p = new PlayerManager({ seatIndex, seatKind: SEAT_KIND.AI, aiDifficulty: difficulty });
  for (const t of tiles(spec, f)) p.addTileToHand(t);
  p.seatWind = WIND.SOUTH;
  return p;
}
const emptyTable = (n = 4) => ({ discards: Array.from({ length: n }, () => []), melds: Array.from({ length: n }, () => []) });
const ctx = (extra = {}) => ({ ruleEngine: new HongKongRules(), seatIndex: 1, playerCount: 4, seatWind: WIND.SOUTH, roundWind: WIND.EAST, wallRemaining: 50, table: emptyTable(), ...extra });

section('Tile → kind index adapter', () => {
  const idx = STANDARD_FACE_IDS.map((id) => tileToKindIndex(Tile.fromId(id)));
  assert(idx.every((v, i) => v === i), 'the 34 faces map to 0–33 in STANDARD_FACE_IDS order (dots, bamboo, characters, winds ESWN, dragons RGW)');
  assert(tileToKindIndex(Tile.fromId('dots-1')) === 0 && tileToKindIndex(Tile.fromId('bamboo-1')) === 9 && tileToKindIndex(Tile.fromId('characters-9')) === 26, 'suit offsets 0 / 9 / 18');
  assert(tileToKindIndex(Tile.fromId('wind-east')) === 27 && tileToKindIndex(Tile.fromId('dragon-white')) === 33, 'honours 27–33');
  assert(generateTileSet({ includeBonus: true }).filter((t) => tileToKindIndex(t) === null).length === 8, 'flowers/seasons → null');
  assert(STANDARD_FACE_IDS.every((id) => faceIdToKindIndex(id) === tileToKindIndex(Tile.fromId(id))), 'faceIdToKindIndex agrees');
  assertThrows(() => tileToKindIndex(null), TypeError, 'non-tile throws');
});

section('readTable', () => {
  const f = makeTileFactory();
  const me = aiPlayer('123d 456b 789c EE S', 1, AI_DIFFICULTY.ADVANCED, f);
  const claimed = f('dots-5');
  const seat0 = { discards: [claimed, f('wind-north')] };
  const pon = new Meld({ type: MELD_TYPE.PON, tiles: [f('dots-5'), f('dots-5'), claimed], calledFrom: 0, calledTile: claimed });
  const table = { discards: [seat0.discards, [], [], []], melds: [[], [], [pon], []] };
  const v = readTable(me, ctx({ table }));
  assert(v.visibleCounts[4] === 3, 'claimed 5-dot counted once (pile + meld), plus the two meld copies → 3');
  assert(v.visibleCounts[30] === 1, 'North discard visible');
  assert(v.handCounts.reduce((a, b) => a + b) === 12, 'handCounts from the concealed hand');
  const ex = readTable(me, ctx({ table }), { excludeTile: f('wind-north') });
  assert(ex.visibleCounts[30] === 1, 'excludeTile only removes that physical tile');
  assert(v.opponents.length === 3 && v.opponents[0].discards.join() === '4,30' && v.opponents[1].melds.length === 1, 'opponents: discards + exposed melds');
  assert(v.valuableHonorIndices.join() === '27,28,31,32,33', 'dragons + seat (South) + prevailing (East) winds');
  const crowded = aiPlayer('EEE 1d', 1);
  const t2 = { discards: [[Tile.fromId('wind-east', 'wind-east#4'), Tile.fromId('wind-east', 'wind-east#9')], [], [], []], melds: [[], [], [], []] };
  assert(readTable(crowded, ctx({ table: t2 })).visibleCounts[27] === 1, 'visible clamped to 4 − held');
});

section('Strategy contract', () => {
  const s = new AdvancedStrategy();
  assert(isValidAIStrategy(s) && s.getStrategyId() === 'advanced' && s.getDisplayName() === 'Advanced', 'valid strategy, id advanced');
  const ai = new AIManager({ strategies: [new BasicStrategy(), s] });
  assert(ai.getStrategyForPlayer(aiPlayer('1d', 2)) === s, 'AIManager routes advanced seats to it');
});

section('chooseDiscard', () => {
  const s = new AdvancedStrategy({ useValue: false });
  const p = aiPlayer('123d 456b 789c 55c 99b N', 1);
  const tile = s.chooseDiscard(p, ctx());
  assert(p.getHand().concealedTiles.includes(tile), 'returns a real tile from the hand');
  assert(tile.id === 'wind-north', 'throws the lone honour');
  assert(s.lastDiscardMode === 'push', 'calm table → push mode');
  const counts = countsFromTiles(p.getHand().concealedTiles, tileToKindIndex);
  const pure = chooseEfficientDiscard(counts, { allowThirteenOrphans: true, visibleCounts: new Array(34).fill(0), valuableHonorIndices: [27, 28, 31, 32, 33] });
  assert(tileToKindIndex(tile) === pure.discardIndex, 'calm table → identical to pure efficiency');

  // Threatening table: an opponent with three exposed melds and many discards.
  const f = makeTileFactory();
  const far = aiPlayer('1d 4d 7d 2b 5b 8b 3c 6c 9c E S W N R', 1);
  const melds = [new Meld({ type: MELD_TYPE.PON, tiles: tiles('GGG', f) }), new Meld({ type: MELD_TYPE.PON, tiles: tiles('999b', f) }), new Meld({ type: MELD_TYPE.CHI, tiles: tiles('234c', f) })];
  const discards = tiles('1b 1c 9d 2d 3d 7c 8c 5d 6d 3b 4b 7b 8c 2c', f);
  const threat = { discards: [[], [], discards, []], melds: [[], [], melds, []] };
  const d = s.chooseDiscard(far, ctx({ table: threat }));
  assert(s.lastDiscardMode === 'fold' || s.lastDiscardMode === 'balance', `defence engages under threat (${s.lastDiscardMode})`);
  assert(far.getHand().concealedTiles.includes(d), 'still a real tile');
  assert(new AdvancedStrategy({ useDefense: false }).chooseDiscard(far, ctx({ table: threat })) && true, 'useDefense:false works');
  assert(s.getFallbackCount() === 0, 'no fallbacks on valid hands');
  const v = new AdvancedStrategy();
  const vt = v.chooseDiscard(p, ctx());
  assert(p.getHand().concealedTiles.includes(vt) && v.getFallbackCount() === 0, 'value-aware (default) discard is a real tile, no fallback');
  assert(Number.isFinite(v.lastValueShanten), 'value-aware discard records lastValueShanten');
});

section('chooseClaim', () => {
  const s = new AdvancedStrategy({ useValue: false });
  const f = makeTileFactory();
  const p = aiPlayer('123d 456d 55b 66b 9c E W', 1, AI_DIFFICULTY.ADVANCED, f);
  const disc = f('bamboo-5');
  const ponAction = { type: ACTION_TYPE.PON, seatIndex: 1, faceId: 'bamboo-5', tile: disc, handTiles: p.getHand().concealedTiles.filter((t) => t.id === 'bamboo-5'), fromSeat: 0 };
  const table = { discards: [[disc], [], [], []], melds: [[], [], [], []] };
  assert(s.chooseClaim(p, [ponAction], ctx({ table, discard: { tile: disc, fromSeat: 0 } })) === ponAction, 'progress Pon accepted (same action object returned)');

  const tenpai = aiPlayer('123d 456d 789b 55b 67b', 1, AI_DIFFICULTY.ADVANCED, f);
  const d2 = f('bamboo-5');
  const harmful = { type: ACTION_TYPE.PON, seatIndex: 1, faceId: 'bamboo-5', tile: d2, handTiles: tenpai.getHand().concealedTiles.filter((t) => t.id === 'bamboo-5'), fromSeat: 0 };
  assert(s.chooseClaim(tenpai, [harmful], ctx({ table: { discards: [[d2], [], [], []], melds: [[], [], [], []] } })).type === ACTION_TYPE.PASS, 'Pon that breaks a tenpai hand → pass');

  const chiHand = aiPlayer('123d 456d 789b 34c 9c E', 3, AI_DIFFICULTY.ADVANCED, f);
  const d3 = f('characters-5');
  const chi = { type: ACTION_TYPE.CHI, seatIndex: 3, tile: d3, handTiles: chiHand.getHand().concealedTiles.filter((t) => t.id === 'characters-3' || t.id === 'characters-4'), sequence: ['characters-3', 'characters-4', 'characters-5'], fromSeat: 2 };
  assert(s.chooseClaim(chiHand, [chi], ctx({ seatIndex: 3, table: { discards: [[], [], [d3], []], melds: [[], [], [], []] } })) === chi, 'progress Chi accepted');

  const kHand = aiPlayer('EEEE 123d 456d 78b 9c 1c', 1);
  const eTiles = kHand.getHand().concealedTiles.filter((t) => t.id === 'wind-east');
  const ck = { type: ACTION_TYPE.KONG, seatIndex: 1, kongType: KONG_TYPE.CONCEALED, faceId: 'wind-east', tiles: eTiles };
  assert(s.chooseClaim(kHand, [ck], ctx()) === ck, 'concealed Kong of a finished set declared');
  const shaped = aiPlayer('5555b 6b 7b 123d 456d 9c E', 1);
  const sk = { type: ACTION_TYPE.KONG, seatIndex: 1, kongType: KONG_TYPE.CONCEALED, faceId: 'bamboo-5', tiles: shaped.getHand().concealedTiles.filter((t) => t.id === 'bamboo-5') };
  const r = s.chooseClaim(shaped, [sk], ctx());
  assert(r === sk || r.type === ACTION_TYPE.PASS, 'shape-breaking concealed Kong evaluated (declared only if no worse)');
  assert(s.chooseClaim(p, [], ctx()).type === ACTION_TYPE.PASS, 'no actions → pass');
  const v = new AdvancedStrategy();
  assert(v.chooseClaim(tenpai, [harmful], ctx({ table: { discards: [[d2], [], [], []], melds: [[], [], [], []] } })).type === ACTION_TYPE.PASS, 'value-aware: Pon that breaks a tenpai hand → pass');
  assert(v.chooseClaim(kHand, [ck], ctx()) === ck, 'value-aware: concealed Kong of a prevailing-wind set declared');
  assert(v.chooseClaim(p, [], ctx()).type === ACTION_TYPE.PASS && v.getFallbackCount() === 0, 'value-aware: no actions → pass, no fallback');
});

section('chooseWinDeclaration', () => {
  const s = new AdvancedStrategy();
  const p = aiPlayer('123d 456d 789b 234c E', 1);
  const win = { type: ACTION_TYPE.WIN, winType: 'discard', tile: Tile.fromId('wind-east', 'wind-east#4'), fromSeat: 0 };
  assert(s.chooseWinDeclaration(p, win, ctx()) === false, 'below the 3-fan minimum → declined');
  assert(s.chooseWinDeclaration(p, win, ctx({ ruleEngine: new HongKongRules({ minimumFan: 1 }) })) === true, 'meets the minimum → declared');
});

function configs(kinds) {
  return kinds.map((k, i) => ({ seatIndex: i, displayName: `${k} ${i}`, seatKind: SEAT_KIND.AI, aiDifficulty: k }));
}

function playHands({ kinds, games, seedBase, strategies, minimumFan = 3 }) {
  const rules = new HongKongRules({ minimumFan });
  const res = { hands: 0, errors: 0, underMin: 0, conservation: true, winsBy: {}, pointsBy: {}, dealInsBy: {} };
  for (const k of new Set(kinds)) { res.winsBy[k] = 0; res.pointsBy[k] = 0; res.dealInsBy[k] = 0; }
  for (let g = 0; g < games; g++) {
    const ai = new AIManager({ strategies: strategies(g) });
    const gm = new GameManager({ ruleEngine: rules, playerConfigs: configs(kinds), aiManager: ai, eventBus: new EventBus(), seed: seedBase + g });
    try {
      const out = gm.playRoundWithAI({ maxTurns: 800 });
      res.hands++;
      const ids = new Set();
      for (const p of gm.getPlayers()) { for (const t of p.getHand().allTiles) ids.add(t.instanceId); for (const t of p.getDiscardPile().tiles) ids.add(t.instanceId); }
      const snap = gm.getWall().getWallStateSnapshot();
      for (const t of snap.tiles.slice(snap.drawIndex, snap.liveWallEnd)) ids.add(t.instanceId);
      if (ids.size !== 136) res.conservation = false;
      gm.settleRound();
      if (out.type === 'win') {
        for (const w of out.winners) {
          res.winsBy[kinds[w.seatIndex]]++;
          if (!w.meetsMinimum) res.underMin++;
          if (w.winType === 'discard') res.dealInsBy[kinds[w.calledFrom]]++;
        }
      }
      gm.getPlayers().forEach((p, i) => { res.pointsBy[kinds[i]] += p.score; });
    } catch (e) {
      res.errors++;
      if (res.errors < 3) console.error(e);
    }
  }
  return res;
}

section('Full games on the rebuilt engine', () => {
  const advs = [];
  const all = playHands({
    kinds: ['advanced', 'advanced', 'advanced', 'advanced'], games: 40, seedBase: 7800,
    strategies: (g) => { const a = new AdvancedStrategy({ random: mulberry32(g) }); advs.push(a); return [a]; },
  });
  console.log(`    4 × Advanced: ${all.hands} hands · ${all.winsBy.advanced} wins`);
  assert(all.errors === 0 && all.hands === 40, 'every all-Advanced hand completes without errors');
  assert(all.underMin === 0, 'every win meets the minimum fan');
  assert(all.conservation, 'tile conservation');
  assert(advs.every((a) => a.getFallbackCount() === 0), 'no decision ever fell back to Basic');

  // Mixed tables, seats swapped so each kind sits in each position equally.
  const G = 60;
  const strategies = (g) => [new BasicStrategy({ random: mulberry32(g) }), new AdvancedStrategy({ random: mulberry32(g + 999) })];
  const mixed = (minimumFan) => {
    const a = playHands({ kinds: ['advanced', 'basic', 'advanced', 'basic'], games: G, seedBase: 7900, strategies, minimumFan });
    const b = playHands({ kinds: ['basic', 'advanced', 'basic', 'advanced'], games: G, seedBase: 7900, strategies, minimumFan });
    const sum = (k, f) => a[f][k] + b[f][k];
    return {
      errors: a.errors + b.errors,
      wins: { advanced: sum('advanced', 'winsBy'), basic: sum('basic', 'winsBy') },
      pts: { advanced: sum('advanced', 'pointsBy'), basic: sum('basic', 'pointsBy') },
      deal: { advanced: sum('advanced', 'dealInsBy'), basic: sum('basic', 'dealInsBy') },
    };
  };
  const one = mixed(1);
  console.log(`    1-fan minimum, ${2 * G} hands: wins A ${one.wins.advanced} / B ${one.wins.basic} · deal-ins A ${one.deal.advanced} / B ${one.deal.basic} · points A ${one.pts.advanced} / B ${one.pts.basic}`);
  assert(one.errors === 0 && one.pts.advanced + one.pts.basic === 0, 'mixed tables run without errors; points zero-sum');
  assert(one.wins.advanced > 2 * one.wins.basic, '1-fan minimum: Advanced seats win more than twice as many hands as Basic');
  assert(one.pts.advanced > 0 && one.deal.advanced < one.deal.basic, '1-fan minimum: Advanced finishes ahead on points and deals in less');

  const three = mixed(3);
  console.log(`    3-fan minimum (real HK setting), ${2 * G} hands: wins A ${three.wins.advanced} / B ${three.wins.basic} · deal-ins A ${three.deal.advanced} / B ${three.deal.basic} · points A ${three.pts.advanced} / B ${three.pts.basic}`);
  assert(three.errors === 0 && three.pts.advanced + three.pts.basic === 0, '3-fan minimum: mixed tables run without errors; points zero-sum');
  assert(three.wins.advanced > three.wins.basic && three.pts.advanced > 0, '3-fan minimum (Task 78b): Advanced wins more hands than Basic and finishes ahead on points');
});

summary();

/**
 * riichiDora.test.mjs — Task 88: dora indicators + dead wall integration.
 *
 * Sections:
 *   1. doraFromIndicator — suits wrap 9 → 1, winds E→S→W→N→E, dragons
 *      White→Green→Red→White, three-player 1-characters → 9-characters
 *   2. Dead wall — a real Riichi GameManager reserves 14 tiles; the layout
 *      is fixed; Kan replacements come from its first four tiles and never
 *      move the indicators; the live wall shrinks one per Kan
 *   3. RiichiDoraState — reveal order, kan dora (max 5, option off), ura
 *      under revealed indicators (kanUraDora off), counts per indicator
 *   4. Red fives — copy #1 of each 5, only with redFives: 3
 *   5. Scoring with dora — doraContext feeds scoreHand; ura only for riichi;
 *      dora alone never makes a win; restore; options validation
 *
 * Run: node tests/rules/riichiDora.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand, makeTileFactory } from '../_helpers/tiles.mjs';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { doraFromIndicator, isRedFive, deadWallLayout, countDora, RiichiDoraState, DEAD_WALL_SIZE } from '../../src/rules/riichi/RiichiDora.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { SEAT_KIND, WIN_SOURCE } from '../../src/utils/constants.js';

const t = (id, copy = 2) => Tile.fromId(id, `${id}#${copy}`);
const fourPlayers = () => Array.from({ length: 4 }, (_, i) => ({ seatIndex: i, displayName: `P${i}`, seatKind: SEAT_KIND.HUMAN, aiDifficulty: null }));
/** A dead wall whose indicators are given; the rest filler. */
function deadWall(doraIds, uraIds = []) {
  const filler = (i) => t('bamboo-1', `f${i}`);
  return [0, 1, 2, 3].map(filler)
    .concat([0, 1, 2, 3, 4].map((i) => (doraIds[i] ? t(doraIds[i], `d${i}`) : filler(10 + i))))
    .concat([0, 1, 2, 3, 4].map((i) => (uraIds[i] ? t(uraIds[i], `u${i}`) : filler(20 + i))));
}

// ---------------------------------------------------------------------------
section('1. doraFromIndicator', () => {
  const pairs = [['dots-1', 'dots-2'], ['dots-9', 'dots-1'], ['bamboo-4', 'bamboo-5'], ['characters-9', 'characters-1'],
    ['wind-east', 'wind-south'], ['wind-north', 'wind-east'], ['dragon-white', 'dragon-green'], ['dragon-green', 'dragon-red'], ['dragon-red', 'dragon-white']];
  assert(pairs.every(([i, d]) => doraFromIndicator(i) === d), 'suits wrap 9 → 1; winds E→S→W→N→E; dragons White→Green→Red→White');
  assert(doraFromIndicator('characters-1', { sanma: true }) === 'characters-9' && doraFromIndicator('characters-9', { sanma: true }) === 'characters-1', 'three-player: 1m → 9m (2–8 removed), 9m → 1m');
  assert(doraFromIndicator('dots-1', { sanma: true }) === 'dots-2', 'three-player keeps the other suits');
  assertThrows(() => doraFromIndicator('flower-1'), TypeError, 'non-standard face throws');
});

// ---------------------------------------------------------------------------
section('2. Dead wall', () => {
  const rules = new RiichiRules();
  const gm = new GameManager({ ruleEngine: rules, playerConfigs: fourPlayers(), eventBus: new EventBus(), seed: 88 });
  const wall = gm.getWall();
  assert(wall.deadWallSize === DEAD_WALL_SIZE && wall.getReservedDeadWallTiles().length === 14, 'Riichi GameManager reserves a 14-tile dead wall (the Task 14 hook)');
  assert(wall.remainingCount === 136 - 14 - 52, `live wall after the deal: 136 − 14 − 52 = 70 — the dealer's 14th tile is the first normal draw (${wall.remainingCount})`);
  const before = wall.getReservedDeadWallTiles().map((x) => x.instanceId);
  const state = rules.createDoraState(wall);
  const indicator = state.getDoraIndicators()[0];
  assert(indicator.instanceId === before[4], 'the first dora indicator is dead-wall tile #5 (after the four replacement tiles)');
  const repl = [wall.drawReplacement(), wall.drawReplacement()];
  assert(repl.map((x) => x.instanceId).join() === before.slice(0, 2).join(), 'Kan replacements are the dead wall\'s first tiles, in order');
  assert(wall.getReservedDeadWallTiles().map((x) => x.instanceId).join() === before.join(), 'the reserved layout never changes (drawn replacements included)');
  assert(rules.createDoraState(wall).getDoraIndicators()[0].instanceId === before[4], 'indicators stay put after replacement draws');
  assert(wall.remainingCount === 70 - 2, 'the live wall shrank by one per Kan (the dead wall keeps 14)');
  assert(new RiichiRules({ playerCount: 3 }).getTileSetOptions().deadWallSize === 14, 'three-player uses a 14-tile dead wall too');
  assertThrows(() => deadWallLayout(new Array(13).fill(t('dots-1'))), RangeError, 'layout needs exactly 14 tiles');
  assertThrows(() => rules.createDoraState({}), TypeError, 'createDoraState needs a WallManager');
});

// ---------------------------------------------------------------------------
section('3. RiichiDoraState', () => {
  const s = new RiichiDoraState(deadWall(['dots-4', 'wind-north', 'dragon-red', 'bamboo-9', 'characters-2'], ['dots-1', 'dots-2']));
  assert(s.revealedCount === 1 && s.getDoraFaces().join() === 'dots-5', 'one indicator at the start (4p → dora 5p)');
  s.revealKanDora();
  assert(s.getDoraFaces().join() === 'dots-5,wind-east', 'a Kan reveals the next indicator (North → East)');
  assert(s.getUraIndicators().map((x) => x.id).join() === 'dots-1,dots-2', 'ura indicators under each revealed indicator');
  [1, 2, 3, 4].forEach(() => s.revealKanDora());
  assert(s.revealedCount === 5, 'at most five indicators');
  const off = new RiichiDoraState(deadWall(['dots-4', 'dots-5']), { kanDora: false });
  off.revealKanDora();
  assert(off.revealedCount === 1, 'kanDora:false → Kans reveal nothing');
  const noKanUra = new RiichiDoraState(deadWall(['dots-4', 'dots-5'], ['dots-1', 'dots-2']), { kanUraDora: false });
  noKanUra.revealKanDora();
  assert(noKanUra.getUraIndicators().length === 1, 'kanUraDora:false → only the first ura indicator');
  assert(new RiichiDoraState(deadWall(['dots-4']), { uraDora: false }).getUraIndicators().length === 0, 'uraDora:false → none');
  const h = hand('555d 123b 789c EE 66d', [], makeTileFactory());
  assert(countDora(h.concealedTiles, [t('dots-4')]) === 3, 'three 5p with a 4p indicator → 3 dora');
  assert(countDora(h.concealedTiles, [t('dots-4'), t('dots-4', 3)]) === 6, 'two indicators pointing at the same tile count twice each');
  const withMeld = hand('123b 789c EE 66d', [{ type: 'pon', spec: '555d' }], makeTileFactory());
  assert(new RiichiDoraState(deadWall(['dots-4'])).doraContext(withMeld).dora === 3, 'dora in melds count');
  const st = new RiichiDoraState(deadWall(['dots-4']));
  st.restoreState({ revealed: 3 });
  assert(st.revealedCount === 3 && st.toJSON().revealed === 3, 'toJSON / restoreState');
  assertThrows(() => st.restoreState({ revealed: 6 }), RangeError, 'restore validates');
});

// ---------------------------------------------------------------------------
section('4. Red fives', () => {
  assert(isRedFive(Tile.fromId('dots-5', 'dots-5#1'), 3) && !isRedFive(Tile.fromId('dots-5', 'dots-5#2'), 3), 'copy #1 of a 5 is red');
  assert(!isRedFive(Tile.fromId('dots-5', 'dots-5#1'), 0), 'redFives: 0 → none');
  assert(!isRedFive(Tile.fromId('wind-east', 'wind-east#1'), 3) && !isRedFive(Tile.fromId('dots-4', 'dots-4#1'), 3), 'only fives');
  const h = hand('', [], makeTileFactory());
  ['dots-5#1', 'bamboo-5#1', 'characters-5#2'].forEach((iid) => h.addConcealedTile(Tile.fromId(iid.split('#')[0], iid)));
  assert(new RiichiDoraState(deadWall(['wind-east']), { redFives: 3 }).doraContext(h).akaDora === 2, 'two red fives held → akaDora 2');
});

// ---------------------------------------------------------------------------
section('5. Scoring with dora', () => {
  const R = new RiichiRules();
  const h = hand('234d 345b 567c 678c 88d', [], makeTileFactory());
  const win = h.concealedTiles.find((x) => x.id === 'dots-2');
  const state = new RiichiDoraState(deadWall(['dots-7', 'dots-1'], ['characters-4', 'dots-1']));
  state.revealKanDora();
  const plain = state.doraContext(h);
  assert(plain.dora === 3 && plain.uraDora === 0, 'dora 8p ×2 (indicator 7p) + 2p ×1 (indicator 1p) = 3; no ura without riichi');
  const riichi = state.doraContext(h, { isRiichi: true });
  assert(riichi.uraDora === 2, 'riichi: ura 5c (indicator 4c) ×1 + 2p (indicator 1p) ×1 = 2');
  const s = R.scoreHand(h, { winType: WIN_SOURCE.DISCARD, winningTile: win, seatWind: 'south', roundWind: 'east', isRiichi: true, dora: riichi });
  assert(s.han === 3 + 3 + 2 && s.breakdown.some((b) => b.id === 'uraDora' && b.han === 2), `Riichi + Pinfu + Tanyao (3) + 3 dora + 2 ura = 8 han (${s.han})`);
  const noYaku = hand('123d 456b 789b 123c EE', [], makeTileFactory());
  const ny = R.scoreHand(noYaku, { winType: WIN_SOURCE.DISCARD, winningTile: noYaku.concealedTiles[0], seatWind: 'east', dora: { dora: 4 } });
  assert(!ny.meetsMinimum, 'dora alone never make a win');
  assertThrows(() => new RiichiRules({ redFives: 2 }), RangeError, 'redFives must be 0 or 3');
  assertThrows(() => new RiichiRules({ uraDora: 'yes' }), TypeError, 'uraDora must be boolean');
  assert(R.getOptions().redFives === 0 && R.getOptions().kanDora && R.getOptions().uraDora, 'defaults: no red fives, kan dora + ura dora on');
});

summary();

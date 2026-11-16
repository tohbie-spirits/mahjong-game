/**
 * hongKongRules.test.mjs — rebuilt Tasks 21–26: RuleEngineInterface,
 * HongKongRules (legal actions, win validation), HongKongScoring, terminology.
 * Run: node tests/rules/hongKongRules.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand, tiles, makeTileFactory } from '../_helpers/tiles.mjs';
import { RuleEngineInterface, isValidRuleEngine } from '../../src/rules/RuleEngineInterface.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { scoreHongKongHand, HONG_KONG_POINTS } from '../../src/rules/hongkong/HongKongScoring.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { Tile } from '../../src/core/Tile.js';
import { ACTION_TYPE, KONG_TYPE, MELD_TYPE, WIND, SEAT_KIND, AI_DIFFICULTY } from '../../src/utils/constants.js';

const rules = new HongKongRules();
const ctx = (extra = {}) => ({ winType: 'discard', seatWind: WIND.SOUTH, roundWind: WIND.EAST, ...extra });
const ids = (bd) => bd.breakdown.map((b) => b.id).sort().join(',');

function playerWith(spec, melds = [], seatIndex = 1) {
  const f = makeTileFactory();
  const p = new PlayerManager({ seatIndex, seatKind: SEAT_KIND.AI, aiDifficulty: AI_DIFFICULTY.BASIC });
  const h = hand(spec, melds, f);
  for (const t of h.concealedTiles) p.addTileToHand(t);
  for (const m of h.melds) p.addMeld(m);
  p.seatWind = WIND.SOUTH;
  return { p, f };
}

section('Interface', () => {
  assertThrows(() => new RuleEngineInterface(), TypeError, 'abstract interface cannot be constructed');
  assert(isValidRuleEngine(rules) && !isValidRuleEngine({}), 'isValidRuleEngine duck-type check');
  assert(rules.getRulesetId() === 'hong_kong' && rules.getDisplayName().includes('Hong Kong'), 'identity');
  const o = rules.getTileSetOptions();
  assert(o.includeBonus === false && o.deadWallSize === 0, 'tile set: 136 tiles, no dead wall');
  assert(rules.getTerminology().chi === 'Chow' && rules.getMinimumFan() === 3, 'terminology + default minimum fan 3');
  assertThrows(() => new HongKongRules({ minimumFan: -1 }), TypeError, 'bad minimumFan');
});

section('Win structure', () => {
  assert(rules.checkWin(hand('123d 456d 789b 111c EE')).isWin, 'four sets + pair');
  assert(rules.checkWin(hand('19d 19b 19c ESWNRGH H')).structure === 'thirteen-orphans', 'thirteen orphans');
  assert(!rules.checkWin(hand('11d 22d 33b 44b 55c 66c EE')).isWin, 'seven pairs not valid by default');
  assert(new HongKongRules({ allowSevenPairs: true }).checkWin(hand('11d 22d 33b 44b 55c 66c EE')).structure === 'seven-pairs', 'seven pairs when enabled');
  assert(rules.checkWin(hand('456d EE', [{ type: MELD_TYPE.PON, spec: 'RRR' }, { type: MELD_TYPE.CHI, spec: '123b' }, { type: MELD_TYPE.PON, spec: '999c' }])).isWin, 'melds + concealed remainder');
  assert(!rules.checkWin(hand('123d 456d 789b 111c E S')).isWin, 'no pair → not a win');
  assert(!rules.checkWin(hand('123d 456d 789b 11c')).isWin, 'wrong tile count → not a win');
});

section('Scoring patterns', () => {
  let s = scoreHongKongHand(hand('123d 456d 789b 234c 55c'), ctx());
  assert(ids(s) === 'all-chows,concealed-hand' && s.fan === 2 && !s.meetsMinimum, 'concealed all-chows by discard = 2 (below minimum)');
  s = scoreHongKongHand(hand('123d 456d 789b 234c 55c'), ctx({ winType: 'self' }));
  assert(s.fan === 3 && s.meetsMinimum && s.points === HONG_KONG_POINTS[3], 'adding self-drawn reaches 3 fan; points from table');
  s = scoreHongKongHand(hand('55c', [{ type: MELD_TYPE.CHI, spec: '123d' }, { type: MELD_TYPE.CHI, spec: '456d' }, { type: MELD_TYPE.CHI, spec: '789b' }, { type: MELD_TYPE.PON, spec: '222c' }]), ctx());
  assert(s.fan === 0 && ids(s) === 'chicken-hand', 'open mixed hand = chicken hand');
  s = scoreHongKongHand(hand('111d 999d 555b 777c 22c'), ctx());
  assert(ids(s).includes('all-pungs') && s.fan === 4, 'all pungs 3 + concealed 1');
  s = scoreHongKongHand(hand('123d 456d 789d 111d EE'), ctx());
  assert(ids(s).includes('mixed-one-suit') && !ids(s).includes('pure-one-suit'), 'mixed one suit');
  s = scoreHongKongHand(hand('123d 456d 789d 111d 55d'), ctx());
  assert(ids(s).includes('pure-one-suit') && s.fan >= 7, 'pure one suit 7');
  s = scoreHongKongHand(hand('RRR GGG 123d 456b HH'), ctx());
  assert(ids(s).includes('small-three-dragons') && !ids(s).includes('dragon-pung'), 'small three dragons replaces dragon pungs');
  s = scoreHongKongHand(hand('RRR GGG HHH 123d 55b'), ctx());
  assert(ids(s).includes('big-three-dragons'), 'great three dragons');
  s = scoreHongKongHand(hand('SSS EEE 123d 456b 99c'), ctx());
  assert(ids(s).includes('seat-wind') && ids(s).includes('round-wind'), 'seat (South) + prevailing (East) wind pungs');
  s = scoreHongKongHand(hand('EEE SSS WWW NN 123d'), ctx());
  assert(ids(s).includes('small-four-winds') && !ids(s).includes('seat-wind'), 'small four winds replaces wind fan');
  s = scoreHongKongHand(hand('EEE SSS WWW NNN 55d'), ctx());
  assert(s.fan === 13 && s.isLimit, 'great four winds hits the limit (capped at 13)');
  s = scoreHongKongHand(hand('19d 19b 19c ESWNRGH H'), ctx());
  assert(s.structure === 'thirteen-orphans' && s.fan === 13, 'thirteen orphans = limit');
  s = scoreHongKongHand(hand('123d 456d 789b 234c 55c'), ctx({ winType: 'self', isLastTile: true, isKongReplacement: true }));
  assert(ids(s).includes('last-tile') && ids(s).includes('kong-replacement'), 'situational patterns');
  s = scoreHongKongHand(hand('111d 222d 333d 789b 55c'), ctx());
  assert(s.fan === 2 && ids(s) === 'all-chows,concealed-hand', 'best decomposition chosen: 111222333 read as three chows (2 fan) beats three pungs (1 fan)');
  s = scoreHongKongHand(hand('123d 456d'), ctx());
  assert(s.structure === null && s.fan === 0 && !s.meetsMinimum, 'incomplete hand scores nothing');
});

section('Legal actions — own turn', () => {
  const { p, f } = playerWith('123d 456d 789b 234c 5c');
  const drawn = f('characters-5');
  p.addTileToHand(drawn);
  let a = rules.getLegalActions({ kind: 'self', seatIndex: 1, drawnTile: drawn, wallRemaining: 40, roundWind: WIND.EAST }, p);
  const win = a.find((x) => x.type === ACTION_TYPE.WIN);
  assert(win && win.winType === 'self' && win.score.fan === 3, 'Tsumo offered when hand meets 3 fan');
  assert(a[a.length - 1].type === ACTION_TYPE.DISCARD, 'DISCARD pseudo-action always last');

  const k = playerWith('1111d 456d 789b 23c', [], 2);
  const d2 = k.f('characters-9'); k.p.addTileToHand(d2);
  a = rules.getLegalActions({ kind: 'self', seatIndex: 2, drawnTile: d2, wallRemaining: 10, roundWind: WIND.EAST }, k.p);
  const ck = a.find((x) => x.type === ACTION_TYPE.KONG);
  assert(ck && ck.kongType === KONG_TYPE.CONCEALED && ck.tiles.length === 4 && !a.some((x) => x.type === ACTION_TYPE.WIN), 'concealed kong offered; no win');
  const none = rules.getLegalActions({ kind: 'self', seatIndex: 2, drawnTile: d2, wallRemaining: 0, roundWind: WIND.EAST }, k.p);
  assert(!none.some((x) => x.type === ACTION_TYPE.KONG), 'no kong when the wall is empty');

  const ad = playerWith('456d 789b 23c 5d 1d', [{ type: MELD_TYPE.PON, spec: 'EEE' }], 3);
  const e4 = ad.f('wind-east'); ad.p.addTileToHand(e4);
  a = rules.getLegalActions({ kind: 'self', seatIndex: 3, drawnTile: e4, wallRemaining: 10, roundWind: WIND.EAST }, ad.p);
  const added = a.find((x) => x.kongType === KONG_TYPE.ADDED);
  assert(added && added.meldIndex === 0 && added.tile === e4, 'added kong onto own pung');
});

section('Legal actions — reacting to a discard', () => {
  const { p, f } = playerWith('34d 77b 777c 1d 9d 9b EE', [], 1);
  const disc = (id) => ({ kind: 'discard', seatIndex: 1, playerCount: 4, wallRemaining: 30, roundWind: WIND.EAST, discard: { tile: Tile.fromId(id, `${id}#4`), fromSeat: 0 } });
  let a = rules.getLegalActions(disc('dots-5'), p);
  const chis = a.filter((x) => x.type === ACTION_TYPE.CHI);
  assert(chis.length === 1 && chis[0].sequence.join() === 'dots-3,dots-4,dots-5' && chis[0].handTiles.length === 2, 'chi 3-4-5 from the left player');
  a = rules.getLegalActions(disc('dots-2'), p);
  assert(a.filter((x) => x.type === ACTION_TYPE.CHI).map((x) => x.sequence.join()).sort().join('|') === 'dots-1,dots-2,dots-3|dots-2,dots-3,dots-4', 'two chi options on 2: 1-2-3 and 2-3-4');
  a = rules.getLegalActions({ ...disc('dots-5'), discard: { tile: Tile.fromId('dots-5', 'dots-5#4'), fromSeat: 2 } }, p);
  assert(!a.some((x) => x.type === ACTION_TYPE.CHI), 'no chi from a non-left player');
  a = rules.getLegalActions(disc('bamboo-7'), p);
  assert(a.some((x) => x.type === ACTION_TYPE.PON) && !a.some((x) => x.type === ACTION_TYPE.KONG), 'pon with a pair');
  a = rules.getLegalActions(disc('characters-7'), p);
  const ek = a.find((x) => x.type === ACTION_TYPE.KONG);
  assert(ek && ek.kongType === KONG_TYPE.EXPOSED && ek.handTiles.length === 3 && a.some((x) => x.type === ACTION_TYPE.PON), 'exposed kong + pon with three in hand');
  assert(rules.getLegalActions({ ...disc('dots-5'), discard: { tile: Tile.fromId('dots-5', 'x#1'), fromSeat: 1 } }, p).length === 0, 'no actions on own discard');

  const r = playerWith('123d 456d 789d 111d E', [], 2);
  const ron = rules.getLegalActions({ kind: 'discard', seatIndex: 2, playerCount: 4, wallRemaining: 20, roundWind: WIND.EAST, discard: { tile: Tile.fromId('wind-east', 'wind-east#4'), fromSeat: 1 } }, r.p);
  const w = ron.find((x) => x.type === ACTION_TYPE.WIN);
  assert(w && w.winType === 'discard' && w.fromSeat === 1 && w.score.meetsMinimum, 'Ron offered (mixed one suit + concealed meets minimum)');
  const low = playerWith('123d 456d 789b 234c 5c', [], 2);
  const noRon = rules.getLegalActions({ kind: 'discard', seatIndex: 2, playerCount: 4, wallRemaining: 20, roundWind: WIND.EAST, discard: { tile: Tile.fromId('characters-5', 'characters-5#4'), fromSeat: 1 } }, low.p);
  assert(!noRon.some((x) => x.type === ACTION_TYPE.WIN), 'Ron NOT offered below the minimum fan (2 fan)');
  const lenient = new HongKongRules({ minimumFan: 0 });
  assert(lenient.getLegalActions({ kind: 'discard', seatIndex: 2, playerCount: 4, wallRemaining: 20, roundWind: WIND.EAST, discard: { tile: Tile.fromId('characters-5', 'characters-5#4'), fromSeat: 1 } }, low.p).some((x) => x.type === ACTION_TYPE.WIN), 'minimumFan option respected');
  assertThrows(() => rules.getLegalActions({ kind: 'nope' }, low.p), TypeError, 'unknown state kind throws');
});

summary();

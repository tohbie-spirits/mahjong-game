/**
 * chineseOfficialRules.test.mjs — Task 93: ChineseOfficialRules legal actions
 * & win validation, plus ChineseOfficialHandAnalysis and the starter fans.
 *
 * Sections:
 *   1. Hand analysis — kinds, knitted arrangements, standard readings, Seven
 *      Pairs (a doubled pair counts), Thirteen Orphans, Lesser / Greater
 *      Honors and Knitted, Knitted Straight (closed and with a meld), waits,
 *      interpretations with wait types
 *   2. Engine basics — interface, ids, options, tile-set options (flowers),
 *      structural checkWin (flowers ignored; 5th-copy probe)
 *   3. Win validation — every shape with the starter fans, the 8-point
 *      minimum, flowers never count toward it, best arrangement wins, no
 *      furiten, robbing an added Kong only, provider contract
 *   4. Self turn — Tsumo, concealed / added Kongs, none with the wall empty,
 *      flowers never discardable
 *   5. Calls on a discard — Pung, exposed Kong, Chow from the left only,
 *      three-player Chow option, final discard / robbed Kong / four melds →
 *      win only
 *   6. Action shapes + purity
 *
 * Run: node tests/rules/chineseOfficialRules.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { tiles, hand, makeTileFactory, faceIds } from '../_helpers/tiles.mjs';
import { ChineseOfficialRules, DEFAULT_CHINESE_OFFICIAL_OPTIONS, CO_WIN_REFUSAL } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import {
  KIND_COUNT, kindOfFaceId, faceIdOfKind, countsFromTiles, standardTiles, decomposeStandard, isSevenPairs, isThirteenOrphans,
  honorsKnitted, knittedStraights, analyzeComplete, findWaits, interpretWin, KNITTED_ARRANGEMENTS, WAIT_TYPE,
} from '../../src/rules/chineseOfficial/ChineseOfficialHandAnalysis.js';
import { detectFans, MCR_FANS } from '../../src/rules/chineseOfficial/ChineseOfficialScoring.js';
import { isValidRuleEngine } from '../../src/rules/RuleEngineInterface.js';
import { resolveExhaustiveDraw } from '../../src/core/DrawResolver.js';
import { createHandViewWithExtraTile } from '../../src/core/Hand.js';
import { Tile } from '../../src/core/Tile.js';
import { ACTION_TYPE, KONG_TYPE, RULESET_ID } from '../../src/utils/constants.js';

const counts = (spec) => countsFromTiles(tiles(spec));
const waitsOf = (spec, m = 0) => findWaits(counts(spec), m).map(faceIdOfKind).join(' ');
const ids = (spec) => faceIds(spec).join(' ');
const rules = new ChineseOfficialRules();
const discTile = (() => { let n = 0; return (id) => Tile.fromId(id, `${id}#disc${++n}`); })();
const flower = (n = 1) => Tile.fromId(`flower-${n}`, `flower-${n}#f`);

/** A player whose hand is built from a spec; the drawn tile is the LAST concealed tile. */
function player(concealedSpec, meldSpecs = [], { seatIndex = 1, extra = [] } = {}) {
  const f = makeTileFactory();
  const h = hand(concealedSpec, meldSpecs, f);
  for (const t of extra) h.addConcealedTile(t);
  return { seatIndex, seatWind: null, getHand: () => h };
}
const lastStd = (p) => standardTiles(p.getHand().concealedTiles).slice(-1)[0];
const self = (p, extra = {}) => ({ kind: 'self', seatIndex: p.seatIndex, playerCount: 4, drawnTile: lastStd(p), wallRemaining: 50, ...extra });
const onDiscard = (p, id, fromSeat, extra = {}) => ({ kind: 'discard', seatIndex: p.seatIndex, playerCount: 4, discard: { tile: discTile(id), fromSeat }, wallRemaining: 50, ...extra });
const types = (actions) => actions.map((a) => (a.type === ACTION_TYPE.KONG ? `kong:${a.kongType}` : a.type)).join(',');
/** validateWin on a complete spec, the winning tile being the last one. */
function validate(spec, context = {}, r = rules, melds = []) {
  const h = hand(spec, melds);
  const winningTile = context.winningTile ?? h.concealedTiles[h.concealedTiles.length - 1];
  return r.validateWin(h, { winType: 'self', ...context, winningTile });
}

// ---------------------------------------------------------------------------
section('1. Hand analysis', () => {
  assert(KIND_COUNT === 34 && kindOfFaceId('dots-1') === 0 && kindOfFaceId('characters-9') === 26 && faceIdOfKind(33) === 'dragon-white', 'kind numbering shared with the standard face order');
  assertThrows(() => kindOfFaceId('flower-1'), TypeError, 'a flower has no kind');
  assert(standardTiles([...tiles('12d'), flower()]).length === 2, 'standardTiles drops flowers');
  assertThrows(() => countsFromTiles(tiles('11111d')), RangeError, 'five copies rejected');
  assert(KNITTED_ARRANGEMENTS.length === 6 && KNITTED_ARRANGEMENTS.every((a) => a.kinds.length === 9), 'six knitted arrangements of nine kinds');
  assert(KNITTED_ARRANGEMENTS.some((a) => a.kinds.map(faceIdOfKind).join(' ') === ids('147d 258b 369c')), '147 dots / 258 bamboo / 369 characters is one');

  const d = decomposeStandard(counts('111222333d 456b EE'), 0);
  assert(d.length === 2 && d.some((x) => x.sets.every((s) => s.type === 'pung' || s.kind === 12)) && d.some((x) => x.sets.filter((s) => s.type === 'chow' && s.kind === 0).length === 3), 'three pungs OR three chows');
  assert(decomposeStandard(counts('123d 456d 789d 99c'), 1).length === 1, 'one meld: three sets + pair');
  assert(decomposeStandard(counts('89d 1b 123c 456c 789c EE'), 0).length === 0, 'chows never wrap across suits');

  assert(isSevenPairs(counts('11d 33d 55d 77b 99b EE RR'), 0), 'Seven Pairs');
  assert(isSevenPairs(counts('1111d 55d 77b 99b EE RR'), 0), 'MCR: four of a kind counts as two pairs');
  assert(!isSevenPairs(counts('11d 33d 55d 99b HH R'), 1), 'Seven Pairs is closed only');
  assert(isThirteenOrphans(counts('19d 19b 19c ESWNRGH H'), 0) && !isThirteenOrphans(counts('19d 19b 19c ESWNRG RR'), 0), 'Thirteen Orphans needs all 13 + one pair');

  const lesser = honorsKnitted(counts('147d 258b 369c ESWRG'), 0);
  assert(lesser && !lesser.greater && lesser.honors === 5, 'Lesser Honors and Knitted Tiles: 9 knitted + 5 honours');
  assert(honorsKnitted(counts('147d 25b 36c ESWNRGH'), 0)?.greater === true, 'Greater: all seven honours + 7 knitted');
  assert(honorsKnitted(counts('147d 258b 36c 1b ESWRG'), 0) === null, 'a tile outside the knitted set → not Honors and Knitted');
  assert(honorsKnitted(counts('147d 258b 369c ESWR R'), 0) === null, 'a pair → not Honors and Knitted');
  assert(honorsKnitted(counts('14d 47b 258b 369c ESWR'), 0) === null, 'two suits on 147 → no arrangement');

  const ks = knittedStraights(counts('147d 258b 369c 555c EE'), 0);
  assert(ks.length === 1 && ks[0].pair === kindOfFaceId('wind-east') && ks[0].sets[0].type === 'pung', 'Knitted Straight: 9 knitted + Pung of 5c + pair of East');
  assert(knittedStraights(counts('147d 258b 369c EE'), 1).length === 1, 'Knitted Straight with the extra set melded');
  assert(knittedStraights(counts('147d 258b 369c 123d EE'), 0).length === 1, '…or with a Chow sharing a knitted tile\'s face');
  assert(knittedStraights(counts('147d 258b 36c 555c EE 1b'), 0).length === 0, 'missing a knitted tile → none');

  const a = analyzeComplete(counts('147d 258b 369c ESWRG'), 0);
  assert(a.isComplete && a.honorsKnitted && !a.standard.length, 'analyzeComplete reports Honors and Knitted');
  const five = counts('1111d 234d 567d 89d EE'); five[0] = 5; five[8] = 0; // 11111d 234d 567d 8d EE
  assert(!analyzeComplete(five, 0).isComplete, 'a 5th copy is simply not complete');

  assert(waitsOf('123d 456d 789d 123c 2b') === ids('2b'), 'single wait');
  assert(waitsOf('147d 258b 36c 555c EE').split(' ').includes('characters-9'), 'Knitted Straight waits on the missing knitted tile');
  assert(waitsOf('147d 258b 369c ESWR') === ids('NGH'), 'Lesser Honors and Knitted waits on the missing honours (13 distinct, 9 knitted held)');
  assert(waitsOf('19d 19b 19c ESWNRGH').split(' ').length === 13, 'Thirteen Orphans: 13-sided wait');
  assert(waitsOf('1111d 55d 77b 99b EE R') === ids('R'), 'Seven Pairs with a quad waits on the single');
  assert(waitsOf('1111d 456d 789b 123c') === '', 'waiting only on a 5th copy is no wait');

  const ia = interpretWin(counts('123d 456d 789d 11b 234b'), 0, kindOfFaceId('bamboo-4'));
  assert(ia.length === 1 && ia[0].wait === WAIT_TYPE.OPEN, 'two-sided wait');
  assert(interpretWin(counts('12b 3b 456d 789d 123c EE'), 0, kindOfFaceId('bamboo-3'))[0].wait === WAIT_TYPE.EDGE, 'edge wait (12 + 3)');
  assert(interpretWin(counts('13b 2b 456d 789d 123c EE'), 0, kindOfFaceId('bamboo-2'))[0].wait === WAIT_TYPE.CLOSED, 'closed wait (13 + 2)');
  const kInt = interpretWin(counts('147d 258b 369c 555c EE'), 0, kindOfFaceId('characters-9'));
  assert(kInt.some((i) => i.structure === 'knitted-straight' && i.wait === WAIT_TYPE.KNITTED), 'winning on a knitted tile');
  assertThrows(() => interpretWin(counts('123d 456d 789d 11b 234b'), 0, kindOfFaceId('bamboo-9')), RangeError, 'the winning kind must be in the hand');
});

// ---------------------------------------------------------------------------
section('2. Engine basics', () => {
  assert(isValidRuleEngine(rules) && rules.getRulesetId() === RULESET_ID.CHINESE_OFFICIAL && rules.getDisplayName() === 'Chinese Official', 'implements the interface');
  assert(rules.getTerminology().chinese.win === '和' && rules.getMinimumPoints() === 8, 'terminology + minimum 8 points');
  assert(DEFAULT_CHINESE_OFFICIAL_OPTIONS.flowers === true && rules.getOptions().playerCount === 4, 'defaults');
  const ts = rules.getTileSetOptions();
  assert(ts.includeBonus === true && ts.deadWallSize === 0 && ts.excludedFaceIds.length === 0, '144 tiles with flowers, no dead wall');
  assert(new ChineseOfficialRules({ flowers: false }).getTileSetOptions().includeBonus === false, 'flowers:false → 136 tiles');
  assertThrows(() => new ChineseOfficialRules({ nope: 1 }), TypeError, 'unknown option');
  assertThrows(() => new ChineseOfficialRules({ playerCount: 5 }), RangeError, 'playerCount 3 or 4');
  assertThrows(() => new ChineseOfficialRules({ minimumPoints: -1 }), TypeError, 'minimumPoints ≥ 0');
  assertThrows(() => new ChineseOfficialRules({ fanProvider: 1 }), TypeError, 'fanProvider must be a function');
  assertThrows(() => new ChineseOfficialRules({ flowers: 'yes' }), TypeError, 'flowers boolean');

  const cw = (spec, melds = []) => rules.checkWin(hand(spec, melds));
  assert(cw('123d 456b 789c 111d EE').structure === 'standard', 'standard');
  assert(cw('11d 33d 55d 77b 99b EE RR').structure === 'seven-pairs' && cw('1111d 55d 77b 99b EE RR').isWin, 'Seven Pairs (also with a quad)');
  assert(cw('19d 19b 19c ESWNRGH H').structure === 'thirteen-orphans', 'Thirteen Orphans');
  assert(cw('147d 258b 369c ESWRG').structure === 'honors-knitted', 'Honors and Knitted');
  assert(cw('147d 258b 369c 555c EE').structure === 'knitted-straight', 'Knitted Straight');
  assert(cw('147d 258b 369c EE', [{ type: 'pon', spec: '555c' }]).structure === 'knitted-straight', 'Knitted Straight with a melded Pung');
  assert(!cw('123d 456b 789c 111d E').isWin && !cw('123d 456b 789c 111d ES').isWin, 'wrong size / incomplete');
  const withFlower = hand('123d 456b 789c 111d EE'); withFlower.addConcealedTile(flower(2));
  assert(rules.checkWin(withFlower).isWin, 'a flower among the concealed tiles is ignored');

  const p = player('1111d 456d 789b 123c');
  let res = null; let err = null;
  try { res = resolveExhaustiveDraw([{ seatIndex: 0, displayName: 'x', getHand: p.getHand }], rules); } catch (e) { err = e; }
  assert(!err && res[0].tenpai === false, 'exhaustive-draw probe of a 5th copy: no throw, not tenpai');
});

// ---------------------------------------------------------------------------
section('3. Win validation', () => {
  const v = (spec, ctx, r) => validate(spec, ctx, r);
  const ok = (x, id, pts) => x.valid && x.reason === null && x.fans.some((f) => f.id === id && f.points === pts) && x.points >= pts;
  assert(ok(v('19d 19b 19c ESWNRGH H'), 'thirteen-orphans', 88), 'Thirteen Orphans: 88');
  assert(ok(v('11d 33d 55d 77b 99b EE RR'), 'seven-pairs', 24), 'Seven Pairs: 24');
  assert(ok(v('147d 25b 36c ESWNRGH'), 'greater-honors-knitted', 24), 'Greater Honors and Knitted Tiles: 24');
  assert(ok(v('147d 258b 369c ESWRG'), 'lesser-honors-knitted', 12), 'Lesser Honors and Knitted Tiles: 12');
  assert(ok(v('147d 258b 369c 555c EE'), 'knitted-straight', 12), 'Knitted Straight: 12');
  assert(v('123d 456d 789d 111d 99d').valid && v('123d 456d 789d 111d 99d').fans.some((f) => f.id === 'full-flush' && f.points === 24), 'Full Flush: 24 (among the fans)');
  assert(['seven-pairs', 'full-flush'].every((id) => v('11d 33d 55d 77d 99d 22d 44d').fans.some((f) => f.id === id)) && v('11d 33d 55d 77d 99d 22d 44d').points >= 48, 'Seven Pairs + Full Flush add up');

  const low = v('234d 567b 678c 22d 345b', { winType: 'discard' }); // All Chows 2 + All Simples 2 + Concealed Hand 2 = 6
  assert(!low.valid && low.reason === CO_WIN_REFUSAL.BELOW_MINIMUM && low.structure === 'standard', 'a complete hand worth < 8 points is refused (no false hu)');
  const inc = v('123d 456b 789c 111d ES');
  assert(!inc.valid && inc.reason === CO_WIN_REFUSAL.INCOMPLETE, 'incomplete');
  assert(new ChineseOfficialRules({ minimumPoints: 0 }).validateWin(hand('123d 456b 789c 111d EE'), { winType: 'self', winningTile: tiles('E')[0] }).valid, 'minimumPoints 0 accepts any complete hand');

  // Flowers: 1 point each, never toward the minimum.
  const seven = () => [{ id: 'x', name: 'X', points: 7 }];
  const r7 = new ChineseOfficialRules({ fanProvider: seven });
  const f3 = validate('123d 456b 789c 111d EE', { flowerCount: 3 }, r7);
  assert(!f3.valid && f3.points === 7 && f3.flowerPoints === 3 && f3.reason === CO_WIN_REFUSAL.BELOW_MINIMUM, '7 points + 3 flowers is still below 8');
  const f2 = validate('123d 456d 789d 111d 99d', { flowerCount: 2 });
  assert(f2.valid && f2.total === f2.points + 2 && f2.flowerPoints === 2, 'flowers added after the minimum: points + 2');

  // Best arrangement counts.
  const reward = (type) => ({ interpretation }) => ((interpretation.sets ?? []).filter((x) => x.type === type).length >= 3 ? [{ id: type, name: type, points: 10 }] : [{ id: 'other', name: 'other', points: 1 }]);
  for (const type of ['pung', 'chow']) {
    const best = validate('111222333d 456b EE', {}, new ChineseOfficialRules({ fanProvider: reward(type) }));
    assert(best.valid && best.points === 10 && best.fans[0].id === type && best.interpretations.length >= 2, `the highest-scoring arrangement is the one scored (rewarding three ${type}s)`);
  }
  assertThrows(() => validate('123d 456d 789d 111d 99d', {}, new ChineseOfficialRules({ fanProvider: () => null })), TypeError, 'provider must return an array');
  let seen = null;
  validate('123d 456d 789d 111d 99d', { seatWind: 'w', flowerCount: 1 }, new ChineseOfficialRules({ fanProvider: (input) => { seen = input; return []; } }));
  assert(seen && seen.context.seatWind === 'w' && seen.context.flowerCount === 1 && seen.counts.length === 34 && typeof seen.kindOf === 'function' && Array.isArray(seen.melds), 'provider receives interpretation, counts, melds, kindOf and the context');

  // Robbing the Kong.
  const rob = (type) => validate('19d 19b 19c ESWNRGH H', { winType: 'discard', isRobbingKong: true, robbedKongType: type });
  assert(rob(KONG_TYPE.ADDED).valid, 'robbing an added Kong');
  assert(!rob(KONG_TYPE.CONCEALED).valid && rob(KONG_TYPE.CONCEALED).reason === CO_WIN_REFUSAL.CANNOT_ROB, 'a concealed Kong can never be robbed — not even for Thirteen Orphans');
  assertThrows(() => rules.validateWin(hand('123d 456d 789d 111d 99d'), {}), TypeError, 'winningTile required');
  assertThrows(() => detectFans({ interpretation: { structure: 'standard' }, counts: counts('123d 456b 789c 111d EE'), melds: [] }), TypeError, 'detectFans needs kindOf');
  assert(MCR_FANS['full-flush'].points === 24 && Object.isFrozen(MCR_FANS), 'fan table frozen');

  // Melded hands.
  const meldedFlush = rules.validateWin(hand('234d 456d 789d 99d', [{ type: 'pon', spec: '111d' }]), { winType: 'self', winningTile: tiles('9d')[0] });
  assert(meldedFlush.valid && meldedFlush.fans.some((f) => f.id === 'full-flush'), 'Full Flush with a melded Pung');
});

// ---------------------------------------------------------------------------
section('4. Self turn', () => {
  const p = player('123d 345d 678d 999d 11d');
  const acts = rules.getLegalActions(self(p), p);
  const win = acts.find((a) => a.type === ACTION_TYPE.WIN);
  assert(win && win.winType === 'self' && win.validation.valid && win.score.meetsMinimum && win.score.fan === win.validation.points && win.validation.fans.some((f) => f.id === 'full-flush'), 'Tsumo offered on a valid win, with validation + score');
  assert(types(acts) === 'win,discard', `nothing else (${types(acts)})`);
  const lowP = player('234d 567b 678c 11d 345b'); // Fully Concealed 4 + All Chows 2 = 6
  assert(!rules.getLegalActions(self(lowP), lowP).some((a) => a.type === ACTION_TYPE.WIN), 'no Tsumo below 8 points');
  assert(!rules.getLegalActions(self(p, { drawnTile: null }), p).some((a) => a.type === ACTION_TYPE.WIN), 'no win without a drawn tile (after a Chow / Pung)');

  const k = player('1111d 456b 22b 3c', [{ type: 'pon', spec: 'EEE' }], { extra: tiles('E') });
  const kt = types(rules.getLegalActions(self(k), k));
  assert(kt.includes('kong:concealed') && kt.includes('kong:added'), `concealed + added Kongs (${kt})`);
  assert(!types(rules.getLegalActions(self(k, { wallRemaining: 0 }), k)).includes('kong'), 'no Kong with the wall empty');

  const fl = player('123d 456b 789c 11d 23c', [], { extra: [flower(3)] });
  const disc = rules.getLegalActions(self(fl), fl).find((a) => a.type === ACTION_TYPE.DISCARD);
  assert(disc.allowedTiles.length === 13 && disc.allowedTiles.every((t) => !t.isBonus), 'flowers are never discardable');
  const flk = player('123d 456b 789c 11d 23c', [], { extra: [flower(1), flower(2)] });
  assert(!types(rules.getLegalActions(self(flk), flk)).includes('kong'), 'flowers never form a Kong');
  assert(!rules.getLegalActions(self(p, { drawnTile: flower() }), p).some((a) => a.type === ACTION_TYPE.WIN), 'a drawn flower is not a winning tile');
});

// ---------------------------------------------------------------------------
section('5. Calls on a discard', () => {
  const p = player('23d 55b 555c 789c 1d EE', [], { seatIndex: 1 });
  const fromLeft = types(rules.getLegalActions(onDiscard(p, 'dots-4', 0), p));
  assert(fromLeft === 'chi', `Chow from the left player (${fromLeft})`);
  const chows = rules.getLegalActions(onDiscard(p, 'dots-1', 0), p).filter((a) => a.type === ACTION_TYPE.CHI);
  assert(chows.length === 1 && chows[0].sequence.join(' ') === ids('123d'), 'Chow 1-2-3 on a 1');
  assert(rules.getLegalActions(onDiscard(p, 'dots-4', 2), p).length === 0, 'no Chow from anyone else');
  assert(types(rules.getLegalActions(onDiscard(p, 'bamboo-5', 3), p)) === 'pon', 'Pung from anyone');
  assert(types(rules.getLegalActions(onDiscard(p, 'characters-5', 2), p)) === 'kong:exposed,pon', 'exposed Kong + Pung');
  assert(rules.getLegalActions(onDiscard(p, 'bamboo-5', 1), p).length === 0, 'nothing on your own discard');

  const p3 = player('23d 55b 555c 789c 1d EE', [], { seatIndex: 1 });
  assert(types(new ChineseOfficialRules({ playerCount: 3 }).getLegalActions(onDiscard(p3, 'dots-4', 0, { playerCount: 3 }), p3)) === 'chi', 'three players: Chow from the left');
  assert(new ChineseOfficialRules({ playerCount: 3, threePlayerChow: false }).getLegalActions(onDiscard(p3, 'dots-4', 0, { playerCount: 3 }), p3).length === 0, 'threePlayerChow:false → none');
  const p30 = player('23d 55b 555c 789c 1d EE', [], { seatIndex: 0 });
  assert(types(new ChineseOfficialRules({ playerCount: 3 }).getLegalActions(onDiscard(p30, 'dots-4', 2, { playerCount: 3 }), p30)) === 'chi', 'three players: seat 0 chows from seat 2 (wrap-around)');

  // Ron + no furiten.
  const w = player('123d 456d 789d 111d 9d', [], { seatIndex: 2 });
  const ron = rules.getLegalActions(onDiscard(w, 'dots-9', 0, { ownDiscards: ['dots-9'], isTemporaryFuriten: true }), w);
  assert(ron[0]?.type === ACTION_TYPE.WIN && ron[0].fromSeat === 0 && ron[0].validation.fans.some((f) => f.id === 'full-flush'), 'Ron on a valid win — no furiten in MCR (own discards / passed wins ignored)');
  assert(types(ron) === 'win,pon', `Ron listed first, Pung also possible (${types(ron)})`);
  const low = player('234d 567b 678c 22d 34b', [], { seatIndex: 2 });
  assert(!rules.getLegalActions(onDiscard(low, 'bamboo-5', 0), low).some((a) => a.type === ACTION_TYPE.WIN), 'no Ron below 8 points');

  // Final discard, robbed Kong, four melds.
  const both = player('123d 456d 789d 11d 99d', [], { seatIndex: 1 });
  assert(types(rules.getLegalActions(onDiscard(both, 'dots-9', 0), both)).split(',').sort().join() === 'chi,kong:exposed,pon,win', 'normally Ron, exposed Kong, Pung and (from the left) Chow are all offered');
  assert(types(rules.getLegalActions(onDiscard(both, 'dots-9', 0, { wallRemaining: 0 }), both)) === 'win', 'final discard: only the win');
  const robbed = (type) => { const s = onDiscard(both, 'dots-9', 0); s.discard.robbedKong = type; return types(rules.getLegalActions(s, both)); };
  assert(robbed(KONG_TYPE.ADDED) === 'win', 'robbing an added Kong: only the win');
  const orphans = player('19d 19b 19c ESWNRG H', [], { seatIndex: 1 });
  const robC = onDiscard(orphans, 'dragon-white', 0); robC.discard.robbedKong = KONG_TYPE.CONCEALED;
  assert(rules.getLegalActions(robC, orphans).length === 0, 'a concealed Kong tile: nothing, even for Thirteen Orphans');
  const four = player('9d', [{ type: 'pon', spec: '111d' }, { type: 'pon', spec: '222d' }, { type: 'chi', spec: '345d' }, { type: 'pon', spec: '777d' }], { seatIndex: 1 });
  assert(types(rules.getLegalActions(onDiscard(four, 'dots-9', 0), four)) === 'win', 'four melds: only the win (Full Flush)');
  assert(rules.getLegalActions(onDiscard(p, 'flower-1', 0), p).length === 0, 'a flower is never claimable');
});

// ---------------------------------------------------------------------------
section('6. Action shapes + purity', () => {
  const p = player('23d 55b 555c 789c 1d EE', [], { seatIndex: 1 });
  const before = p.getHand().concealedTiles.map((t) => t.instanceId).join();
  const all = [...rules.getLegalActions(onDiscard(p, 'dots-4', 0), p), ...rules.getLegalActions(onDiscard(p, 'characters-5', 2), p), ...rules.getLegalActions(self(p), p)];
  const handIds = new Set(p.getHand().concealedTiles.map((t) => t.instanceId));
  const used = all.flatMap((a) => a.handTiles ?? a.tiles ?? []);
  assert(used.length > 0 && used.every((t) => handIds.has(t.instanceId)), 'call tiles are real tiles from the hand');
  assert(p.getHand().concealedTiles.map((t) => t.instanceId).join() === before, 'the hand is unchanged');
  const view = createHandViewWithExtraTile(p.getHand(), discTile('dots-4'));
  assert(view.concealedCount === 14 && p.getHand().concealedCount === 13, 'Ron checks use a view, not the hand');
  assertThrows(() => rules.getLegalActions({ kind: 'x' }, p), TypeError, 'unknown state kind');
  assertThrows(() => rules.getLegalActions({ kind: 'discard', discard: {} }, p), TypeError, 'discard state needs tile + fromSeat');
  assertThrows(() => rules.getLegalActions(null, p), TypeError, 'state required');
});

summary();

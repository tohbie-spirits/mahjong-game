/**
 * riichiWinValidation.test.mjs — Task 82: Riichi win validation.
 *
 * Sections:
 *   1. interpretWin — wait types (ryanmen, kanchan, penchan at both edges,
 *      shanpon, tanki), several interpretations of one win, Seven Pairs,
 *      Thirteen Orphans 13-sided vs single, with melds, validation
 *   2. validateWin — incomplete hands, structure, waits, melds, isClosed,
 *      the yaku requirement (Riichi, Fully Concealed Hand; open hands and
 *      plain closed Ron have no yaku yet)
 *   3. Furiten — any wait in your own discards (tiles or ids, claimed ones
 *      too), temporary and riichi furiten; Tsumo is never blocked
 *   4. Yaku provider — contract, custom providers, output checking, options
 *   5. WIN actions in getLegalActions — Tsumo (also in riichi and on a
 *      replacement draw), Ron (also in riichi and on the final discard),
 *      furiten from state or the PlayerManager's own pile, no Tsumo right
 *      after a call, action shape
 *   6. Robbing a Kan (chankan) — added Kan: Ron only, no calls; closed Kan:
 *      only Thirteen Orphans (option)
 *
 * Run: node tests/rules/riichiWinValidation.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { tiles, hand, makeTileFactory } from '../_helpers/tiles.mjs';
import { RiichiRules, WIN_REFUSAL } from '../../src/rules/riichi/RiichiRules.js';
import { countsFromTiles, interpretWin, kindOfFaceId, WAIT_TYPE } from '../../src/rules/riichi/RiichiHandAnalysis.js';
import { detectYaku, RIICHI_YAKU } from '../../src/rules/riichi/RiichiYaku.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { Tile } from '../../src/core/Tile.js';
import { ACTION_TYPE, KONG_TYPE, MELD_TYPE, SEAT_KIND, WIN_SOURCE } from '../../src/utils/constants.js';

const rules = new RiichiRules();
const discTile = (() => { let n = 0; return (id) => Tile.fromId(id, `${id}#disc${++n}`); })();
const waitsOn = (spec, winFace, m = 0) => interpretWin(countsFromTiles(tiles(spec)), m, kindOfFaceId(winFace)).map((i) => i.wait).sort().join(',');
/** Complete hand from a spec; the winning tile is the copy of `winFace` in it. */
function winHand(spec, meldSpecs = []) { return hand(spec, meldSpecs, makeTileFactory()); }
const winTileOf = (h, faceId) => h.concealedTiles.filter((t) => t.id === faceId).pop();
const ctxSelf = (h, faceId, extra = {}) => ({ winType: WIN_SOURCE.SELF, winningTile: winTileOf(h, faceId), ...extra });
const ctxRon = (h, faceId, extra = {}) => ({ winType: WIN_SOURCE.DISCARD, winningTile: winTileOf(h, faceId), ...extra });
const player = (spec, meldSpecs = [], seatIndex = 1) => { const h = hand(spec, meldSpecs, makeTileFactory()); return { seatIndex, score: 25000, getHand: () => h }; };
const last = (p) => p.getHand().concealedTiles[p.getHand().concealedTiles.length - 1];

// ---------------------------------------------------------------------------
section('1. interpretWin — wait types', () => {
  assert(waitsOn('123d 456b 789b 123c EE', 'dots-1') === 'ryanmen', '23 + 1 → ryanmen');
  assert(waitsOn('234d 456b 789b 123c EE', 'dots-4') === 'ryanmen', '23 + 4 → ryanmen');
  assert(waitsOn('123d 456b 789b 123c EE', 'dots-2') === 'kanchan', '13 + 2 → kanchan');
  assert(waitsOn('123d 456b 789b 123c EE', 'dots-3') === 'penchan', '12 + 3 → penchan (edge)');
  assert(waitsOn('789d 456b 789b 123c EE', 'dots-7') === 'penchan', '89 + 7 → penchan (edge)');
  assert(waitsOn('789d 456b 789b 123c EE', 'dots-9') === 'ryanmen', '78 + 9 → ryanmen');
  assert(waitsOn('111d 99d 456b 789b 123c', 'dots-1') === 'shanpon', '11 + 99, 1 arrives → shanpon');
  assert(waitsOn('123d 456b 789b 123c EE', 'wind-east') === 'tanki', 'E + E → tanki');
  assert(waitsOn('234d 44d 456b 789c EEE', 'dots-4') === 'ryanmen,tanki', '23 44 + 4: ryanmen (234 + 44) or tanki (234 + 4 4)');
  const many = interpretWin(countsFromTiles(tiles('111222333d 456b EE')), 0, kindOfFaceId('dots-3'));
  assert(many.length === 2 && many.map((i) => i.wait).sort().join() === 'penchan,shanpon', '111222333 won on 3: triplet reading (shanpon) and run reading (penchan, 12 + 3)');
  assert(many.every((i) => i.structure === 'standard' && Array.isArray(i.sets) && (i.winningPart === 'pair' || Number.isInteger(i.winningPart))), 'standard interpretations carry the reading and the winning part');
  const sp = interpretWin(countsFromTiles(tiles('11d 33d 55d 77b 99b EE RR')), 0, kindOfFaceId('dragon-red'));
  assert(sp.length === 1 && sp[0].structure === 'seven-pairs' && sp[0].wait === WAIT_TYPE.TANKI, 'Seven Pairs → tanki');
  const both = interpretWin(countsFromTiles(tiles('112233d 445566b 77c')), 0, kindOfFaceId('characters-7'));
  assert(both.some((i) => i.structure === 'seven-pairs') && both.some((i) => i.structure === 'standard'), 'a hand that is both Seven Pairs and standard lists both');
  const k13 = interpretWin(countsFromTiles(tiles('19d 19b 19c ESWNRGH 9c')), 0, kindOfFaceId('characters-9'));
  assert(k13.length === 1 && k13[0].wait === WAIT_TYPE.THIRTEEN_SIDED, 'Thirteen Orphans won on a duplicate → 13-sided');
  const k1 = interpretWin(countsFromTiles(tiles('19d 19b 19c ESWNRGH 9c')), 0, kindOfFaceId('dragon-white'));
  assert(k1.length === 1 && k1[0].wait === WAIT_TYPE.SINGLE, 'Thirteen Orphans won on the missing kind → single wait');
  assert(waitsOn('123d 456b 99c', 'dots-1', 2) === 'ryanmen', 'with two melds');
  assertThrows(() => interpretWin(countsFromTiles(tiles('123d 456b 789b 123c EE')), 0, kindOfFaceId('dots-9')), RangeError, 'winning kind not in the hand throws');
  assertThrows(() => interpretWin(countsFromTiles(tiles('123d 456b 789b 123c E')), 0, 0), RangeError, 'wrong tile total throws');
  assert(interpretWin(countsFromTiles(tiles('124d 456b 789b 123c EE')), 0, 0).length === 0, 'incomplete → no interpretations');
});

// ---------------------------------------------------------------------------
section('2. validateWin — structure and the yaku requirement', () => {
  const h = winHand('123d 456b 789b 123c EE');
  const tsumo = rules.validateWin(h, ctxSelf(h, 'dots-1'));
  assert(tsumo.valid && tsumo.reason === null && tsumo.structure === 'standard', 'closed Tsumo → valid');
  assert(tsumo.yaku.map((y) => y.id).join() === 'menzen-tsumo,pinfu' && tsumo.yaku[0].han === 1, 'yaku: Fully Concealed Hand + Pinfu (Task 83)');
  assert(tsumo.waits.join() === 'dots-1,dots-4' && tsumo.isClosed && tsumo.melds.length === 0, 'waits of the hand before the win; closed; no melds');
  // East as seat wind makes the EE pair valuable → no Pinfu, and nothing else applies.
  const ron = rules.validateWin(h, ctxRon(h, 'dots-1', { seatWind: 'east' }));
  assert(!ron.valid && ron.reason === WIN_REFUSAL.NO_YAKU && ron.interpretations.length === 1, 'closed Ron with no yaku (seat-wind pair spoils Pinfu) → refused');
  const riichiRon = rules.validateWin(h, ctxRon(h, 'dots-1', { isRiichi: true, seatWind: 'east' }));
  assert(riichiRon.valid && riichiRon.yaku.map((y) => y.id).join() === 'riichi', 'Ron after riichi → valid (Riichi)');
  const both = rules.validateWin(h, ctxSelf(h, 'dots-1', { isRiichi: true }));
  assert(both.yaku.map((y) => y.id).join() === 'riichi,menzen-tsumo,pinfu', 'riichi + Tsumo (+ Pinfu) → all three yaku');

  const open = winHand('123d 456b 123c EE', [{ type: MELD_TYPE.PON, spec: '777b' }]);
  const o = rules.validateWin(open, ctxSelf(open, 'dots-1'));
  assert(!o.valid && o.reason === WIN_REFUSAL.NO_YAKU && !o.isClosed && o.melds[0].type === 'pon' && o.melds[0].open, 'open hand Tsumo → no yaku; melds described');
  const kan = winHand('123d 456b 123c EE', [{ type: MELD_TYPE.KONG, spec: '7777b', concealed: true }]);
  const kv = rules.validateWin(kan, ctxSelf(kan, 'dots-1'));
  assert(kv.valid && kv.isClosed && kv.melds[0].open === false, 'a closed Kan keeps the hand closed → Fully Concealed Hand');

  const incomplete = winHand('124d 456b 789b 123c EE');
  assert(rules.validateWin(incomplete, ctxSelf(incomplete, 'dots-1')).reason === WIN_REFUSAL.INCOMPLETE, 'incomplete hand');
  const short = winHand('123d 456b 789b 123c E');
  assert(rules.validateWin(short, ctxSelf(short, 'dots-1')).reason === WIN_REFUSAL.INCOMPLETE, '13 tiles → incomplete');
  assert(rules.validateWin(h, { winType: WIN_SOURCE.SELF, winningTile: discTile('dragon-red') }).reason === WIN_REFUSAL.INCOMPLETE, 'winning tile not in the hand → incomplete');
  const sp = winHand('11d 33d 55d 77b 99b EE RR');
  assert(rules.validateWin(sp, ctxSelf(sp, 'dragon-red')).structure === 'seven-pairs', 'Seven Pairs structure');
  const k13 = winHand('19d 19b 19c ESWNRGH 9c');
  assert(rules.validateWin(k13, ctxSelf(k13, 'characters-9')).structure === 'thirteen-orphans', 'Thirteen Orphans structure');
  assertThrows(() => rules.validateWin(h, { winType: 'bogus', winningTile: winTileOf(h, 'dots-1') }), TypeError, 'bad winType throws');
  assertThrows(() => rules.validateWin(h, { winType: WIN_SOURCE.SELF }), TypeError, 'missing winningTile throws');
  assertThrows(() => rules.validateWin(null, {}), TypeError, 'missing hand throws');
});

// ---------------------------------------------------------------------------
section('3. Furiten', () => {
  const h = winHand('123d 456b 789b 123c EE');   // waits 1d / 4d; wins on 1d
  const riichi = { isRiichi: true };
  assert(rules.validateWin(h, ctxRon(h, 'dots-1', { ...riichi, ownDiscards: ['dots-4'] })).reason === WIN_REFUSAL.FURITEN, 'discarded 4d (the OTHER wait) → furiten on 1d too');
  assert(rules.validateWin(h, ctxRon(h, 'dots-1', { ...riichi, ownDiscards: [discTile('dots-1')] })).furiten.discard, 'own discards may be Tile objects');
  assert(rules.validateWin(h, ctxRon(h, 'dots-1', { ...riichi, ownDiscards: ['dots-7', 'wind-north'] })).valid, 'unrelated discards → no furiten');
  const t = rules.validateWin(h, ctxRon(h, 'dots-1', { ...riichi, isTemporaryFuriten: true }));
  assert(!t.valid && t.reason === WIN_REFUSAL.FURITEN && t.furiten.temporary, 'temporary furiten (passed a win since your last discard)');
  const r = rules.validateWin(h, ctxRon(h, 'dots-1', { ...riichi, isRiichiFuriten: true }));
  assert(!r.valid && r.furiten.riichi, 'riichi furiten (passed a win after declaring)');
  const ts = rules.validateWin(h, ctxSelf(h, 'dots-1', { ...riichi, ownDiscards: ['dots-4'], isTemporaryFuriten: true, isRiichiFuriten: true }));
  assert(ts.valid && !ts.furiten.discard && !ts.furiten.temporary, 'furiten never blocks Tsumo');
  // Furiten is reported before the yaku check, so a furiten no-yaku hand says "furiten".
  assert(rules.validateWin(h, ctxRon(h, 'dots-1', { ownDiscards: ['dots-1'] })).reason === WIN_REFUSAL.FURITEN, 'furiten takes precedence over no-yaku');
});

// ---------------------------------------------------------------------------
section('4. Yaku provider', () => {
  assert(RIICHI_YAKU.riichi.closedHan === 1 && RIICHI_YAKU.riichi.openHan === 0 && Object.isFrozen(RIICHI_YAKU), 'yaku table');
  assert(detectYaku({ isClosed: false, winType: WIN_SOURCE.SELF, context: { isRiichi: true } }).length === 0, 'no closed-only yaku for an open hand');
  let seen = null;
  const everything = (input) => { seen = input; return [{ id: 'test', name: 'Test Yaku', han: 2 }]; };
  const custom = new RiichiRules({ yakuProvider: everything });
  const open = winHand('123d 456b 123c EE', [{ type: MELD_TYPE.PON, spec: '777b' }]);
  const v = custom.validateWin(open, ctxRon(open, 'dots-1', { roundWind: 'east', isIppatsu: true }));
  assert(v.valid && v.yaku[0].id === 'test', 'a custom provider decides the yaku');
  assert(seen.hand === open && seen.winType === WIN_SOURCE.DISCARD && seen.isClosed === false && seen.melds.length === 1 && seen.interpretations.length >= 1 && seen.context.isIppatsu === true && seen.winningTile.id === 'dots-1', 'provider receives hand, interpretations, melds, isClosed, winType, winningTile and context');
  const bad = new RiichiRules({ yakuProvider: () => [{ id: 'x', name: 'X', han: 0 }] });
  assertThrows(() => bad.validateWin(open, ctxSelf(open, 'dots-1')), TypeError, 'a provider returning a 0-han yaku throws');
  assertThrows(() => new RiichiRules({ yakuProvider: () => null }).validateWin(open, ctxSelf(open, 'dots-1')), TypeError, 'a provider returning non-array throws');
  assertThrows(() => new RiichiRules({ yakuProvider: 'no' }), TypeError, 'non-function provider rejected');
  assertThrows(() => new RiichiRules({ kokushiRobsConcealedKong: 1 }), TypeError, 'non-boolean kokushi option rejected');
});

// ---------------------------------------------------------------------------
section('5. WIN actions in getLegalActions', () => {
  const tsumoP = player('123d 456b 789b 123c EE');
  const tsumoTile = tsumoP.getHand().concealedTiles.find((t) => t.id === 'dots-1');
  const st = { kind: 'self', seatIndex: 1, playerCount: 4, drawnTile: tsumoTile, wallRemaining: 30 };
  const win = rules.getLegalActions(st, tsumoP).find((a) => a.type === ACTION_TYPE.WIN);
  assert(win && win.winType === WIN_SOURCE.SELF && win.tile === tsumoTile && win.validation.valid, 'Tsumo action carries the validation');
  const inRiichi = rules.getLegalActions({ ...st, isRiichi: true }, tsumoP);
  assert(inRiichi.map((a) => a.type).join() === 'win,discard' && inRiichi[0].validation.yaku.length === 3, 'in riichi: Tsumo (riichi, tsumo, pinfu) + the forced discard');
  let ctxSeen = null;
  const spy = new RiichiRules({ yakuProvider: (i) => { ctxSeen = i.context; return detectYaku(i); } });
  spy.getLegalActions({ ...st, isReplacementDraw: true, isIppatsu: true }, tsumoP);
  assert(ctxSeen.isKongReplacement === true && ctxSeen.isIppatsu === true && ctxSeen.isLastTile === false, 'replacement draw / ippatsu flags reach the yaku provider');
  spy.getLegalActions({ ...st, wallRemaining: 0 }, tsumoP);
  assert(ctxSeen.isLastTile === true, 'last tile flag reaches the provider');
  const afterCall = rules.getLegalActions({ kind: 'self', seatIndex: 1, wallRemaining: 30, lastCall: { type: 'pon', tile: discTile('wind-east') } }, tsumoP);
  assert(!afterCall.some((a) => a.type === ACTION_TYPE.WIN), 'no Tsumo right after a call (nothing was drawn)');

  const ronP = player('23d 456b 789b 123c EE');
  const disc = (faceId, extra = {}) => ({ kind: 'discard', seatIndex: 1, playerCount: 4, wallRemaining: 30, discard: { tile: discTile(faceId), fromSeat: 2 }, ...extra });
  assert(!rules.getLegalActions(disc('dots-1', { seatWind: 'east' }), ronP).some((a) => a.type === ACTION_TYPE.WIN), 'Ron without a yaku → not offered');
  assert(rules.getLegalActions(disc('dots-1'), ronP).some((a) => a.type === ACTION_TYPE.WIN), 'the same Ron with a non-valuable pair is Pinfu → offered (Task 83)');
  const ron = rules.getLegalActions(disc('dots-1', { isRiichi: true }), ronP);
  assert(ron.length === 1 && ron[0].type === ACTION_TYPE.WIN && ron[0].winType === WIN_SOURCE.DISCARD && ron[0].fromSeat === 2 && ron[0].tile.id === 'dots-1', 'riichi Ron offered (and no calls)');
  assert(rules.getLegalActions(disc('dots-4', { isRiichi: true, wallRemaining: 0 }), ronP).some((a) => a.type === ACTION_TYPE.WIN), 'Ron on the final discard');
  assert(!rules.getLegalActions(disc('dots-1', { isRiichi: true, ownDiscards: ['dots-4'] }), ronP).some((a) => a.type === ACTION_TYPE.WIN), 'furiten from state.ownDiscards blocks Ron');
  assert(!rules.getLegalActions(disc('dots-1', { isRiichi: true, isTemporaryFuriten: true }), ronP).length, 'temporary furiten from state blocks Ron');
  assert(ronP.getHand().concealedTiles.length === 13, 'Ron check never adds the tile to the real hand');

  // Furiten from a real PlayerManager's own pile — a claimed discard still counts.
  const pm = new PlayerManager({ seatIndex: 1, seatKind: SEAT_KIND.AI, aiDifficulty: 'basic' });
  for (const t of tiles('23d 456b 789b 123c EE', makeTileFactory())) pm.addTileToHand(t);
  const entry = pm.getDiscardPile().discard(discTile('dots-4'));
  entry.markClaimed(3, 'pon');
  assert(!rules.getLegalActions(disc('dots-1', { isRiichi: true }), pm).some((a) => a.type === ACTION_TYPE.WIN), 'own pile read from the PlayerManager; a claimed 4d still makes 1d furiten');
});

// ---------------------------------------------------------------------------
section('6. Robbing a Kan (chankan)', () => {
  const p = player('23d 456b 789b 123c EE');
  const rob = (faceId, robbedKong, extra = {}) => ({ kind: 'discard', seatIndex: 1, playerCount: 4, wallRemaining: 30, isRiichi: true, discard: { tile: discTile(faceId), fromSeat: 0, robbedKong }, ...extra });
  const added = rules.getLegalActions(rob('dots-1', KONG_TYPE.ADDED), p);
  assert(added.length === 1 && added[0].type === ACTION_TYPE.WIN, 'a tile added to a Pon can be robbed (Ron)');
  let ctxSeen = null;
  new RiichiRules({ yakuProvider: (i) => { ctxSeen = i.context; return detectYaku(i); } }).getLegalActions(rob('dots-1', KONG_TYPE.ADDED), p);
  assert(ctxSeen.isChankan === true && ctxSeen.robbedKongType === 'added', 'chankan flags reach the yaku provider (the Chankan yaku is Task 84)');
  const callable = player('55d 23d 789b 123c EE S');
  assert(rules.getLegalActions(rob('dots-5', KONG_TYPE.ADDED, { isRiichi: false }), callable).length === 0, 'a Kan tile can never be called (no Pon / Chi)');
  assert(!rules.getLegalActions(rob('dots-1', KONG_TYPE.CONCEALED), p).length, 'an ordinary hand cannot rob a closed Kan');
  const k = player('19d 19b 19c ESWNRG 9c');
  const kc = rules.getLegalActions(rob('dragon-white', KONG_TYPE.CONCEALED), k);
  assert(kc.length === 1 && kc[0].validation.structure === 'thirteen-orphans', 'Thirteen Orphans may rob a closed Kan');
  assert(!new RiichiRules({ kokushiRobsConcealedKong: false }).getLegalActions(rob('dragon-white', KONG_TYPE.CONCEALED), k).length, '…unless kokushiRobsConcealedKong is false');
  assertThrows(() => rules.getLegalActions(rob('dots-1', 'exposed'), p), TypeError, 'robbedKong must be added or concealed');
});

summary();

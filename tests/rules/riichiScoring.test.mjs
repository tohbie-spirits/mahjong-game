/**
 * riichiScoring.test.mjs — Task 85: Riichi han / fu scoring.
 *
 * Checked against the standard Riichi score table (non-dealer unless noted).
 *
 * Sections:
 *   1. basePoints — the fu × 2^(han+2) formula and every limit; kazoe and
 *      kiriage options; validation
 *   2. winPayments — Ron (dealer ×6 / non-dealer ×4), Tsumo splits, rounding
 *      up to 100, three-player Tsumo loss
 *   3. Fu through scoreHand — Pinfu Tsumo 20, Pinfu Ron 30, Seven Pairs 25,
 *      closed Ron +10, Tsumo +2, Pungs and Kans (open / closed / terminal),
 *      wind / dragon pairs (double wind 4 or 2), waits, open 20 → 30, rounding
 *   4. scoreHand — complete score tables for real hands, dora, yakuman,
 *      best reading by points (tanki vs ryanmen), invalid wins, result shape
 *
 * Run: node tests/rules/riichiScoring.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand, makeTileFactory } from '../_helpers/tiles.mjs';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { basePoints, winPayments, LIMIT } from '../../src/rules/riichi/RiichiScoring.js';
import { MELD_TYPE, WIN_SOURCE, WIND } from '../../src/utils/constants.js';

const R = new RiichiRules();
const chi = (spec) => ({ type: MELD_TYPE.CHI, spec });
const kan = (spec, concealed = false) => ({ type: MELD_TYPE.KONG, spec, concealed });
const SOUTH = { seatWind: 'south', roundWind: 'east' };

function score(spec, winFace, { melds = [], tsumo = false, ctx = {}, rules = R } = {}) {
  const h = hand(spec, melds, makeTileFactory());
  const winningTile = h.concealedTiles.filter((t) => t.id === winFace).pop();
  return rules.scoreHand(h, { winType: tsumo ? WIN_SOURCE.SELF : WIN_SOURCE.DISCARD, winningTile, ...SOUTH, ...ctx });
}
const show = (s) => `${s.han}han ${s.fu}fu → ${JSON.stringify(s.payments)}`;

// ---------------------------------------------------------------------------
section('1. basePoints', () => {
  assert(basePoints(1, 30).basePoints === 240 && basePoints(1, 30).limit === null, '1 han 30 fu → 240');
  assert(basePoints(3, 30).basePoints === 960, '3 han 30 fu → 960');
  assert(basePoints(4, 30).basePoints === 1920, '4 han 30 fu → 1920 (no kiriage)');
  assert(basePoints(4, 30, 0, { kiriageMangan: true }).basePoints === 2000, '…2000 with kiriageMangan');
  assert(basePoints(3, 60, 0, { kiriageMangan: true }).limit === LIMIT.MANGAN, '3 han 60 fu → Mangan with kiriage');
  assert(basePoints(4, 40).basePoints === 2000 && basePoints(4, 40).limit === LIMIT.MANGAN, '4 han 40 fu → capped at Mangan');
  assert(basePoints(3, 70).basePoints === 2000, '3 han 70 fu → capped at Mangan');
  const table = [[5, 2000, 'mangan'], [6, 3000, 'haneman'], [7, 3000, 'haneman'], [8, 4000, 'baiman'], [10, 4000, 'baiman'], [11, 6000, 'sanbaiman'], [12, 6000, 'sanbaiman'], [13, 8000, 'kazoe-yakuman'], [20, 8000, 'kazoe-yakuman']];
  assert(table.every(([h, b, l]) => basePoints(h, 30).basePoints === b && basePoints(h, 30).limit === l), 'limits: 5 Mangan · 6–7 Haneman · 8–10 Baiman · 11–12 Sanbaiman · 13+ counted yakuman');
  assert(basePoints(13, 30, 0, { kazoeYakuman: false }).basePoints === 6000, 'kazoeYakuman:false → 13 han is Sanbaiman');
  assert(basePoints(0, 0, 1).basePoints === 8000 && basePoints(0, 0, 2).basePoints === 16000 && basePoints(0, 0, 1).limit === LIMIT.YAKUMAN, 'yakuman 8000 each');
  assertThrows(() => basePoints(-1, 30), TypeError, 'negative han throws');
  assertThrows(() => basePoints(1, 30.5), TypeError, 'fractional fu throws');
});

// ---------------------------------------------------------------------------
section('2. winPayments', () => {
  const ron = (b, d) => winPayments(b, { winType: WIN_SOURCE.DISCARD, isDealer: d }).ron;
  assert(ron(240, false) === 1000 && ron(240, true) === 1500, '1 han 30 fu Ron: 1000 / dealer 1500');
  assert(ron(480, false) === 2000 && ron(480, true) === 2900, '2 han 30 fu Ron: 2000 / dealer 2900 (2880 rounded up)');
  assert(ron(2000, false) === 8000 && ron(2000, true) === 12000, 'Mangan Ron 8000 / 12000');
  const t = winPayments(640, { winType: WIN_SOURCE.SELF, isDealer: false });
  assert(t.dealer === 1300 && t.nonDealer === 700 && t.total === 2700, '3 han 20 fu Tsumo: 700 / 1300 (total 2700)');
  const td = winPayments(640, { winType: WIN_SOURCE.SELF, isDealer: true });
  assert(td.nonDealer === 1300 && td.total === 3900, 'dealer 3 han 20 fu Tsumo: 1300 all (3900)');
  const t3 = winPayments(2000, { winType: WIN_SOURCE.SELF, isDealer: false, playerCount: 3 });
  assert(t3.dealer === 4000 && t3.nonDealer === 2000 && t3.total === 6000, 'three-player Mangan Tsumo: one payer fewer (6000, "tsumo loss")');
  const t3d = winPayments(2000, { winType: WIN_SOURCE.SELF, isDealer: true, playerCount: 3 });
  assert(t3d.total === 8000, 'three-player dealer Mangan Tsumo: 4000 × 2');
});

// ---------------------------------------------------------------------------
section('3. Fu', () => {
  const pt = score('234d 345b 567c 678c 88d', 'dots-2', { tsumo: true });
  assert(pt.fu === 20 && pt.han === 3 && pt.payments.dealer === 1300 && pt.payments.nonDealer === 700, `Pinfu Tsumo 20 fu: Pinfu + Tanyao + Tsumo (${show(pt)})`);
  const pr = score('234d 345b 567c 678c 88d', 'dots-2');
  assert(pr.fu === 30 && pr.han === 2 && pr.points === 2000, `Pinfu Ron 30 fu (20 + 10 closed Ron): 2000 (${show(pr)})`);
  const prd = score('234d 345b 567c 678c 88d', 'dots-2', { ctx: { seatWind: 'east' } });
  assert(prd.isDealer && prd.points === 2900, 'the same as dealer (East seat): 2900');
  const sp = score('22d 33d 55d 77b 88b 44c 66c', 'characters-6');
  assert(sp.fu === 25 && sp.han === 3 && sp.points === 3200, `Seven Pairs 25 fu, never rounded: Chiitoitsu + Tanyao 3 han → 3200 (${show(sp)})`);
  const k = score('111d 456b 789b 13c EE 2c', 'characters-2', { ctx: { isRiichi: true } });
  assert(k.fu === 50 && k.points === 1600, `20 + 10 closed Ron + 8 closed terminal Pung + 2 kanchan + 2 East (round) pair = 42 → 50: Riichi 1 han → 1600 (${show(k)})`);
  const ts = score('234d 345b 567c 678c 88d', 'dots-3', { tsumo: true });
  assert(ts.fu === 30 && ts.han === 2 && ts.payments.dealer === 1000 && ts.payments.nonDealer === 500, `20 + 2 Tsumo + 2 kanchan = 24 → 30: Tsumo + Tanyao 500 / 1000 (${show(ts)})`);
  const op = score('234d 345b 678c 88d', 'dots-2', { melds: [chi('567c')] });
  assert(op.fu === 30 && op.fuBreakdown.some((f) => f.id === 'open-pinfu-minimum') && op.points === 1000, `open hand worth 20 fu is raised to 30: Tanyao 1000 (${show(op)})`);
  const kn = score('456b 789b 123c EE', 'characters-1', { melds: [kan('1111d', true)], tsumo: true, ctx: { isRiichi: true } });
  assert(kn.fu === 60 && kn.payments.dealer === 2000 && kn.payments.nonDealer === 1000, `closed terminal Kan 32: 20 + 2 + 32 + 2 East pair = 56 → 60; Riichi + Tsumo → 1000 / 2000 (${show(kn)})`);
  const okn = score('456b 789b 123c EE', 'characters-1', { melds: [kan('5555d')], ctx: { roundWind: 'south', seatWind: 'west' } });
  assert(okn.valid === undefined && okn.meetsMinimum === false, 'open Kan, no yaku → not a win');
  const pairs = (seat, round, rules = R) => score('234d 456b 678b 345c EE', 'dots-2', { ctx: { isRiichi: true, seatWind: seat, roundWind: round }, rules }).fuBreakdown.filter((f) => f.id.includes('pair'));
  assert(pairs('east', 'east')[0].fu === 4 && pairs('east', 'east', new RiichiRules({ doubleWindPairFu: 2 }))[0].fu === 2, 'double-wind pair: 4 fu (option: 2)');
  assert(pairs('east', 'south')[0].fu === 2 && pairs('west', 'south').length === 0, 'seat-wind pair 2; a guest wind pair 0');
  const dragonPair = score('234d 456b 678b 345c RR', 'dots-2', { ctx: { isRiichi: true } });
  assert(dragonPair.fuBreakdown.some((f) => f.id === 'dragon-pair' && f.fu === 2), 'dragon pair 2 fu');
  const openPung = score('234d 456b 678b 55c', 'dots-2', { melds: [{ type: MELD_TYPE.PON, spec: 'RRR' }] });
  assert(openPung.fuBreakdown.some((f) => f.id === 'triplet-open' && f.fu === 4), 'open honour Pung 4 fu');
  assertThrows(() => new RiichiRules({ doubleWindPairFu: 3 }), RangeError, 'doubleWindPairFu must be 2 or 4');
  assertThrows(() => new RiichiRules({ kazoeYakuman: 1 }), TypeError, 'kazoeYakuman must be boolean');
});

// ---------------------------------------------------------------------------
section('4. scoreHand', () => {
  const dora = score('234d 345b 567c 678c 88d', 'dots-2', { ctx: { dora: { dora: 2, akaDora: 1, uraDora: 1 } } });
  assert(dora.han === 6 && dora.limit === LIMIT.HANEMAN && dora.points === 12000, `Pinfu + Tanyao + 4 dora = 6 han → Haneman 12000 (${show(dora)})`);
  assert(dora.breakdown.filter((b) => b.isDora).map((b) => `${b.id}:${b.han}`).join() === 'dora:2,akaDora:1,uraDora:1', 'dora listed separately in the breakdown');
  const noYaku = score('123d 456b 789b 123c EE', 'dots-1', { ctx: { seatWind: 'east', dora: { dora: 3 } } });
  assert(!noYaku.meetsMinimum && noYaku.points === 0 && noYaku.reason === 'no-yaku', 'dora alone never make a win');
  const ds = score('123d RRR GGG HHH 99b', 'bamboo-9');
  assert(ds.yakuman === 1 && ds.limit === LIMIT.YAKUMAN && ds.points === 32000 && ds.fu === 0, 'Daisangen Ron: 32000');
  const dsd = score('123d RRR GGG HHH 99b', 'bamboo-9', { ctx: { seatWind: 'east' } });
  assert(dsd.points === 48000, 'dealer yakuman: 48000');
  const dbl = score('EEE SSS WWW NNN 99d', 'dots-9');
  assert(dbl.yakuman === 4 && dbl.points === 128000, 'Daisuushii + Suuankou tanki (4×) → 128000');
  const ymDora = score('123d RRR GGG HHH 99b', 'bamboo-9', { ctx: { dora: { dora: 5 } } });
  assert(ymDora.points === 32000 && ymDora.han === 13 && !ymDora.breakdown.some((b) => b.isDora), 'dora never add to a yakuman (han stays 13)');
  const kazoe = score('123d 456d 789d 234d 99d', 'dots-9', { ctx: { isRiichi: true, dora: { dora: 4 } } });
  assert(kazoe.han === 14 && kazoe.limit === LIMIT.KAZOE_YAKUMAN && kazoe.points === 32000, `Chinitsu 6 + Ittsu 2 + Pinfu 1 (78 + 9 reading) + Riichi 1 + 4 dora = 14 → counted yakuman (${show(kazoe)})`);
  // Best reading by POINTS. 23 44 + 4 reads as ryanmen (234 + 44) or tanki (234 + 4·4).
  // With three closed Pungs (8 + 8 + 4): ryanmen 20+10+20 = 50 fu, tanki 52 → 60 fu; same 3 han (Riichi + Sanankou).
  const best = score('234d 44d 111b 999c 555c', 'dots-4', { ctx: { isRiichi: true } });
  assert(best.han === 3 && best.fu === 60 && best.interpretation.wait === 'tanki' && best.points === 7700, `same han: the tanki reading (60 fu, 7700) beats ryanmen (50 fu, 6400) (${show(best)})`);
  // All runs: ryanmen gives Pinfu (2 han 30 fu = 2000) vs tanki (1 han 40 fu = 1300) → points pick the Pinfu reading.
  const pin = score('234d 44d 456b 789c 123c', 'dots-4', { ctx: { isRiichi: true } });
  assert(pin.han === 2 && pin.fu === 30 && pin.interpretation.wait === 'ryanmen' && pin.points === 2000, `more points wins even with fewer fu: Pinfu reading 2000 over tanki 1300 (${show(pin)})`);
  // Ron 111222333 on 3: Pung reading 4 han (Sanankou + Toitoi) vs runs 3 han — points pick the Pungs.
  const reading = score('111222333d 999b EE', 'dots-3');
  assert(reading.han === 4 && reading.breakdown.map((b) => b.id).sort().join() === 'sanankou,toitoi', 'more han → that reading');
  const shape = score('234d 345b 567c 678c 88d', 'dots-2');
  assert(['han', 'fu', 'yakuman', 'basePoints', 'limit', 'points', 'payments', 'meetsMinimum', 'isLimit', 'structure', 'breakdown', 'fuBreakdown', 'interpretation', 'isDealer', 'validation'].every((k) => k in shape), 'result shape');
  assert(shape.fan === shape.han && shape.minimumFan === 1 && shape.isLimit === false, 'HK-compatible fields: fan = han, minimumFan 1');
  const p3 = score('234d 345b 567c 678c 88d', 'dots-2', { tsumo: true, rules: new RiichiRules({ playerCount: 3 }) });
  assert(p3.points === 2000, 'three-player Pinfu Tsumo 700/1300 with one payer fewer → 2000');
  // Found by search: 22223456667d EEE won on 2d — the FIRST reading is a shanpon (Ron makes that Pung open: 40 fu),
  // a later one ryanmen (50 fu). With a flat 1-han provider the later reading must win on points…
  const flat = (han) => new RiichiRules({ yakuProvider: () => [{ id: 'x', name: 'X', han }] });
  const later = score('22223456667d EEE', 'dots-2', { rules: flat(1) });
  assert(later.fu === 50 && later.points === 1600, `a later reading worth more points is chosen (${show(later)})`);
  // …and at 4 han both readings cap at Mangan, so the tiebreak picks the one with more fu.
  const capped = score('22223456667d EEE', 'dots-2', { rules: flat(4) });
  assert(capped.limit === LIMIT.MANGAN && capped.fu === 50, 'equal points and han: more fu breaks the tie');
  const custom = new RiichiRules({ yakuProvider: () => [{ id: 'x', name: 'X', han: 2 }] });
  const c = score('234d 345b 678c 88d', 'dots-2', { melds: [chi('567c')], rules: custom });
  assert(c.han === 2 && c.fu === 30 && c.points === 2000, 'a custom yaku provider is scored too');
  assertThrows(() => R.scoreHand(hand('123d 456d 789d 123b 99c', [], makeTileFactory()), {}), TypeError, 'scoreHand needs winType + winningTile');
});

summary();

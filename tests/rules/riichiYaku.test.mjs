/**
 * riichiYaku.test.mjs — Task 83: common Riichi yaku.
 *
 * Every case runs through RiichiRules#validateWin (the real pipeline:
 * interpretations → yaku provider), mostly as Ron so Menzen Tsumo doesn't
 * appear unless wanted. Expected yaku are written "id:han", sorted.
 *
 * Sections:
 *   1. 1-han yaku — Tanyao (closed / open / openTanyao:false), Pinfu (wait and
 *      pair rules), Iipeikou, Yakuhai (dragons, seat, round, double wind)
 *   2. 2-han yaku — Chanta, Ittsu, Sanshoku Doujun / Doukou, Toitoi,
 *      Sanankou (Ron-completed Pung counts open), Sankantsu, Chiitoitsu,
 *      Honroutou, Shousangen
 *   3. 3+ han — Honitsu, Junchan, Ryanpeikou, Chinitsu (open values)
 *   4. One reading per win — best interpretation chosen, yaku never mixed
 *      across readings; evaluateYaku ranking; exclusions
 *   5. Not yet (Task 84) — Thirteen Orphans / four concealed Pungs give no
 *      yakuman yet; options validation
 *
 * Run: node tests/rules/riichiYaku.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand, makeTileFactory } from '../_helpers/tiles.mjs';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { evaluateYaku, detectYaku, RIICHI_YAKU } from '../../src/rules/riichi/RiichiYaku.js';
import { MELD_TYPE, WIN_SOURCE, WIND } from '../../src/utils/constants.js';

const R = new RiichiRules();
const chi = (spec) => ({ type: MELD_TYPE.CHI, spec });
const pon = (spec) => ({ type: MELD_TYPE.PON, spec });
const kan = (spec, concealed = false) => ({ type: MELD_TYPE.KONG, spec, concealed });

function validate(spec, winFace, { melds = [], tsumo = false, ctx = {}, rules = R } = {}) {
  const h = hand(spec, melds, makeTileFactory());
  const winningTile = h.concealedTiles.filter((t) => t.id === winFace).pop();
  return rules.validateWin(h, { winType: tsumo ? WIN_SOURCE.SELF : WIN_SOURCE.DISCARD, winningTile, ...ctx });
}
const yakuOf = (spec, winFace, opts) => validate(spec, winFace, opts).yaku.map((y) => `${y.id}:${y.han}`).sort().join(' ');
const expectYaku = (spec, winFace, expected, msg, opts) => {
  const got = yakuOf(spec, winFace, opts);
  assert(got === expected, `${msg} → ${expected || '(none)'}${got === expected ? '' : ` — got ${got || '(none)'}`}`);
};

// ---------------------------------------------------------------------------
section('1. 1-han yaku', () => {
  assert(Object.keys(RIICHI_YAKU).length === 30 && Object.values(RIICHI_YAKU).every(Object.isFrozen), '30 ordinary yaku in the table (2 from Task 82 + 22 from Task 83 + 6 situational from Task 84)');
  // Tanyao
  expectYaku('222d 345b 567c 678c 88d', 'dots-2', 'tanyao:1', 'all simples, shanpon Ron');
  expectYaku('222d 567c 678c 88d', 'dots-8', 'tanyao:1', 'open All Simples (kuitan, default on)', { melds: [chi('345b')] });
  expectYaku('222d 567c 678c 88d', 'dots-8', '', 'openTanyao:false → no yaku', { melds: [chi('345b')], rules: new RiichiRules({ openTanyao: false }) });
  expectYaku('222d 345b 567c 678c 99d', 'dots-2', '', 'a terminal pair spoils All Simples');
  // Pinfu
  expectYaku('234d 345b 567c 678c 88d', 'dots-2', 'pinfu:1 tanyao:1', 'four runs, ryanmen (34 + 2), plain pair');
  expectYaku('234d 345b 567c 678c 88d', 'dots-3', 'tanyao:1', 'kanchan (24 + 3) → no Pinfu');
  expectYaku('123d 345b 567c 678c 88d', 'dots-3', '', 'penchan (12 + 3) → no Pinfu (and a terminal → no Tanyao)');
  assert(validate('123d 456b 789b 123c RR', 'dots-1').reason === 'no-yaku', 'a dragon pair → no Pinfu');
  expectYaku('123d 456b 789b 123c EE', 'dots-1', '', 'East pair with East seat → no Pinfu', { ctx: { seatWind: 'east' } });
  expectYaku('123d 456b 789b 123c EE', 'dots-1', '', 'East pair in the East round → no Pinfu', { ctx: { roundWind: WIND.EAST } });
  expectYaku('123d 456b 789b 123c EE', 'dots-1', 'pinfu:1', 'East pair, South seat + South round → Pinfu', { ctx: { seatWind: WIND.SOUTH, roundWind: WIND.SOUTH } });
  expectYaku('123d 456b 789b 123c EE', 'dots-1', 'menzen-tsumo:1 pinfu:1', 'Pinfu by Tsumo', { tsumo: true });
  expectYaku('234d 345b 678c 88d', 'dots-2', 'tanyao:1', 'an open hand never has Pinfu', { melds: [chi('567c')] });
  expectYaku('234d 345c 567c 88d', 'dots-2', 'tanyao:1', 'a closed Kan keeps the hand closed but breaks Pinfu (four runs needed)', { melds: [kan('2222b', true)] });
  // Iipeikou
  expectYaku('223344d 567b 678c 99c', 'dots-2', 'iipeikou:1 pinfu:1', 'two identical runs 234 234');
  assert(validate('223344d 567b 99c', 'dots-2', { melds: [chi('678c')] }).reason === 'no-yaku', 'open → no Iipeikou');
  // Yakuhai
  expectYaku('123d 456b 789b RRR 55c', 'characters-5', 'yakuhai-red:1', 'Red dragon Pung');
  expectYaku('123d 456b 789b GGG 55c', 'characters-5', 'yakuhai-green:1', 'Green dragon Pung');
  expectYaku('123d 456b 789b HHH 55c', 'characters-5', 'yakuhai-white:1', 'White dragon Pung');
  expectYaku('123d 456b 789b SSS 55c', 'characters-5', 'seat-wind:1', 'seat wind Pung', { ctx: { seatWind: 'south', roundWind: 'east' } });
  expectYaku('123d 456b 789b EEE 55c', 'characters-5', 'round-wind:1', 'round wind Pung', { ctx: { seatWind: 'south', roundWind: 'east' } });
  expectYaku('123d 456b 789b EEE 55c', 'characters-5', 'round-wind:1 seat-wind:1', 'double East (dealer in the East round) → 2', { ctx: { seatWind: WIND.EAST, roundWind: WIND.EAST } });
  expectYaku('123d 456b 789b NNN 55c', 'characters-5', '', 'a guest wind Pung is worth nothing', { ctx: { seatWind: 'south', roundWind: 'east' } });
  expectYaku('123d 456b 789b 55c', 'characters-5', 'yakuhai-red:1', 'an open dragon Pung still counts', { melds: [pon('RRR')] });
  expectYaku('123d 456b 789b 55c', 'characters-5', 'yakuhai-red:1', 'a dragon Kan counts', { melds: [kan('RRRR')] });
});

// ---------------------------------------------------------------------------
section('2. 2-han yaku', () => {
  expectYaku('123d 789b 123c EEE 99d', 'dots-9', 'chanta:2', 'Chanta: every set has a terminal or honour, with an honour and a run');
  expectYaku('123d 789b EEE 99d', 'dots-9', 'chanta:1', 'open Chanta → 1', { melds: [chi('123c')] });
  expectYaku('123456789d 456b EE', 'dots-1', 'ittsu:2 pinfu:1', 'Ittsu 123 456 789 (+ Pinfu: 23 + 1)');
  expectYaku('456789d 456b EE', 'dots-4', 'ittsu:1', 'open Ittsu → 1', { melds: [chi('123d')] });
  expectYaku('234d 234b 234c 678d 99b', 'bamboo-9', 'sanshoku-doujun:2', 'Sanshoku: 234 in all three suits');
  expectYaku('234d 234b 678d 99b', 'bamboo-9', 'sanshoku-doujun:1', 'open Sanshoku → 1', { melds: [chi('234c')] });
  expectYaku('555d 555b 555c 77d 22b 7d', 'dots-7', 'sanankou:2 sanshoku-doukou:2 tanyao:1 toitoi:2', 'Ron on a shanpon: 777 open → three concealed Pungs (Sanankou), Triple Triplets, Toitoi, Tanyao');
  expectYaku('222d 444c 99d 888c', 'characters-8', 'sanankou:2 toitoi:2', 'open Toitoi with three concealed Pungs (Tsumo keeps 888 concealed)', { melds: [pon('777b')], tsumo: true });
  expectYaku('222d 444c 99d 888c', 'characters-8', 'toitoi:2', 'same by Ron: 888 is open → only two concealed → no Sanankou', { melds: [pon('777b')] });
  expectYaku('567d 88b', 'dots-5', 'sankantsu:2 tanyao:1', 'three Kans (two open, one closed)', { melds: [kan('2222d'), kan('3333b'), kan('4444c', true)] });
  expectYaku('11d 33d 55d 77b 99b EE RR', 'dragon-red', 'chiitoitsu:2', 'Seven Pairs by Ron');
  expectYaku('11d 33d 55d 77b 99b EE RR', 'dragon-red', 'chiitoitsu:2 menzen-tsumo:1', 'Seven Pairs by Tsumo', { tsumo: true });
  expectYaku('22d 33d 55d 77b 88b 44c 66c', 'characters-6', 'chiitoitsu:2 tanyao:1', 'Seven Pairs + All Simples');
  expectYaku('111d 999b EEE NN 11c N', 'wind-north', 'honroutou:2 sanankou:2 toitoi:2', 'Honroutou (all terminals/honours) + Toitoi + Sanankou (Ron-completed NNN is open)');
  expectYaku('11d 99d 11b 99b EE SS NN', 'wind-north', 'chiitoitsu:2 honroutou:2', 'Honroutou as Seven Pairs');
  expectYaku('123d 456b RRR GGG HH', 'dragon-white', 'shousangen:2 yakuhai-green:1 yakuhai-red:1', 'Shousangen: two dragon Pungs + a dragon pair (+ their Yakuhai)');
});

// ---------------------------------------------------------------------------
section('3. 3-han and 6-han yaku', () => {
  expectYaku('123d 456d 777d EEE 99d', 'dots-9', 'honitsu:3', 'Honitsu: one suit + honours');
  expectYaku('123d 456d 777d 99d', 'dots-9', 'honitsu:2', 'open Honitsu → 2', { melds: [pon('EEE')] });
  expectYaku('123d 789b 123c 999b 11d', 'dots-1', 'junchan:3', 'Junchan: a terminal in every set, no honours (replaces Chanta)');
  expectYaku('123d 789b 999b 11d', 'dots-1', 'junchan:2', 'open Junchan → 2', { melds: [chi('123c')] });
  expectYaku('223344d 667788b 99c', 'characters-9', 'ryanpeikou:3', 'Ryanpeikou beats the Seven Pairs reading (3 > 2) and replaces Iipeikou');
  expectYaku('123d 456d 777d 234d 99d', 'dots-9', 'chinitsu:6', 'Chinitsu: one suit, no honours (replaces Honitsu)');
  expectYaku('456d 777d 234d 99d', 'dots-9', 'chinitsu:5', 'open Chinitsu → 5', { melds: [chi('123d')] });
});

// ---------------------------------------------------------------------------
section('4. One reading per win', () => {
  // 111222333d won on 3d: as three Pungs (shanpon) or three 1-2-3 runs (penchan).
  expectYaku('111222333d 456b EE', 'dots-3', 'iipeikou:1', 'Ron: the run reading (Iipeikou) beats the Pung reading (Ron-completed 333 is open → only two concealed Pungs, nothing)');
  expectYaku('111222333d 456b EE', 'dots-3', 'menzen-tsumo:1 sanankou:2', 'Tsumo: the Pung reading (Sanankou 2 + Tsumo) beats runs (Iipeikou 1 + Tsumo) — and the two are never mixed', { tsumo: true });
  const h = hand('111222333d 456b EE', [], makeTileFactory());
  const winningTile = h.concealedTiles.filter((t) => t.id === 'dots-3').pop();
  const v = R.validateWin(h, { winType: WIN_SOURCE.SELF, winningTile });
  const ranked = evaluateYaku({ hand: h, interpretations: v.interpretations, melds: v.melds, isClosed: true, winType: WIN_SOURCE.SELF, context: {} });
  assert(ranked.length === 2 && ranked[0].han === 3 && ranked[1].han === 2 && ranked[0].interpretation.wait === 'shanpon', 'evaluateYaku ranks every interpretation, best first');
  assert(detectYaku({ hand: h, interpretations: v.interpretations, melds: v.melds, isClosed: true, winType: WIN_SOURCE.SELF, context: {} }).map((y) => y.id).join() === ranked[0].yaku.map((y) => y.id).join(), 'detectYaku returns the best interpretation\'s yaku');
  expectYaku('234d 44d 456b 789c EEE', 'dots-4', '', 'two readings (ryanmen / tanki), neither has a yaku → refused');
  assert(evaluateYaku({}).length === 0 && detectYaku({ isClosed: true, winType: WIN_SOURCE.SELF }).length === 0, 'no interpretations → no yaku');
  // Exclusions
  assert(!yakuOf('223344d 667788b 99c', 'characters-9').includes('iipeikou'), 'Ryanpeikou excludes Iipeikou');
  assert(!yakuOf('123d 789b 123c 999b 11d', 'dots-1').includes('chanta'), 'Junchan excludes Chanta');
  assert(!yakuOf('123d 456d 777d 234d 99d', 'dots-9').includes('honitsu'), 'Chinitsu excludes Honitsu');
  assert(!yakuOf('111d 999b EEE NN 11c N', 'wind-north').includes('chanta'), 'Honroutou (no runs) never also scores Chanta');
});

// ---------------------------------------------------------------------------
section('5. Superseded by Task 84 + options', () => {
  expectYaku('19d 19b 19c ESWNRGH 9c', 'characters-9', 'kokushi-13:26', 'Thirteen Orphans is a yakuman now (13-sided → double) — see riichiYakuman.test.mjs', { tsumo: true });
  expectYaku('111d 333b 555c 77d 99b 9b', 'bamboo-9', 'suuankou:13', 'four concealed Pungs is Suuankou now — and never also Sanankou', { tsumo: true });
  assertThrows(() => new RiichiRules({ openTanyao: 'yes' }), TypeError, 'openTanyao must be boolean');
  assert(R.getOptions().openTanyao === true, 'openTanyao defaults to true');
});

summary();

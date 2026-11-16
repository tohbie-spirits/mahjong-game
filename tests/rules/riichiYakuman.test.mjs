/**
 * riichiYakuman.test.mjs — Task 84: situational yaku and yakuman.
 *
 * Every case runs through RiichiRules#validateWin. Expected yaku "id:han",
 * sorted; a yakuman's han is 13 × its multiplier (26 = double).
 *
 * Sections:
 *   1. Situational yaku — Ippatsu, Double Riichi, Haitei, Houtei, Rinshan,
 *      Chankan, and their exclusions
 *   2. Hand yakuman — Kokushi (single / 13-sided), Suuankou (shanpon
 *      Tsumo vs Ron, tanki, with a closed Kan), Daisangen, Shousuushii,
 *      Daisuushii, Tsuuiisou (incl. Seven Pairs), Chinroutou, Ryuuiisou,
 *      Chuuren (normal / pure), Suukantsu
 *   3. Tenhou / Chiihou
 *   4. Combination rules — yakuman replace ordinary yaku, stack with each
 *      other, beat non-yakuman readings; doubleYakuman:false; the
 *      `yakuman` field; open hands never get closed-only yakuman
 *
 * Run: node tests/rules/riichiYakuman.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand, makeTileFactory } from '../_helpers/tiles.mjs';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { RIICHI_YAKUMAN, DOUBLE_YAKUMAN, evaluateYaku } from '../../src/rules/riichi/RiichiYaku.js';
import { MELD_TYPE, WIN_SOURCE } from '../../src/utils/constants.js';

const R = new RiichiRules();
const SINGLE = new RiichiRules({ doubleYakuman: false });
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
// A plain closed hand whose East pair (with East as seat wind) rules out Pinfu.
const PLAIN = '123d 456b 789b 123c EE';
const EAST = { seatWind: 'east' };

// ---------------------------------------------------------------------------
section('1. Situational yaku', () => {
  expectYaku(PLAIN, 'dots-1', 'ippatsu:1 riichi:1', 'Ippatsu (Ron within the riichi go-around)', { ctx: { ...EAST, isRiichi: true, isIppatsu: true } });
  expectYaku(PLAIN, 'dots-1', 'menzen-tsumo:1', 'the ippatsu flag without riichi does nothing', { tsumo: true, ctx: { ...EAST, isIppatsu: true } });
  expectYaku(PLAIN, 'dots-1', 'double-riichi:2', 'Double Riichi replaces Riichi', { ctx: { ...EAST, isRiichi: true, isDoubleRiichi: true } });
  expectYaku(PLAIN, 'dots-1', 'double-riichi:2 ippatsu:1', 'Double Riichi + Ippatsu', { ctx: { ...EAST, isRiichi: true, isDoubleRiichi: true, isIppatsu: true } });
  expectYaku(PLAIN, 'dots-1', 'haitei:1 menzen-tsumo:1', 'Haitei: Tsumo on the last tile', { tsumo: true, ctx: { ...EAST, isLastTile: true } });
  expectYaku('123d 456b 123c EE', 'dots-1', 'haitei:1', 'Haitei is a yaku for an open hand too', { melds: [pon('777b')], tsumo: true, ctx: { ...EAST, isLastTile: true } });
  expectYaku('123d 456b 123c EE', 'dots-1', 'houtei:1', 'Houtei: Ron on the last discard (open hand)', { melds: [pon('777b')], ctx: { ...EAST, isLastTile: true } });
  expectYaku('123d 456b 123c EE', 'dots-1', 'menzen-tsumo:1 rinshan:1', 'Rinshan: Tsumo on a Kan replacement (closed Kan keeps it closed; no Pinfu)', { melds: [kan('2222b', true)], tsumo: true, ctx: { ...EAST, isKongReplacement: true } });
  expectYaku('123d 456b 123c EE', 'dots-1', 'menzen-tsumo:1 rinshan:1', 'Rinshan on the last tile is not also Haitei', { melds: [kan('2222b', true)], tsumo: true, ctx: { ...EAST, isKongReplacement: true, isLastTile: true } });
  expectYaku('123d 456b 123c EE', 'dots-1', 'chankan:1', 'Chankan: Ron on a robbed Kan (open hand)', { melds: [pon('777b')], ctx: { ...EAST, isChankan: true, robbedKongType: 'added' } });
  expectYaku('123d 456b 123c EE', 'dots-1', 'chankan:1', 'Chankan is never also Houtei', { melds: [pon('777b')], ctx: { ...EAST, isChankan: true, robbedKongType: 'added', isLastTile: true } });
  expectYaku('123d 456b 123c EE', 'dots-1', '', 'open hand Ron mid-hand: still no yaku', { melds: [pon('777b')], ctx: EAST });
});

// ---------------------------------------------------------------------------
section('2. Hand yakuman', () => {
  expectYaku('19d 19b 19c ESWNRG 9c H', 'dragon-white', 'kokushi:13', 'Thirteen Orphans won on the missing kind');
  expectYaku('19d 19b 19c ESWNRGH 9c', 'characters-9', 'kokushi-13:26', 'Thirteen Orphans 13-sided wait → double');
  expectYaku('19d 19b 19c ESWNRGH 9c', 'characters-9', 'kokushi-13:13', '…single with doubleYakuman:false', { rules: SINGLE });

  expectYaku('111d 333b 555c 77d 99b 9b', 'bamboo-9', 'suuankou:13', 'Suuankou: four concealed Pungs by Tsumo (shanpon)', { tsumo: true });
  expectYaku('111d 333b 555c 77d 99b 9b', 'bamboo-9', 'sanankou:2 toitoi:2', 'the same shanpon by Ron: 999 is open → Sanankou + Toitoi, not Suuankou');
  expectYaku('111d 333b 555c 777d 9b 9b', 'bamboo-9', 'suuankou-tanki:26', 'Suuankou on a single (pair) wait — Ron is fine → double');
  expectYaku('333b 555c 777d 9b 9b', 'bamboo-9', 'suuankou-tanki:26', 'a closed Kan counts as a concealed Pung', { melds: [kan('2222d', true)], tsumo: true });
  expectYaku('333b 555c 777d 9b 9b', 'bamboo-9', 'sanankou:2 toitoi:2', 'an OPEN Kan doesn\'t count → three concealed Pungs: Sanankou + Toitoi, no yakuman', { melds: [kan('2222d')] });

  expectYaku('123d RRR GGG HHH 99b', 'bamboo-9', 'daisangen:13', 'Daisangen: three dragon Pungs');
  expectYaku('123d GGG HHH 99b', 'bamboo-9', 'daisangen:13', 'Daisangen open', { melds: [pon('RRR')] });
  expectYaku('EEE SSS WWW NN 123d', 'dots-1', 'shousuushii:13', 'Shousuushii: three wind Pungs + a wind pair');
  expectYaku('SSS WWW NNN 99d', 'dots-9', 'daisuushii:26', 'Daisuushii (open East Pung) → double', { melds: [pon('EEE')] });
  expectYaku('EEE SSS WWW NNN 99d', 'dots-9', 'daisuushii:26 suuankou-tanki:26', 'closed Daisuushii on a single wait also Suuankou tanki → two double yakuman (4×)');

  expectYaku('SSS RRR GGG HH', 'dragon-white', 'tsuuiisou:13', 'Tsuuiisou: all honours (open East Pung)', { melds: [pon('EEE')] });
  expectYaku('EE SS WW NN RR GG HH', 'dragon-white', 'tsuuiisou:13', 'Tsuuiisou as Seven Pairs');
  expectYaku('999d 111b 999b 11c', 'characters-1', 'chinroutou:13', 'Chinroutou: terminals only (open 111d)', { melds: [pon('111d')] });
  expectYaku('234b 234b 666b 888b GG', 'dragon-green', 'ryuuiisou:13', 'Ryuuiisou: 2 3 4 6 8 bamboo + green dragon');
  expectYaku('234b 234b 666b 888b 55b', 'bamboo-5', 'chinitsu:6 iipeikou:1 tanyao:1', 'a 5 of bamboo is not green → no Ryuuiisou');
  expectYaku('11123455678999d', 'dots-1', 'chuuren:13', 'Nine Gates (the extra tile was already held)');
  expectYaku('11123455678999d', 'dots-5', 'junsei-chuuren:26', 'Pure Nine Gates: 1112345678999 waiting on all nine → double');
  expectYaku('11123455678999d', 'dots-5', 'junsei-chuuren:13', '…single with doubleYakuman:false', { rules: SINGLE });
  expectYaku('66b', 'bamboo-6', 'suukantsu:13', 'Suukantsu: four Kans', { melds: [kan('2222d'), kan('3333b'), kan('4444c'), kan('5555d', true)] });
});

// ---------------------------------------------------------------------------
section('3. Tenhou / Chiihou', () => {
  const first = { isFirstUninterruptedTurn: true };
  expectYaku(PLAIN, 'dots-1', 'tenhou:13', 'Tenhou: the dealer (East) wins on the first draw', { tsumo: true, ctx: { ...first, seatWind: 'east' } });
  expectYaku(PLAIN, 'dots-1', 'chiihou:13', 'Chiihou: a non-dealer wins on their first uninterrupted draw', { tsumo: true, ctx: { ...first, seatWind: 'south' } });
  expectYaku(PLAIN, 'dots-1', 'pinfu:1', 'never by Ron', { ctx: { ...first, seatWind: 'south' } });
  expectYaku(PLAIN, 'dots-1', 'menzen-tsumo:1', 'not without the first-turn flag', { tsumo: true, ctx: EAST });
  expectYaku('19d 19b 19c ESWNRGH 9c', 'characters-9', 'kokushi-13:26 tenhou:13', 'Tenhou + 13-sided Kokushi stack (3×)', { tsumo: true, ctx: { ...first, seatWind: 'east' } });
});

// ---------------------------------------------------------------------------
section('4. Combination rules', () => {
  // Yakuman replace ordinary yaku: a Tenhou that is also Riichi-less Pinfu + Tsumo reports only Tenhou.
  const t = validate(PLAIN, 'dots-1', { tsumo: true, ctx: { isFirstUninterruptedTurn: true, seatWind: 'east', isLastTile: true } });
  assert(t.valid && t.yaku.length === 1 && t.yaku[0].yakuman === 1, 'a yakuman replaces every ordinary yaku (Tsumo, Pinfu, Haitei dropped); yakuman field = 1');
  const d = validate('EEE SSS WWW NNN 99d', 'dots-9');
  assert(d.yaku.every((y) => y.yakuman === 2), 'double yakuman carry yakuman: 2');
  // 111222333d 999b EE: Pung reading (Suuankou by Tsumo) vs run reading (Iipeikou, Chanta).
  expectYaku('111222333d 999b EE', 'dots-3', 'suuankou:13', 'Tsumo: the yakuman reading beats the ordinary one', { tsumo: true });
  expectYaku('111222333d 999b EE', 'dots-3', 'sanankou:2 toitoi:2', 'Ron: 333 open → no yakuman; best ordinary reading (Sanankou + Toitoi 4 > runs: Iipeikou + Chanta 3)');
  // Tie at 13: the ordinary reading (Double Riichi, Ippatsu, Tsumo, Haitei, Iipeikou, Tanyao, Chinitsu = 13)
  // listed FIRST must still lose to the Suuankou reading (13, one yakuman).
  const h = hand('222333444d 666d 88d', [], makeTileFactory());
  const wt = h.concealedTiles.filter((x) => x.id === 'dots-4').pop();
  const ctx = { winType: WIN_SOURCE.SELF, winningTile: wt, isRiichi: true, isDoubleRiichi: true, isIppatsu: true, isLastTile: true, seatWind: 'south' };
  const v = R.validateWin(h, ctx);
  const reversed = v.interpretations.slice().reverse();
  const ranked = evaluateYaku({ hand: h, interpretations: reversed, melds: [], isClosed: true, winType: WIN_SOURCE.SELF, winningTile: wt, context: ctx, options: {} });
  assert(ranked.length === 2 && ranked[1].han === 13 && ranked[1].yakuman === 0, 'the ordinary reading also reaches 13 han');
  assert(ranked[0].yaku.map((y) => y.id).join() === 'suuankou', 'a yakuman reading beats an ordinary reading with equal han, whatever the order');
  assert(Object.keys(RIICHI_YAKUMAN).length === 15 && DOUBLE_YAKUMAN.length === 4, 'yakuman table: 15 entries (4 double variants)');
  assert(RIICHI_YAKUMAN.kokushi.closedOnly && RIICHI_YAKUMAN.suuankou.closedOnly && !RIICHI_YAKUMAN.daisangen.closedOnly, 'closed-only flags');
  assertThrows(() => new RiichiRules({ doubleYakuman: 'no' }), TypeError, 'doubleYakuman must be boolean');
  assert(R.getOptions().doubleYakuman === true, 'doubleYakuman defaults to true');
});

summary();

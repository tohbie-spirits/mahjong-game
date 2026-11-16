/**
 * chineseOfficialScoring.test.mjs — Tasks 94–95: the MCR point-combination
 * rule set (ChineseOfficialScoring.js) through ChineseOfficialRules#validateWin.
 *
 * Sections (Task 94):
 *   1. The table — 81 fans, points per tier, exclusion ids valid, frozen
 *   2. 88 / 64 / 48-point fans — each with a hand that has it and a near miss
 *   3. 32 / 24-point fans
 *   4. 16 / 12-point fans
 *   5. Set groups — four-set fans, three-set fans, the best grouping of the
 *      sets, the best interpretation of the tiles
 *   6. Non-repeat (exclusions)
 *   7. Concealed pungs and kongs — Ron-completed pungs, melded / concealed kongs
 * Sections (Task 95):
 *   8. 8-point fans        9. 6-point fans        10. 4-point fans
 *   11. 2-point fans — incl. seat / prevalent wind roles
 *   12. 1-point fans — incl. wait fans only for a single waiting kind
 *   13. Account once — pair relations as a spanning forest
 *   14. Chicken Hand and worked totals
 *   15. Fuzz — random tenpai hands: every win scores without errors, no fan
 *       sits beside a fan that excludes it, totals add up
 *
 * Every hand below is a complete 14-tile hand (melds count 3); the last
 * concealed tile is the winning tile unless a winningTile is given.
 *
 * Run: node tests/rules/chineseOfficialScoring.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand, tiles } from '../_helpers/tiles.mjs';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { Hand } from '../../src/core/Hand.js';
import { Tile } from '../../src/core/Tile.js';
import { STANDARD_FACE_IDS } from '../../src/core/TileSetGenerator.js';
import { findWaits, countsFromTiles, faceIdOfKind } from '../../src/rules/chineseOfficial/ChineseOfficialHandAnalysis.js';
import { MCR_FANS, DETECTED_FAN_IDS, applyExclusions, FLOWER_POINTS } from '../../src/rules/chineseOfficial/ChineseOfficialScoring.js';

/** Scores with no minimum, so every hand's fans are visible. */
const open = new ChineseOfficialRules({ minimumPoints: 0 });

/**
 * @param {string} spec  concealed tiles (last = winning tile unless ctx.win given)
 * @param {Object[]} melds  hand() meld specs
 * @param {Object} ctx  extra context; ctx.win = face spec of the winning tile
 */
function score(spec, melds = [], ctx = {}) {
  const h = hand(spec, melds);
  const winningTile = ctx.win ? h.concealedTiles.find((t) => t.id === tiles(ctx.win)[0].id) : h.concealedTiles[h.concealedTiles.length - 1];
  const v = open.validateWin(h, { winType: 'self', ...ctx, winningTile });
  return v;
}
const ids = (v) => v.fans.map((f) => f.id);
/** has(spec, id, melds?, ctx?) or has(spec, melds, id, ctx?) */
const has = (spec, a, b, ctx) => (Array.isArray(a) ? ids(score(spec, a, ctx)).includes(b) : ids(score(spec, b ?? [], ctx)).includes(a));
const show = (spec, melds, ctx) => { const v = score(spec, melds, ctx); return `${v.points}: ${ids(v).join(' ')}`; };
const kong = (spec, concealed = false) => ({ type: 'kong', spec, concealed });
const pon = (spec) => ({ type: 'pon', spec });
const chi = (spec) => ({ type: 'chi', spec });

// ---------------------------------------------------------------------------
section('1. The table', () => {
  const fans = Object.values(MCR_FANS);
  assert(fans.length === 81, `81 fans (${fans.length})`);
  const tiers = {};
  for (const f of fans) tiers[f.points] = (tiers[f.points] ?? 0) + 1;
  assert(JSON.stringify(tiers) === JSON.stringify({ 1: 13, 2: 10, 4: 4, 6: 6, 8: 10, 12: 5, 16: 6, 24: 9, 32: 3, 48: 2, 64: 6, 88: 7 }), `points per tier ${JSON.stringify(tiers)}`);
  assert(fans.every((f) => f.excludes.every((x) => MCR_FANS[x] && x !== f.id)), 'every exclusion names another real fan');
  assert(fans.every((f) => f.excludes.every((x) => MCR_FANS[x].points <= f.points)), 'a fan only excludes fans worth no more than itself');
  assert(fans.every((f) => typeof f.chinese === 'string' && f.chinese.length >= 2 && f.name), 'English + Chinese names');
  assert(Object.isFrozen(MCR_FANS) && Object.isFrozen(MCR_FANS['nine-gates']) && Object.isFrozen(MCR_FANS['nine-gates'].excludes), 'frozen');
  assert(FLOWER_POINTS === 1 && MCR_FANS['chicken-hand'].points === 8, 'flowers 1, Chicken Hand 8');
  assert(DETECTED_FAN_IDS.length >= 38 && ['big-four-winds', 'knitted-straight', 'big-three-winds'].every((id) => DETECTED_FAN_IDS.includes(id)), 'every fan of 12+ points is detected');
});

// ---------------------------------------------------------------------------
section('2. 88 / 64 / 48', () => {
  const bfw = ids(score('EEE SSS WWW NNN 11d'));
  assert(bfw.includes('big-four-winds') && !bfw.includes('big-three-winds') && !bfw.includes('little-four-winds') && !bfw.includes('all-pungs'), `Big Four Winds (${bfw.join(' ')})`);
  const btd = ids(score('RRR GGG HHH 123d 55b'));
  assert(btd.includes('big-three-dragons') && !btd.includes('little-three-dragons') && !btd.includes('two-dragon-pungs') && !btd.includes('dragon-pung'), `Big Three Dragons (${btd.join(' ')})`);
  assert(has('234b 666b 888b GG 234b', 'all-green') && !has('234b 555b 888b GG 234b', 'all-green'), 'All Green (5 of bamboo breaks it)');
  assert(has('234b 666b 888b 22b 234b', 'all-green') && has('234b 666b 888b 22b 234b', 'full-flush'), 'All Green without the dragon is also a Full Flush');
  assert(has('1112345678999d 5d', 'nine-gates') && !has('1112345678999d 5d', 'full-flush'), 'Nine Gates (excludes Full Flush)');
  assert(!has('1123455678999d 1d', 'nine-gates'), 'same 14 tiles but the 13 before the win are not 1112345678999 → no Nine Gates');
  assert(has('11d', [kong('2222d'), kong('3333b'), kong('4444c'), kong('EEEE')], 'four-kongs') && !has('11d', [kong('2222d'), kong('3333b'), kong('4444c'), kong('EEEE')], 'three-kongs'), 'Four Kongs (not also Three)');
  assert(has('22b 33b 44b 55b 66b 77b 88b', 'seven-shifted-pairs') && !has('22b 33b 44b 55b 66b 77b 88b', 'seven-pairs') && !has('22b 33b 44b 55b 66b 77b 88b', 'full-flush'), 'Seven Shifted Pairs (excludes Seven Pairs, Full Flush)');
  assert(!has('22b 33b 44b 55b 66b 77b 99b', 'seven-shifted-pairs') && has('22b 33b 44b 55b 66b 77b 99b', 'seven-pairs'), 'a gap → plain Seven Pairs');
  const to = ids(score('19d 19b 19c ESWNRGH H'));
  assert(to.includes('thirteen-orphans') && !to.includes('all-terminals-and-honors'), `Thirteen Orphans is not also All Terminals and Honors (${to.join(' ')})`);

  assert(has('111d 999d 111b 999c 11c', 'all-terminals') && !has('111d 999d 111b 999c 11c', 'all-terminals-and-honors'), 'All Terminals (excludes All Terminals and Honors)');
  assert(has('EEE SSS WWW NN 123d', 'little-four-winds') && !has('EEE SSS WWW NN 123d', 'big-three-winds'), 'Little Four Winds (excludes Big Three Winds)');
  assert(has('RRR GGG HH 123d 456b', 'little-three-dragons') && !has('RRR GGG HH 123d 456b', 'dragon-pung'), 'Little Three Dragons');
  assert(has('EEE SSS RRR GGG WW', 'all-honors') && !has('EEE SSS RRR GGG WW', 'all-terminals-and-honors'), 'All Honors');
  assert(has('111d 444b 777c 99b EEE', 'four-concealed-pungs'), 'Four Concealed Pungs (self-drawn)');
  assert(!has('111d 444b 777c 99b EEE', 'four-concealed-pungs', [], { winType: 'discard' }) && has('111d 444b 777c 99b EEE', 'three-concealed-pungs', [], { winType: 'discard' }), 'Ron completing a Pung → that Pung is not concealed → Three Concealed Pungs');
  assert(has('111d 444b 777c EEE 99b', 'four-concealed-pungs', [], { winType: 'discard' }), 'Ron on the pair keeps all four concealed');
  assert(has('123d 123d 789d 789d 55d', 'pure-terminal-chows') && !has('123d 123d 789d 789d 55d', 'seven-pairs') && !has('123d 123d 789d 789d 55d', 'full-flush'), 'Pure Terminal Chows (beats the Seven Pairs reading; excludes Full Flush)');
  assert(!has('123d 123d 789d 789d 55b', 'pure-terminal-chows'), 'the 5 pair must be the same suit');

  assert(has('123d 123d 123d 123d 99b', 'quadruple-chow') && !has('123d 123d 123d 123d 99b', 'pure-triple-chow'), 'Quadruple Chow (excludes Pure Triple Chow)');
  const fps = ids(score('111d 222d 333d 444d 99b'));
  assert(fps.includes('four-pure-shifted-pungs') && !fps.includes('pure-shifted-pungs') && !fps.includes('quadruple-chow'), `Four Pure Shifted Pungs — the pung reading wins (${fps.join(' ')})`);
});

// ---------------------------------------------------------------------------
section('3. 32 / 24', () => {
  assert(has('123d 234d 345d 456d EE', 'four-pure-shifted-chows') && has('123d 345d 567d 789d EE', 'four-pure-shifted-chows'), 'Four Pure Shifted Chows, step 1 and step 2');
  assert(!has('123d 234d 345d 456d EE', 'pure-shifted-chows'), '…excluding Pure Shifted Chows');
  assert(!has('123d 234d 456d 567d EE', 'four-pure-shifted-chows'), 'uneven steps → no');
  assert(has('123b 11d', [kong('2222d'), kong('3333b'), kong('4444c')], 'three-kongs'), 'Three Kongs');
  assert(has('111d 999b EEE RRR 11c', 'all-terminals-and-honors'), 'All Terminals and Honors');
  assert(has('11d 99d 11b EE SS RR GG', 'all-terminals-and-honors') && has('11d 99d 11b EE SS RR GG', 'seven-pairs'), '…also as Seven Pairs');

  assert(has('11d 33d 55d 77b 99b EE RR', 'seven-pairs'), 'Seven Pairs');
  const ghk = ids(score('147d 25b 36c ESWNRGH'));
  assert(ghk.includes('greater-honors-knitted') && !ghk.includes('lesser-honors-knitted'), 'Greater Honors and Knitted Tiles (excludes Lesser)');
  const aep = ids(score('222d 444b 666c 888d 22b'));
  assert(aep.includes('all-even-pungs') && !aep.includes('all-pungs'), 'All Even Pungs');
  assert(!has('222d 444b 666c 888d 33b', 'all-even-pungs'), 'an odd pair → no');
  assert(has('123d 345d 678d 999d 11d', 'full-flush') && !has('123d 345d 678d 999d 11d', 'no-honors'), 'Full Flush (excludes No Honors)');
  assert(has('123d 456b EE', [chi('123d'), chi('123d')], 'pure-triple-chow'), 'Pure Triple Chow');
  assert(has('333d 456b EE', [pon('111d'), pon('222d')], 'pure-shifted-pungs'), 'Pure Shifted Pungs');
  assert(has('789d 789b 777c 88d 999b', 'upper-tiles') && !has('789d 789b 777c 88d 999b', 'upper-four'), 'Upper Tiles (7–9; excludes Upper Four)');
  assert(has('456d 456b 456c 555d 66b', 'middle-tiles'), 'Middle Tiles (4–6)');
  assert(has('123d 123b 123c 111d 22b', 'lower-tiles') && !has('123d 123b 123c 111d 22b', 'lower-four'), 'Lower Tiles (1–3)');
  assert(!has('789d 789b 777c 88d EE', 'upper-tiles'), 'an honour breaks Upper Tiles');
});

// ---------------------------------------------------------------------------
section('4. 16 / 12', () => {
  assert(has('123d 456d 789d 55b 789c', 'pure-straight'), 'Pure Straight');
  assert(has('123d 789d 123b 789b 55c', 'three-suited-terminal-chows') && !has('123d 789d 123b 789b 55b', 'three-suited-terminal-chows'), 'Three-Suited Terminal Chows (the 5 pair in the third suit)');
  assert(has('123d 234d 345d 789b EE', 'pure-shifted-chows') && has('123d 345d 567d 789b EE', 'pure-shifted-chows'), 'Pure Shifted Chows (step 1 / step 2)');
  assert(has('555d 456b 345c 55c 456d', 'all-fives') && !has('555d 456b 345c 55c 123d', 'all-fives'), 'All Fives');
  assert(has('123d EE', [pon('555d'), pon('555b'), pon('555c')], 'triple-pung'), 'Triple Pung');
  assert(has('111d 444b 777c 123d EE', 'three-concealed-pungs'), 'Three Concealed Pungs');
  assert(has('147d 258b 369c ESWRG', 'lesser-honors-knitted'), 'Lesser Honors and Knitted Tiles');
  assert(has('147d 258b 369c 555c EE', 'knitted-straight'), 'Knitted Straight');
  assert(has('678d 789b 666c 99d 999c', 'upper-four') && !has('678d 789b 666c 99d 999c', 'upper-tiles'), 'Upper Four (6–9)');
  assert(has('234d 123b 444c 11d 333c', 'lower-four'), 'Lower Four (1–4)');
  assert(has('EEE SSS WWW 123d 55b', 'big-three-winds'), 'Big Three Winds');
});

// ---------------------------------------------------------------------------
section('5. Set groups', () => {
  const ps = ids(score('123d 456d 789d 123b 55c'));
  assert(ps.filter((x) => x === 'pure-straight').length === 1, `Pure Straight counted once (${ps.join(' ')})`);
  const sevenOrChows = score('111d 222d 333d 456b 99c');
  assert(ids(sevenOrChows).includes('pure-shifted-pungs') && !ids(sevenOrChows).includes('pure-triple-chow'), `111222333: the pung reading (Pure Shifted Pungs + Three Concealed Pungs) beats Pure Triple Chow (${show('111d 222d 333d 456b 99c')})`);
  assert(sevenOrChows.interpretations.length >= 2, 'both readings were scored');
  const qc = score('123d 123d 123d 123d 99b');
  assert(ids(qc).join() === 'quadruple-chow' || ids(qc).includes('quadruple-chow'), `four identical chows → Quadruple Chow, the 1111/2222/3333 pung reading is worth less (${show('123d 123d 123d 123d 99b')})`);
  assert(has('123d 234d 345d 789d EE', 'pure-shifted-chows') && !has('123d 234d 345d 789d EE', 'four-pure-shifted-chows'), 'three shifted + an unrelated chow → Pure Shifted Chows');
  assert(has('333d 456b EE', [pon('555d'), pon('444d')], 'pure-shifted-pungs'), 'melded pungs form groups too');
  const tp = ids(score('555d 555b 555c 666c 11d'));
  assert(tp.includes('triple-pung') && !tp.includes('pure-shifted-pungs'), 'Triple Pung');
  assert(!has('123d 456d 789b 123c EE', 'pure-straight'), 'a straight across suits is not a Pure Straight (Mixed Straight — Task 95)');
});

// ---------------------------------------------------------------------------
section('6. Non-repeat', () => {
  assert(applyExclusions(['no-honors', 'full-flush']).join() === 'full-flush', 'Full Flush drops No Honors');
  assert(applyExclusions(['seat-wind', 'big-three-winds', 'big-four-winds', 'all-pungs']).join() === 'big-four-winds', 'Big Four Winds drops its implied fans');
  assert(applyExclusions(['dragon-pung', 'dragon-pung']).length === 2, 'a fan counted twice stays twice');
  assert(applyExclusions(['upper-four', 'upper-tiles', 'no-honors']).join() === 'upper-tiles', 'Upper Tiles drops Upper Four + No Honors');
  assert(applyExclusions([]).length === 0, 'empty');
  assert(applyExclusions(['pure-shifted-pungs', 'pure-triple-chow']).length === 1, 'mutually exclusive pair keeps one');
});

// ---------------------------------------------------------------------------
section('7. Concealed pungs and kongs', () => {
  assert(!has('123d 99b', [pon('111b'), pon('222c'), kong('3333c')], 'three-concealed-pungs'), 'melded pungs / kongs are not concealed');
  assert(has('123d 777b 99c', [kong('3333c', true), kong('EEEE', true)], 'three-concealed-pungs'), 'concealed kongs count as concealed pungs (777b + two concealed kongs)');
  assert(has('11d', [kong('2222d', true), kong('3333b', true), kong('4444c', true), kong('EEEE', true)], 'four-concealed-pungs'), 'four concealed kongs → Four Concealed Pungs too');
  assertThrows(() => open.validateWin(hand('123d'), { winType: 'self' }), TypeError, 'winningTile still required');
});

// ---------------------------------------------------------------------------
// Task 95
// ---------------------------------------------------------------------------
/** n(spec, id, melds?, ctx?) or n(spec, melds, id, ctx?) — how many times the fan counts */
const n = (spec, a, b, ctx) => (Array.isArray(a) ? ids(score(spec, a, ctx)).filter((x) => x === b).length : ids(score(spec, b ?? [], ctx)).filter((x) => x === a).length);
const RON = { winType: 'discard' };
const E = { id: 'east' }; const S = { id: 'south' };

section('8. 8-point fans', () => {
  assert(has('123d 456b 789c 111d EE', 'mixed-straight'), 'Mixed Straight');
  const rv = ids(score('123d 345d 888d 99b 456b'));
  assert(rv.includes('reversible-tiles') && !rv.includes('one-voided-suit'), `Reversible Tiles (excludes One Voided Suit) (${rv.join(' ')})`);
  assert(!has('123d 345d 888d 99b 567b', 'reversible-tiles'), '7 of bamboo is not reversible');
  assert(has('123d 123b 123c 789d EE', 'mixed-triple-chow') && n('123d 123b 123c 789d EE', 'mixed-double-chow') === 0, 'Mixed Triple Chow (no Mixed Double Chow inside it)');
  assert(has('567d EE', [pon('222d'), pon('333b'), pon('444c')], 'mixed-shifted-pungs'), 'Mixed Shifted Pungs');
  assert(has('123d 456b 789c 111d EE', 'last-tile-draw', [], { isLastTile: true }) && !has('123d 456b 789c 111d EE', 'self-drawn', [], { isLastTile: true }), 'Last Tile Draw (excludes Self-Drawn)');
  assert(has('123d 456b 789c 111d EE', 'last-tile-claim', [], { isLastTile: true, ...RON }), 'Last Tile Claim');
  assert(has('123d 456b 789c 111d EE', 'out-with-replacement', [], { isKongReplacement: true }) && !has('123d 456b 789c 111d EE', 'self-drawn', [], { isKongReplacement: true }), 'Out with Replacement Tile (excludes Self-Drawn)');
  const rk = ids(score('123d 456b 789c 111d EE', [], { ...RON, isRobbingKong: true, isLastCopy: true }));
  assert(rk.includes('robbing-the-kong') && !rk.includes('last-tile'), 'Robbing the Kong (excludes Last Tile)');
  const tck = ids(score('123d 456b 99c', [kong('2222d', true), kong('EEEE', true)]));
  assert(tck.includes('two-concealed-kongs') && !tck.includes('concealed-kong'), `Two Concealed Kongs (${tck.join(' ')})`);
});

section('9. 6-point fans', () => {
  assert(has('99d 345c', [pon('222d'), pon('555b'), pon('777c')], 'all-pungs') === false && has('99d', [pon('222d'), pon('555b'), pon('777c'), pon('888d')], 'all-pungs'), 'All Pungs needs four pungs');
  assert(has('123d 456d 789d EE', [pon('SSS')], 'half-flush'), 'Half Flush');
  assert(has('123d 234b 345c 789d EE', 'mixed-shifted-chows'), 'Mixed Shifted Chows');
  assert(has('123d 456b 789c EEE RR', 'all-types') && !has('123d 456b 789c EEE 99c', 'all-types'), 'All Types (needs a dragon too)');
  const mh = ids(score('55c', [chi('123d'), pon('999b'), chi('456c'), pon('EEE')], RON));
  assert(mh.includes('melded-hand') && !mh.includes('single-wait'), `Melded Hand (excludes Single Wait) (${mh.join(' ')})`);
  assert(!has('55c', [chi('123d'), pon('999b'), chi('456c'), pon('EEE')], 'melded-hand'), '…only when won on a discard');
  const td = ids(score('RRR GGG 123d 456b 99c'));
  assert(td.includes('two-dragon-pungs') && !td.includes('dragon-pung'), 'Two Dragon Pungs (excludes Dragon Pung)');
});

section('10. 4-point fans', () => {
  assert(has('123d 789b 111c 999d EE', 'outside-hand') && !has('123d 456b 111c 999d EE', 'outside-hand'), 'Outside Hand (every set and the pair)');
  const fc = ids(score('123d 456b 789c 111d EE'));
  assert(fc.includes('fully-concealed') && !fc.includes('self-drawn') && !fc.includes('concealed-hand'), 'Fully Concealed Hand (excludes Self-Drawn, Concealed Hand)');
  const sp = ids(score('11d 33d 55d 77b 99b EE RR'));
  assert(sp.includes('self-drawn') && !sp.includes('fully-concealed'), 'special shapes (Seven Pairs) count Self-Drawn, not Fully Concealed');
  assert(has('147d 258b 369c 555c EE', 'fully-concealed'), '…a closed Knitted Straight does count Fully Concealed');
  const tm = ids(score('123d 456b 99c', [kong('2222d'), kong('EEEE')]));
  assert(tm.includes('two-melded-kongs') && !tm.includes('melded-kong'), 'Two Melded Kongs');
  assert(has('123d 456b 789c 111d EE', 'last-tile', [], { ...RON, isLastCopy: true }), 'Last Tile (the fourth copy)');
});

section('11. 2-point fans', () => {
  assert(n('RRR 123d 456b 789b 99c', 'dragon-pung') === 1, 'Dragon Pung');
  const ee = ids(score('EEE 123d 456b 789c 99d', [], { seatWind: E, roundWind: E }));
  assert(ee.includes('seat-wind') && ee.includes('prevalent-wind') && !ee.includes('pung-terminals-honors'), 'East pung as East seat in the East round: Seat Wind + Prevalent Wind, not a Pung of Honors');
  assert(has('WWW 123d 456b 789c 99d', 'pung-terminals-honors', [], { seatWind: S, roundWind: E }) && !has('WWW 123d 456b 789c 99d', 'seat-wind', [], { seatWind: S, roundWind: E }), 'a West pung for the South seat in East: just a Pung of Honors');
  assert(has('SSS 123d 456b 789c 99d', 'seat-wind', [], { seatWind: 'wind-south', roundWind: E }), 'seat wind given as a face id works too');
  assert(has('123d 456b 789c 111d EE', 'concealed-hand', [], RON), 'Concealed Hand (closed, won on a discard)');
  assert(has('234d 567b 678c 22d 345b', 'all-chows') && !has('234d 567b 678c EE 345b', 'all-chows'), 'All Chows (no honour pair)');
  assert(n('123d 456b 789c 111d EE', 'tile-hog') === 1 && n('123d 456b 99c', [kong('1111d'), kong('EEEE')], 'tile-hog') === 0, 'Tile Hog — four copies used, not as a Kong');
  assert(has('2222d 33d 55d 77b 99b EE', 'tile-hog') && has('2222d 33d 55d 77b 99b EE', 'seven-pairs'), 'Tile Hog in Seven Pairs');
  assert(has('222d 222b 345c 678c 99d', 'double-pung'), 'Double Pung');
  assert(has('222d 444b 345c 678c 99d', 'two-concealed-pungs') && !has('222d 345c 678c 99d 444b', 'two-concealed-pungs', [], RON), 'Two Concealed Pungs — not when one Pung was completed by the discard');
  assert(n('123d 456b 99c 777c', [kong('2222d', true)], 'concealed-kong') === 1, 'Concealed Kong');
  assert(has('234d 567b 678c 22d 345b', 'all-simples') && !has('234d 567b 678c 22d 345b', 'no-honors'), 'All Simples (excludes No Honors)');
});

section('12. 1-point fans', () => {
  assert(n('123d 123d 567b 888c EE', 'pure-double-chow') === 1, 'Pure Double Chow');
  assert(n('123d 123b 567c 999c EE', 'mixed-double-chow') === 1, 'Mixed Double Chow');
  assert(n('123d 456d 789c 111b EE', 'short-straight') === 1, 'Short Straight');
  assert(n('123b 789b 555d 999c EE', 'two-terminal-chows') === 1, 'Two Terminal Chows');
  assert(n('111d 999b 345c 678c EE', 'pung-terminals-honors') === 2, 'Pung of Terminals or Honors — each');
  assert(n('123d 456b 99c 777c', [kong('2222d')], 'melded-kong') === 1, 'Melded Kong');
  assert(has('123d 456d 789b 111b EE', 'one-voided-suit') && !has('123d 456d 789d 111d EE', 'one-voided-suit'), 'One Voided Suit (exactly one suit missing)');
  assert(has('123d 456b 789c 111d 99d', 'no-honors'), 'No Honors');
  assert(has('456b 789c 111d EE 12d 3d', 'edge-wait'), 'Edge Wait (12 + 3, the only wait)');
  assert(has('456b 789c 111d EE 13d 2d', 'closed-wait'), 'Closed Wait (13 + 2)');
  assert(has('123d 456b 789c 111d EE', 'single-wait'), 'Single Wait (on the pair, only wait)');
  assert(!has('123d 456b 789c EEE 44d', 'single-wait'), 'no Single Wait when the hand also waited on 1d (1234 + E pung)');
  assert(!has('234d 567b 678c 22d 345b', 'edge-wait') && !has('234d 567b 678c 22d 345b', 'closed-wait'), 'a two-sided wait scores no wait fan');
  assert(has('123b 456b 789c 99c', [kong('2222d')], 'self-drawn') && !has('123b 456b 789c 99c', [kong('2222d')], 'self-drawn', RON), 'Self-Drawn (open hand, Tsumo)');
});

section('13. Account once', () => {
  assert(has('123d 123d 123b 123b 99c', 'seven-pairs'), 'closed, 112233d 112233b 99c reads best as Seven Pairs');
  const M = [chi('123d'), chi('123b')];
  const four = score('123d 123b 99c', M);
  assert(n('123d 123b 99c', M, 'pure-double-chow') === 2 && n('123d 123b 99c', M, 'mixed-double-chow') === 1, `four chows → at most three relations: 2 × Pure Double Chow + 1 × Mixed Double Chow (${ids(four).join(' ')})`);
  const ps = ids(score('123d 456d 789d 123b 55c'));
  assert(ps.filter((x) => x === 'mixed-double-chow').length === 1 && !ps.includes('short-straight') && !ps.includes('two-terminal-chows'), `Pure Straight + the fourth chow related once (${ps.join(' ')})`);
  const tc = ids(score('123d EE 456d', [chi('123d'), chi('123d')]));
  assert(tc.includes('pure-triple-chow') && tc.filter((x) => x === 'short-straight').length === 1 && !tc.includes('pure-double-chow'), `Pure Triple Chow + one Short Straight to the fourth chow (${tc.join(' ')})`);
  const dp = ids(score('99c', [pon('222d'), pon('222b'), pon('555d'), pon('555c')]));
  assert(dp.filter((x) => x === 'double-pung').length === 2, `two separate Double Pungs (${dp.join(' ')})`);
  assert(n('99c', [pon('222d'), pon('222b'), pon('222c'), pon('555c')], 'double-pung') === 0, 'Triple Pung excludes Double Pung');
});

section('14. Chicken Hand and worked totals', () => {
  const ch = score('34b EE 5b', [chi('234d'), chi('567b'), pon('666c')], RON);
  assert(ch.valid && ids(ch).join() === 'chicken-hand' && ch.points === 8, `Chicken Hand: nothing else scores → 8 (${show('34b EE 5b', [chi('234d'), chi('567b'), pon('666c')], RON)})`);
  assert(!has('34b EE 5b', [chi('234d'), chi('567b'), pon('666c')], 'chicken-hand', { winType: 'self' }), 'Self-Drawn scores → no Chicken Hand');
  const t1 = score('123d 456b 789c 111d EE');
  assert(t1.points === 16, `123d 456b 789c 111d EE Tsumo = Mixed Straight 8 + Fully Concealed 4 + Tile Hog 2 + Pung of Terminals 1 + Single Wait 1 = 16 (${show('123d 456b 789c 111d EE')})`);
  const t2 = score('123d 345d 678d 999d 11d', [], RON);
  assert(t2.points === 28, `Full Flush 24 + Concealed Hand 2 + Short Straight 1 + Pung of Terminals 1 = 28 (${show('123d 345d 678d 999d 11d', [], RON)})`);
  const t3 = score('11c', [pon('EEE'), pon('SSS'), pon('WWW'), pon('NNN')], RON);
  assert(ids(t3).includes('big-four-winds') && ids(t3).includes('all-terminals-and-honors') && ids(t3).includes('half-flush') && !ids(t3).includes('seat-wind'), `melded Big Four Winds (${show('11c', [pon('EEE'), pon('SSS'), pon('WWW'), pon('NNN')], RON)})`);
  const strict = new ChineseOfficialRules();
  const h = hand('234d 567b 678c 22d 345b');
  assert(!strict.validateWin(h, { winType: 'discard', winningTile: h.concealedTiles[13] }).valid && strict.validateWin(h, { winType: 'self', winningTile: h.concealedTiles[13] }).valid, 'the same hand: 6 points on a discard (refused), 8 self-drawn (Fully Concealed instead of Concealed Hand) — valid');
});

section('15. Fuzz', () => {
  let seed = 95; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const deck = STANDARD_FACE_IDS.flatMap((id) => [1, 2, 3, 4].map((c) => `${id}|${c}`));
  let hands = 0; let wins = 0; let errors = 0; let excl = 0; let sums = 0; const seen = new Set();
  for (let i = 0; i < 4000 && hands < 400; i++) {
    // Bias towards tenpai: draw from a narrow slice of the deck.
    const start = Math.floor(rnd() * (deck.length - 40));
    const pool = deck.slice(start, start + 40).sort(() => rnd() - 0.5).slice(0, 13);
    const ts = pool.map((x) => { const [id, c] = x.split('|'); return Tile.fromId(id, `${id}#z${c}`); });
    const waits = findWaits(countsFromTiles(ts), 0);
    if (!waits.length) continue;
    hands++;
    for (const k of waits) for (const winType of ['self', 'discard']) {
      const win = Tile.fromId(faceIdOfKind(k), `${faceIdOfKind(k)}#zw`);
      try {
        const v = open.validateWin(new Hand([...ts, win]), { winType, winningTile: win });
        wins++;
        const fanIds = v.fans.map((f) => f.id);
        fanIds.forEach((id) => seen.add(id));
        if (fanIds.some((id) => fanIds.some((o) => MCR_FANS[o].excludes.includes(id)))) excl++;
        if (v.points !== v.fans.reduce((a, f) => a + f.points, 0) || (fanIds.includes('chicken-hand') && fanIds.length > 1)) sums++;
      } catch (e) { errors++; if (errors < 3) console.error(e); }
    }
  }
  assert(hands >= 100 && wins >= 200, `enough random tenpai hands (${hands} hands, ${wins} wins scored)`);
  assert(errors === 0, `no errors (${errors})`);
  assert(excl === 0, `no fan beside one that excludes it (${excl})`);
  assert(sums === 0, `totals add up; Chicken Hand only alone (${sums})`);
  assert(seen.size >= 15, `a variety of fans seen (${seen.size})`);
});

summary();

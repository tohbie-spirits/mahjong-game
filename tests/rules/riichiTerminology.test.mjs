/**
 * riichiTerminology.test.mjs — Task 87: RiichiTerminology.js.
 *
 * Sections:
 *   1. General terms — RuleEngine#getTerminology() returns them; keys
 *      shared with the other rulesets exist; Japanese map
 *   2. Name tables stay in sync with the engine — every RIICHI_YAKU /
 *      RIICHI_YAKUMAN id, every LIMIT, every WAIT_TYPE has a name
 *   3. getYakuDisplayName styles; everything frozen and non-empty
 *   4. Every yaku a real scored hand reports has a display name
 *
 * Run: node tests/rules/riichiTerminology.test.mjs
 */
import { section, assert, summary } from '../_helpers/harness.mjs';
import { hand, makeTileFactory } from '../_helpers/tiles.mjs';
import {
  RIICHI_TERMINOLOGY, RIICHI_YAKU_NAMES, RIICHI_LIMIT_NAMES, RIICHI_WAIT_NAMES, RIICHI_ABORTIVE_DRAW_NAMES, getYakuDisplayName, getRiichiTerminology,
} from '../../src/rules/riichi/RiichiTerminology.js';
import { HONG_KONG_TERMINOLOGY } from '../../src/rules/hongkong/HongKongTerminology.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { RIICHI_YAKU, RIICHI_YAKUMAN } from '../../src/rules/riichi/RiichiYaku.js';
import { LIMIT } from '../../src/rules/riichi/RiichiScoring.js';
import { WAIT_TYPE } from '../../src/rules/riichi/RiichiHandAnalysis.js';
import { WIN_SOURCE } from '../../src/utils/constants.js';

const R = new RiichiRules();

section('1. General terms', () => {
  assert(R.getTerminology() === RIICHI_TERMINOLOGY && getRiichiTerminology() === RIICHI_TERMINOLOGY, 'the engine returns the Riichi terminology');
  const shared = Object.keys(HONG_KONG_TERMINOLOGY).filter((k) => typeof HONG_KONG_TERMINOLOGY[k] === 'string' && !['fan', 'minimumFan', 'chickenHand'].includes(k));
  const missing = shared.filter((k) => typeof RIICHI_TERMINOLOGY[k] !== 'string');
  assert(missing.length === 0, `every general key the HK terminology has (except fan-specific ones) exists (${missing.join(', ') || 'none missing'})`);
  assert(RIICHI_TERMINOLOGY.kong === 'Kan' && RIICHI_TERMINOLOGY.pon === 'Pon' && RIICHI_TERMINOLOGY.selfDraw === 'Tsumo', 'Riichi words for shared concepts');
  assert(['riichi', 'han', 'fu', 'dora', 'honba', 'furiten', 'tenpai', 'abortive-draw', 'nine-terminals'].every((k) => typeof RIICHI_TERMINOLOGY[k] === 'string'), 'Riichi-only terms (incl. the keys the Task 81 provisional map had)');
  assert(RIICHI_TERMINOLOGY.japanese.riichi === 'リーチ' && RIICHI_TERMINOLOGY.japanese.han === '翻', 'Japanese map');
});

section('2. In sync with the engine', () => {
  const ids = [...Object.keys(RIICHI_YAKU), ...Object.keys(RIICHI_YAKUMAN), 'dora', 'uraDora', 'akaDora'];
  const missing = ids.filter((id) => !RIICHI_YAKU_NAMES[id]);
  assert(missing.length === 0, `every yaku / yakuman / dora id has a name (${missing.join(', ') || 'none missing'})`);
  const extra = Object.keys(RIICHI_YAKU_NAMES).filter((id) => !ids.includes(id) && id !== 'nagashi-mangan');
  assert(extra.length === 0, `no stale names (${extra.join(', ') || 'none'})`);
  assert(Object.values(LIMIT).every((l) => RIICHI_LIMIT_NAMES[l]), 'every limit has a name');
  assert(Object.values(WAIT_TYPE).every((w) => RIICHI_WAIT_NAMES[w]), 'every wait type has a name');
  assert(RIICHI_ABORTIVE_DRAW_NAMES['nine-terminals'].romaji === 'Kyuushu Kyuuhai', 'abortive draw names');
});

section('3. Display names', () => {
  assert(getYakuDisplayName('pinfu') === 'Pinfu' && getYakuDisplayName('tanyao') === 'All Simples', 'English (default)');
  assert(getYakuDisplayName('tanyao', { style: 'romaji' }) === 'Tanyao' && getYakuDisplayName('tanyao', { style: 'japanese' }) === '断幺九', 'romaji / Japanese');
  assert(getYakuDisplayName('unknown-id') === 'unknown-id', 'unknown ids fall back to the id');
  const all = [RIICHI_YAKU_NAMES, RIICHI_LIMIT_NAMES, RIICHI_WAIT_NAMES, RIICHI_ABORTIVE_DRAW_NAMES];
  assert(all.every((t) => Object.isFrozen(t) && Object.values(t).every((v) => Object.isFrozen(v) && v.name && v.romaji && v.japanese)), 'every table and entry is frozen with name, romaji and japanese');
  assert(Object.isFrozen(RIICHI_TERMINOLOGY) && Object.isFrozen(RIICHI_TERMINOLOGY.japanese), 'terminology frozen');
});

section('4. Scored hands', () => {
  const cases = [
    ['234d 345b 567c 678c 88d', 'dots-2', { winType: WIN_SOURCE.SELF, isRiichi: true, dora: { dora: 1 } }],
    ['123d RRR GGG HHH 99b', 'bamboo-9', { winType: WIN_SOURCE.DISCARD }],
    ['11d 33d 55d 77b 99b EE RR', 'dragon-red', { winType: WIN_SOURCE.DISCARD }],
  ];
  for (const [spec, face, ctx] of cases) {
    const h = hand(spec, [], makeTileFactory());
    const s = R.scoreHand(h, { winningTile: h.concealedTiles.filter((t) => t.id === face).pop(), seatWind: 'south', roundWind: 'east', ...ctx });
    assert(s.meetsMinimum && s.breakdown.every((b) => getYakuDisplayName(b.id) !== b.id), `${spec}: every reported yaku has a display name (${s.breakdown.map((b) => getYakuDisplayName(b.id)).join(', ')})`);
  }
});

summary();

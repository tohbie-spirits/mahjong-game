/**
 * chineseOfficialTerminology.test.mjs — Task 96: ChineseOfficialTerminology.js.
 *
 * Sections:
 *   1. General terms — the keys every ruleset shares, Chinese + pinyin for each
 *   2. In sync with the engine — every MCR fan, structure, wait type, refusal
 *      reason and bonus tile has a name; names come from MCR_FANS
 *   3. Display helpers — getFanDisplayName styles, formatFanLine
 *   4. Through the engine — every fan a real validateWin returns can be shown
 *
 * Run: node tests/rules/chineseOfficialTerminology.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand } from '../_helpers/tiles.mjs';
import {
  CHINESE_OFFICIAL_TERMINOLOGY, CO_FAN_NAMES, CO_STRUCTURE_NAMES, CO_WAIT_NAMES, CO_REFUSAL_NAMES, CO_FLOWER_NAMES,
  getFanDisplayName, formatFanLine, getChineseOfficialTerminology,
} from '../../src/rules/chineseOfficial/ChineseOfficialTerminology.js';
import { HONG_KONG_TERMINOLOGY } from '../../src/rules/hongkong/HongKongTerminology.js';
import { ChineseOfficialRules, CO_WIN_REFUSAL } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { MCR_FANS } from '../../src/rules/chineseOfficial/ChineseOfficialScoring.js';
import { WAIT_TYPE } from '../../src/rules/chineseOfficial/ChineseOfficialHandAnalysis.js';
import { BONUS_FACE_IDS } from '../../src/core/TileSetGenerator.js';

const T = CHINESE_OFFICIAL_TERMINOLOGY;
const isText = (x) => typeof x === 'string' && x.trim().length > 0;

section('1. General terms', () => {
  const shared = Object.keys(HONG_KONG_TERMINOLOGY).filter((k) => k !== 'chinese' && k !== 'limit');
  assert(shared.every((k) => isText(T[k])), `every shared key has an English term (${shared.filter((k) => !isText(T[k])).join(', ') || 'all'})`);
  const english = Object.keys(T).filter((k) => typeof T[k] === 'string');
  assert(english.every((k) => isText(T.chinese[k]) && isText(T.pinyin[k])), `every term has Chinese + pinyin (${english.filter((k) => !T.chinese[k] || !T.pinyin[k]).join(', ') || 'all'})`);
  assert(T.win === 'Hu' && T.chinese.win === '和' && T.chinese.minimumFan === '八番起和', 'MCR vocabulary (和, 八番起和)');
  assert(Object.isFrozen(T) && Object.isFrozen(T.chinese) && Object.isFrozen(T.pinyin), 'frozen');
  assert(getChineseOfficialTerminology() === T && new ChineseOfficialRules().getTerminology() === T, 'the engine returns this map');
});

section('2. In sync with the engine', () => {
  const ids = Object.keys(MCR_FANS);
  assert(Object.keys(CO_FAN_NAMES).length === 81 && ids.every((id) => CO_FAN_NAMES[id]), 'a name for each of the 81 fans');
  assert(ids.every((id) => CO_FAN_NAMES[id].name === MCR_FANS[id].name && CO_FAN_NAMES[id].chinese === MCR_FANS[id].chinese && CO_FAN_NAMES[id].points === MCR_FANS[id].points), 'English / Chinese names and points come from MCR_FANS');
  const noPinyin = ids.filter((id) => !isText(CO_FAN_NAMES[id].pinyin));
  assert(noPinyin.length === 0, `pinyin for every fan (${noPinyin.join(', ') || 'all'})`);
  const syllables = ids.filter((id) => (CO_FAN_NAMES[id].pinyin ?? '').split(' ').length !== [...CO_FAN_NAMES[id].chinese].length);
  assert(syllables.length === 0, `one pinyin syllable per character (${syllables.join(', ') || 'all'})`);
  assert(new Set(ids.map((id) => CO_FAN_NAMES[id].chinese)).size === 81, 'no two fans share a Chinese name');
  assert(['standard', 'seven-pairs', 'thirteen-orphans', 'honors-knitted', 'knitted-straight'].every((s) => CO_STRUCTURE_NAMES[s]?.name), 'every winning shape');
  assert(Object.values(WAIT_TYPE).every((w) => CO_WAIT_NAMES[w]?.name), 'every wait type');
  assert(Object.values(CO_WIN_REFUSAL).every((r) => CO_REFUSAL_NAMES[r]?.name), 'every refusal reason');
  assert(BONUS_FACE_IDS.every((id) => CO_FLOWER_NAMES[id]?.chinese) && Object.keys(CO_FLOWER_NAMES).length === BONUS_FACE_IDS.length, 'every flower / season');
});

section('3. Display helpers', () => {
  assert(getFanDisplayName('full-flush') === 'Full Flush', 'english by default');
  assert(getFanDisplayName('full-flush', { style: 'pinyin' }) === 'Qīng Yī Sè', 'pinyin');
  assert(getFanDisplayName('full-flush', { style: 'chinese' }) === '清一色', 'chinese');
  assert(getFanDisplayName('full-flush', { style: 'both' }) === 'Full Flush (清一色)', 'both');
  assert(getFanDisplayName('no-such-fan') === 'no-such-fan', 'unknown id → the id');
  assertThrows(() => getFanDisplayName('full-flush', { style: 'klingon' }), RangeError, 'unknown style');
  assert(formatFanLine({ id: 'full-flush', points: 24 }) === 'Full Flush (清一色) — 24', 'a breakdown line');
  assert(formatFanLine({ id: 'dragon-pung', points: 2, count: 2 }) === 'Dragon Pung (箭刻) ×2 — 4', 'a repeated fan');
  assert(formatFanLine({ id: 'flower-tiles' }) === 'Flower Tiles (花牌) — 1', 'points default from the table');
  assertThrows(() => formatFanLine(null), TypeError, 'needs a fan');
});

section('4. Through the engine', () => {
  const r = new ChineseOfficialRules({ minimumPoints: 0 });
  const specs = ['123d 456b 789c 111d EE', '19d 19b 19c ESWNRGH H', '147d 258b 369c 555c EE', '11d 33d 55d 77b 99b EE RR', 'RRR GGG 123d 456b 99c'];
  let shown = 0; let unknown = 0;
  for (const spec of specs) {
    const h = hand(spec);
    const v = r.validateWin(h, { winType: 'self', winningTile: h.concealedTiles[13], flowerCount: 2 });
    const s = r.scoreHand(h, { winType: 'self', winningTile: h.concealedTiles[13], flowerCount: 2 });
    for (const f of [...v.fans, ...s.breakdown]) { shown++; if (getFanDisplayName(f.id) === f.id) unknown++; }
    if (!CO_STRUCTURE_NAMES[v.structure]) unknown++;
  }
  assert(shown > 15 && unknown === 0, `every fan and structure a real score returns has a display name (${shown} lines)`);
});

summary();

/**
 * ChineseOfficialTerminology.js — display vocabulary for the Chinese Official
 * ruleset (Mahjong Competition Rules, "MCR" / Guobiao) — Task 96.
 *
 * English UI terms with the Chinese term (simplified characters + pinyin),
 * used by the UI and the rule reference (Task 114). Mirrors the Hong Kong and
 * Riichi terminology modules:
 *   CHINESE_OFFICIAL_TERMINOLOGY  general terms (RuleEngine#getTerminology())
 *   CO_FAN_NAMES                  every fan id → { name, pinyin, chinese, points }
 *                                 (English / Chinese names come from MCR_FANS —
 *                                 one source of truth; this module adds pinyin)
 *   CO_STRUCTURE_NAMES            winning shapes (standard, seven-pairs, …)
 *   CO_WAIT_NAMES                 edge / closed / single / open / pung / knitted / none
 *   CO_REFUSAL_NAMES              why a win was refused (CO_WIN_REFUSAL values)
 *   CO_FLOWER_NAMES               flower-1 … flower-4, season-1 … season-4
 *   getFanDisplayName(id, { style: 'english' | 'pinyin' | 'chinese' | 'both' })
 *   formatFanLine(fan)            "Full Flush (清一色) — 24"
 * Tests keep these tables in sync with MCR_FANS and the analysis module.
 */

import { MCR_FANS } from './ChineseOfficialScoring.js';

const term = (english, pinyin, chinese) => Object.freeze({ name: english, pinyin, chinese });

export const CHINESE_OFFICIAL_TERMINOLOGY = Object.freeze({
  // Calls and actions (keys shared with the other rulesets)
  chi: 'Chow',
  pon: 'Pung',
  kong: 'Kong',
  pair: 'Pair',
  win: 'Hu',
  selfDraw: 'Self-drawn',
  winByDiscard: 'Win by discard',
  concealedKong: 'Concealed Kong',
  addedKong: 'Added Kong',
  // Scoring
  fan: 'Fan',
  points: 'Points',
  minimumFan: 'Minimum 8 points',
  chickenHand: 'Chicken Hand',
  flower: 'Flower',
  flowerPoints: 'Flower points',
  basePayment: 'Base payment (8 points)',
  // Hand states / ends
  tenpai: 'Ready hand',
  exhaustiveDraw: 'Draw game',
  falseWin: 'False win',
  // Table
  dealer: 'Dealer',
  roundWind: 'Prevailing wind',
  seatWind: 'Seat wind',
  replacementTile: 'Replacement tile',
  chinese: Object.freeze({
    chi: '吃', pon: '碰', kong: '杠', pair: '将', win: '和', selfDraw: '自摸', winByDiscard: '点和',
    concealedKong: '暗杠', addedKong: '补杠', fan: '番', points: '分', flowerPoints: '花分', basePayment: '底分', minimumFan: '八番起和', chickenHand: '无番和',
    flower: '花牌', tenpai: '听牌', exhaustiveDraw: '荒庄', falseWin: '错和', dealer: '庄家',
    roundWind: '圈风', seatWind: '门风', replacementTile: '补花',
  }),
  pinyin: Object.freeze({
    chi: 'chī', pon: 'pèng', kong: 'gàng', pair: 'jiàng', win: 'hú', selfDraw: 'zì mō', winByDiscard: 'diǎn hú',
    concealedKong: 'àn gàng', addedKong: 'bǔ gàng', fan: 'fān', points: 'fēn', flowerPoints: 'huā fēn', basePayment: 'dǐ fēn', minimumFan: 'bā fān qǐ hú', chickenHand: 'wú fān hú',
    flower: 'huā pái', tenpai: 'tīng pái', exhaustiveDraw: 'huāng zhuāng', falseWin: 'cuò hú', dealer: 'zhuāng jiā',
    roundWind: 'quān fēng', seatWind: 'mén fēng', replacementTile: 'bǔ huā',
  }),
});

/** Pinyin for every MCR fan (tone marks). */
const FAN_PINYIN = Object.freeze({
  'big-four-winds': 'Dà Sì Xǐ', 'big-three-dragons': 'Dà Sān Yuán', 'all-green': 'Lǜ Yī Sè', 'nine-gates': 'Jiǔ Lián Bǎo Dēng',
  'four-kongs': 'Sì Gàng', 'seven-shifted-pairs': 'Lián Qī Duì', 'thirteen-orphans': 'Shí Sān Yāo',
  'all-terminals': 'Qīng Yāo Jiǔ', 'little-four-winds': 'Xiǎo Sì Xǐ', 'little-three-dragons': 'Xiǎo Sān Yuán', 'all-honors': 'Zì Yī Sè',
  'four-concealed-pungs': 'Sì Àn Kè', 'pure-terminal-chows': 'Yī Sè Shuāng Lóng Huì',
  'quadruple-chow': 'Yī Sè Sì Tóng Shùn', 'four-pure-shifted-pungs': 'Yī Sè Sì Jié Gāo',
  'four-pure-shifted-chows': 'Yī Sè Sì Bù Gāo', 'three-kongs': 'Sān Gàng', 'all-terminals-and-honors': 'Hùn Yāo Jiǔ',
  'seven-pairs': 'Qī Duì', 'greater-honors-knitted': 'Qī Xīng Bù Kào', 'all-even-pungs': 'Quán Shuāng Kè', 'full-flush': 'Qīng Yī Sè',
  'pure-triple-chow': 'Yī Sè Sān Tóng Shùn', 'pure-shifted-pungs': 'Yī Sè Sān Jié Gāo', 'upper-tiles': 'Quán Dà', 'middle-tiles': 'Quán Zhōng', 'lower-tiles': 'Quán Xiǎo',
  'pure-straight': 'Qīng Lóng', 'three-suited-terminal-chows': 'Sān Sè Shuāng Lóng Huì', 'pure-shifted-chows': 'Yī Sè Sān Bù Gāo',
  'all-fives': 'Quán Dài Wǔ', 'triple-pung': 'Sān Tóng Kè', 'three-concealed-pungs': 'Sān Àn Kè',
  'lesser-honors-knitted': 'Quán Bù Kào', 'knitted-straight': 'Zǔ Hé Lóng', 'upper-four': 'Dà Yú Wǔ', 'lower-four': 'Xiǎo Yú Wǔ', 'big-three-winds': 'Sān Fēng Kè',
  'mixed-straight': 'Huā Lóng', 'reversible-tiles': 'Tuī Bù Dǎo', 'mixed-triple-chow': 'Sān Sè Sān Tóng Shùn', 'mixed-shifted-pungs': 'Sān Sè Sān Jié Gāo',
  'chicken-hand': 'Wú Fān Hú', 'last-tile-draw': 'Miào Shǒu Huí Chūn', 'last-tile-claim': 'Hǎi Dǐ Lāo Yuè', 'out-with-replacement': 'Gàng Shàng Kāi Huā',
  'robbing-the-kong': 'Qiǎng Gàng Hú', 'two-concealed-kongs': 'Shuāng Àn Gàng',
  'all-pungs': 'Pèng Pèng Hú', 'half-flush': 'Hùn Yī Sè', 'mixed-shifted-chows': 'Sān Sè Sān Bù Gāo', 'all-types': 'Wǔ Mén Qí', 'melded-hand': 'Quán Qiú Rén', 'two-dragon-pungs': 'Shuāng Jiàn Kè',
  'outside-hand': 'Quán Dài Yāo', 'fully-concealed': 'Bù Qiú Rén', 'two-melded-kongs': 'Shuāng Míng Gàng', 'last-tile': 'Hú Jué Zhāng',
  'dragon-pung': 'Jiàn Kè', 'prevalent-wind': 'Quān Fēng Kè', 'seat-wind': 'Mén Fēng Kè', 'concealed-hand': 'Mén Qián Qīng', 'all-chows': 'Píng Hú',
  'tile-hog': 'Sì Guī Yī', 'double-pung': 'Shuāng Tóng Kè', 'two-concealed-pungs': 'Shuāng Àn Kè', 'concealed-kong': 'Àn Gàng', 'all-simples': 'Duàn Yāo',
  'pure-double-chow': 'Yī Bān Gāo', 'mixed-double-chow': 'Xǐ Xiāng Féng', 'short-straight': 'Lián Liù', 'two-terminal-chows': 'Lǎo Shào Fù',
  'pung-terminals-honors': 'Yāo Jiǔ Kè', 'melded-kong': 'Míng Gàng', 'one-voided-suit': 'Quē Yī Mén', 'no-honors': 'Wú Zì',
  'edge-wait': 'Biān Zhāng', 'closed-wait': 'Kǎn Zhāng', 'single-wait': 'Dān Diào Jiàng', 'self-drawn': 'Zì Mō', 'flower-tiles': 'Huā Pái',
});

/** Every fan id → { name, pinyin, chinese, points }. */
export const CO_FAN_NAMES = Object.freeze(Object.fromEntries(Object.values(MCR_FANS).map((f) => [
  f.id, Object.freeze({ name: f.name, pinyin: FAN_PINYIN[f.id], chinese: f.chinese, points: f.points }),
])));

/** Winning shapes (ChineseOfficialHandAnalysis#interpretWin `structure`). */
export const CO_STRUCTURE_NAMES = Object.freeze({
  standard: term('Standard hand', 'Pǔ Tōng Hú', '普通和'),
  'seven-pairs': term('Seven Pairs', 'Qī Duì', '七对'),
  'thirteen-orphans': term('Thirteen Orphans', 'Shí Sān Yāo', '十三幺'),
  'honors-knitted': term('Honors and Knitted Tiles', 'Bù Kào', '不靠'),
  'knitted-straight': term('Knitted Straight', 'Zǔ Hé Lóng', '组合龙'),
});

/** Wait types (ChineseOfficialHandAnalysis#WAIT_TYPE values). */
export const CO_WAIT_NAMES = Object.freeze({
  edge: term('Edge wait', 'Biān Zhāng', '边张'),
  closed: term('Closed wait', 'Kǎn Zhāng', '坎张'),
  single: term('Single wait', 'Dān Diào', '单钓'),
  open: term('Two-sided wait', 'Liǎng Miàn', '两面'),
  pung: term('Pung wait', 'Duì Dǎo', '对倒'),
  knitted: term('Knitted wait', 'Zǔ Hé Lóng', '组合龙'),
  none: term('No wait type', '—', '—'),
});

/** Why validateWin() refused (CO_WIN_REFUSAL values). */
export const CO_REFUSAL_NAMES = Object.freeze({
  incomplete: term('The hand is not complete', 'Bù Chéng Hú', '不成和'),
  'below-minimum': term('Fewer than 8 points (flowers do not count)', 'Bù Gòu Bā Fān', '不够八番'),
  'cannot-rob-concealed-kong': term('A concealed Kong cannot be robbed', 'Àn Gàng Bù Kě Qiǎng', '暗杠不可抢'),
});

/** Bonus tiles. */
export const CO_FLOWER_NAMES = Object.freeze({
  'flower-1': term('Plum', 'Méi', '梅'), 'flower-2': term('Orchid', 'Lán', '兰'),
  'flower-3': term('Chrysanthemum', 'Jú', '菊'), 'flower-4': term('Bamboo', 'Zhú', '竹'),
  'season-1': term('Spring', 'Chūn', '春'), 'season-2': term('Summer', 'Xià', '夏'),
  'season-3': term('Autumn', 'Qiū', '秋'), 'season-4': term('Winter', 'Dōng', '冬'),
});

const STYLES = Object.freeze(['english', 'pinyin', 'chinese', 'both']);

/**
 * Display name for a fan id.
 * @param {string} id
 * @param {{ style?: 'english'|'pinyin'|'chinese'|'both' }} [opts]  'both' = "Full Flush (清一色)"
 * @returns {string} the id itself when unknown
 */
export function getFanDisplayName(id, { style = 'english' } = {}) {
  if (!STYLES.includes(style)) throw new RangeError(`[ChineseOfficialTerminology] unknown style "${style}".`);
  const t = CO_FAN_NAMES[id];
  if (!t) return id;
  if (style === 'pinyin') return t.pinyin;
  if (style === 'chinese') return t.chinese;
  if (style === 'both') return `${t.name} (${t.chinese})`;
  return t.name;
}

/**
 * One breakdown line: "Full Flush (清一色) — 24", "Dragon Pung (箭刻) ×2 — 4".
 * @param {{ id: string, points: number, count?: number }} fan
 */
export function formatFanLine(fan) {
  if (!fan || typeof fan.id !== 'string') throw new TypeError('[ChineseOfficialTerminology] formatFanLine needs a fan with an id.');
  const count = Number.isInteger(fan.count) && fan.count > 1 ? fan.count : 1;
  const points = (fan.points ?? CO_FAN_NAMES[fan.id]?.points ?? 0) * count;
  return `${getFanDisplayName(fan.id, { style: 'both' })}${count > 1 ? ` ×${count}` : ''} — ${points}`;
}

export function getChineseOfficialTerminology() {
  return CHINESE_OFFICIAL_TERMINOLOGY;
}

/**
 * RiichiTerminology.js — display vocabulary for Riichi Mahjong (Task 87).
 *
 * English UI terms with the Japanese term (kanji + romaji), used by the UI
 * and the rule reference (Task 114). Mirrors HongKongTerminology.js:
 *   RIICHI_TERMINOLOGY     general terms (the RuleEngine#getTerminology() map)
 *   RIICHI_YAKU_NAMES      every yaku / yakuman / dora id → { name, romaji, japanese }
 *   RIICHI_LIMIT_NAMES     Mangan … Yakuman
 *   RIICHI_WAIT_NAMES      ryanmen … thirteen-sided
 *   RIICHI_ABORTIVE_DRAW_NAMES
 *   getYakuDisplayName(id, { style: 'english' | 'romaji' | 'japanese' })
 * Tests keep these tables in sync with RIICHI_YAKU / RIICHI_YAKUMAN.
 */

const term = (english, romaji, japanese) => Object.freeze({ name: english, romaji, japanese });

export const RIICHI_TERMINOLOGY = Object.freeze({
  // Calls and actions (keys shared with the other rulesets)
  chi: 'Chi',
  pon: 'Pon',
  kong: 'Kan',
  pair: 'Pair',
  win: 'Win',
  selfDraw: 'Tsumo',
  winByDiscard: 'Ron',
  tsumo: 'Tsumo',
  ron: 'Ron',
  riichi: 'Riichi',
  // Scoring
  han: 'Han',
  fu: 'Fu',
  // Task 101: the keys every ruleset shares — Riichi's equivalents (翻 han is the Japanese reading of 番 fan).
  fan: 'Han',
  minimumFan: 'One yaku minimum',
  chickenHand: 'No yaku (cannot win)',
  yaku: 'Yaku',
  yakuman: 'Yakuman',
  points: 'Points',
  dora: 'Dora',
  uraDora: 'Ura Dora',
  akaDora: 'Red Five',
  doraIndicator: 'Dora indicator',
  honba: 'Honba',
  riichiStick: 'Riichi stick',
  limit: 'Limit hand',
  // Hand states
  tenpai: 'Tenpai',
  noten: 'Noten',
  furiten: 'Furiten',
  // Hand ends
  exhaustiveDraw: 'Exhaustive draw',
  'abortive-draw': 'Abortive Draw',
  'nine-terminals': 'Nine Terminals',
  dealer: 'Dealer',
  dealerRepeat: 'Renchan',
  roundWind: 'Round wind',
  seatWind: 'Seat wind',
  deadWall: 'Dead wall',
  japanese: Object.freeze({
    chi: 'チー', pon: 'ポン', kong: 'カン', tsumo: 'ツモ', ron: 'ロン', riichi: 'リーチ',
    han: '翻', fu: '符', yaku: '役', yakuman: '役満', dora: 'ドラ', uraDora: '裏ドラ', akaDora: '赤ドラ',
    honba: '本場', tenpai: '聴牌', noten: '不聴', furiten: 'フリテン', dealer: '親', dealerRepeat: '連荘',
    deadWall: '王牌', exhaustiveDraw: '流局',
  }),
});

/** Every yaku / yakuman / dora id the engine reports. */
export const RIICHI_YAKU_NAMES = Object.freeze({
  // Task 82
  riichi: term('Riichi', 'Riichi', '立直'),
  'menzen-tsumo': term('Fully Concealed Hand', 'Menzen Tsumo', '門前清自摸和'),
  // Task 83
  pinfu: term('Pinfu', 'Pinfu', '平和'),
  tanyao: term('All Simples', 'Tanyao', '断幺九'),
  iipeikou: term('Pure Double Sequence', 'Iipeikou', '一盃口'),
  'yakuhai-white': term('White Dragon', 'Yakuhai Haku', '役牌 白'),
  'yakuhai-green': term('Green Dragon', 'Yakuhai Hatsu', '役牌 發'),
  'yakuhai-red': term('Red Dragon', 'Yakuhai Chun', '役牌 中'),
  'seat-wind': term('Seat Wind', 'Jikaze', '自風'),
  'round-wind': term('Round Wind', 'Bakaze', '場風'),
  chanta: term('Half Outside Hand', 'Chanta', '混全帯幺九'),
  ittsu: term('Pure Straight', 'Ittsu', '一気通貫'),
  'sanshoku-doujun': term('Mixed Triple Sequence', 'Sanshoku Doujun', '三色同順'),
  'sanshoku-doukou': term('Triple Triplets', 'Sanshoku Doukou', '三色同刻'),
  toitoi: term('All Triplets', 'Toitoi', '対々和'),
  sanankou: term('Three Concealed Triplets', 'Sanankou', '三暗刻'),
  sankantsu: term('Three Quads', 'Sankantsu', '三槓子'),
  chiitoitsu: term('Seven Pairs', 'Chiitoitsu', '七対子'),
  honroutou: term('All Terminals and Honours', 'Honroutou', '混老頭'),
  shousangen: term('Little Three Dragons', 'Shousangen', '小三元'),
  honitsu: term('Half Flush', 'Honitsu', '混一色'),
  junchan: term('Fully Outside Hand', 'Junchan', '純全帯幺九'),
  ryanpeikou: term('Twice Pure Double Sequence', 'Ryanpeikou', '二盃口'),
  chinitsu: term('Full Flush', 'Chinitsu', '清一色'),
  // Task 84 — situational
  'double-riichi': term('Double Riichi', 'Daburu Riichi', 'ダブル立直'),
  ippatsu: term('Ippatsu', 'Ippatsu', '一発'),
  haitei: term('Under the Sea', 'Haitei Raoyue', '海底摸月'),
  houtei: term('Under the River', 'Houtei Raoyui', '河底撈魚'),
  rinshan: term('After a Kan', 'Rinshan Kaihou', '嶺上開花'),
  chankan: term('Robbing a Kan', 'Chankan', '搶槓'),
  // Task 84 — yakuman
  kokushi: term('Thirteen Orphans', 'Kokushi Musou', '国士無双'),
  'kokushi-13': term('Thirteen Orphans (13-sided wait)', 'Kokushi Musou Juusanmen', '国士無双十三面'),
  suuankou: term('Four Concealed Triplets', 'Suuankou', '四暗刻'),
  'suuankou-tanki': term('Four Concealed Triplets (single wait)', 'Suuankou Tanki', '四暗刻単騎'),
  daisangen: term('Big Three Dragons', 'Daisangen', '大三元'),
  shousuushii: term('Little Four Winds', 'Shousuushii', '小四喜'),
  daisuushii: term('Big Four Winds', 'Daisuushii', '大四喜'),
  tsuuiisou: term('All Honours', 'Tsuuiisou', '字一色'),
  chinroutou: term('All Terminals', 'Chinroutou', '清老頭'),
  ryuuiisou: term('All Green', 'Ryuuiisou', '緑一色'),
  chuuren: term('Nine Gates', 'Chuuren Poutou', '九蓮宝燈'),
  'junsei-chuuren': term('Pure Nine Gates', 'Junsei Chuuren Poutou', '純正九蓮宝燈'),
  suukantsu: term('Four Quads', 'Suukantsu', '四槓子'),
  tenhou: term('Blessing of Heaven', 'Tenhou', '天和'),
  chiihou: term('Blessing of Earth', 'Chiihou', '地和'),
  // Dora (Tasks 85 / 88) and Nagashi Mangan (Task 86)
  dora: term('Dora', 'Dora', 'ドラ'),
  uraDora: term('Ura Dora', 'Ura Dora', '裏ドラ'),
  akaDora: term('Red Five', 'Aka Dora', '赤ドラ'),
  'nagashi-mangan': term('Nagashi Mangan', 'Nagashi Mangan', '流し満貫'),
});

export const RIICHI_LIMIT_NAMES = Object.freeze({
  mangan: term('Mangan', 'Mangan', '満貫'),
  haneman: term('Haneman', 'Haneman', '跳満'),
  baiman: term('Baiman', 'Baiman', '倍満'),
  sanbaiman: term('Sanbaiman', 'Sanbaiman', '三倍満'),
  'kazoe-yakuman': term('Counted Yakuman', 'Kazoe Yakuman', '数え役満'),
  yakuman: term('Yakuman', 'Yakuman', '役満'),
});

export const RIICHI_WAIT_NAMES = Object.freeze({
  ryanmen: term('Open wait', 'Ryanmen', '両面'),
  kanchan: term('Closed wait', 'Kanchan', '嵌張'),
  penchan: term('Edge wait', 'Penchan', '辺張'),
  shanpon: term('Dual pon wait', 'Shanpon', '双碰'),
  tanki: term('Pair wait', 'Tanki', '単騎'),
  'thirteen-sided': term('Thirteen-sided wait', 'Juusanmenmachi', '十三面待ち'),
  single: term('Single wait', 'Tanki', '単騎'),
});

export const RIICHI_ABORTIVE_DRAW_NAMES = Object.freeze({
  'nine-terminals': term('Nine Terminals', 'Kyuushu Kyuuhai', '九種九牌'),
  'four-winds': term('Four Winds', 'Suufon Renda', '四風連打'),
  'four-riichi': term('Four Riichi', 'Suucha Riichi', '四家立直'),
  'four-kans': term('Four Kans', 'Suukaikan', '四開槓'),
  'triple-ron': term('Triple Ron', 'Sanchahou', '三家和'),
});

/**
 * Display name for a yaku / yakuman / dora id.
 * @param {string} id
 * @param {{ style?: 'english'|'romaji'|'japanese' }} [opts]
 * @returns {string} the id itself when unknown
 */
export function getYakuDisplayName(id, { style = 'english' } = {}) {
  const t = RIICHI_YAKU_NAMES[id];
  if (!t) return id;
  if (style === 'romaji') return t.romaji;
  if (style === 'japanese') return t.japanese;
  return t.name;
}

export function getRiichiTerminology() {
  return RIICHI_TERMINOLOGY;
}

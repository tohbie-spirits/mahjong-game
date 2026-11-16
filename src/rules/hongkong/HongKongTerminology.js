/**
 * HongKongTerminology.js
 *
 * Display vocabulary for Hong Kong Mahjong (Task 26) — English names with the
 * traditional Cantonese/Chinese term, used by UI and the rule reference.
 *
 * REBUILT (after Task 77).
 */

export const HONG_KONG_TERMINOLOGY = Object.freeze({
  chi: 'Chow',
  pon: 'Pung',
  kong: 'Kong',
  pair: 'Eyes',
  win: 'Mahjong',
  selfDraw: 'Self-drawn',
  winByDiscard: 'Win by discard',
  fan: 'Fan',
  points: 'Points',
  minimumFan: 'Minimum fan',
  chickenHand: 'Chicken Hand',
  limit: 'Limit hand',
  exhaustiveDraw: 'Draw game',
  dealer: 'Dealer',
  roundWind: 'Prevailing wind',
  seatWind: 'Seat wind',
  chinese: Object.freeze({
    chi: '上', pon: '碰', kong: '槓', win: '食糊', selfDraw: '自摸', fan: '番',
  }),
});

/**
 * Fan pattern names: English + Chinese, keyed by HongKongScoring pattern id.
 */
export const HONG_KONG_PATTERN_NAMES = Object.freeze({
  'self-drawn': { name: 'Self-drawn', chinese: '自摸' },
  'concealed-hand': { name: 'Concealed Hand', chinese: '門前清' },
  'all-chows': { name: 'All Chows', chinese: '平糊' },
  'all-pungs': { name: 'All Pungs', chinese: '對對糊' },
  'mixed-one-suit': { name: 'Mixed One Suit', chinese: '混一色' },
  'pure-one-suit': { name: 'Pure One Suit', chinese: '清一色' },
  'dragon-pung': { name: 'Dragon Pung', chinese: '三元牌' },
  'seat-wind': { name: 'Seat Wind', chinese: '門風' },
  'round-wind': { name: 'Prevailing Wind', chinese: '圈風' },
  'small-three-dragons': { name: 'Small Three Dragons', chinese: '小三元' },
  'big-three-dragons': { name: 'Great Three Dragons', chinese: '大三元' },
  'small-four-winds': { name: 'Small Four Winds', chinese: '小四喜' },
  'big-four-winds': { name: 'Great Four Winds', chinese: '大四喜' },
  'all-honors': { name: 'All Honours', chinese: '字一色' },
  'all-terminals': { name: 'All Terminals', chinese: '清么九' },
  'thirteen-orphans': { name: 'Thirteen Orphans', chinese: '十三么' },
  'seven-pairs': { name: 'Seven Pairs', chinese: '七對子' },
  'last-tile': { name: 'Win on the Last Tile', chinese: '海底撈月' },
  'kong-replacement': { name: 'Win on a Kong Replacement', chinese: '槓上開花' },
  'chicken-hand': { name: 'Chicken Hand', chinese: '雞糊' },
});

export function getHongKongTerminology() {
  return HONG_KONG_TERMINOLOGY;
}

/**
 * ChineseOfficialScoring.js — the Chinese Official (MCR) point-combination
 * rule set.
 *
 * Task 93: the fan provider contract (below) and a starter set.
 * Task 94: the FULL TABLE of the 81 MCR fans (points, names, exclusions)
 * and the detection of every fan worth 12 points or more, with the
 * combination machinery for chow and pung groups.
 * Task 95 (this version): every fan worth 8 points and less — situational
 * (Last Tile Draw / Claim, Out with Replacement, Robbing the Kong, Last
 * Tile, Self-Drawn), wait fans, kong / concealed-pung counts, honour pungs,
 * suit and tile fans, the pair relations between chows / pungs under the
 * account-once rule, and Chicken Hand — so all 80 fans are detected
 * (Flower Tiles is added by the engine).
 *
 * ── Fan provider contract ──────────────────────────────────────────────
 *   provider({ interpretation, hand, counts, melds, kindOf, context }) → fans[]
 *     interpretation  one ChineseOfficialHandAnalysis#interpretWin entry
 *     hand            the complete Hand (winning tile included)
 *     counts          34-slot counts of the concealed standard tiles
 *     melds           hand.melds
 *     kindOf          faceId → kind (ChineseOfficialHandAnalysis#kindOfFaceId)
 *     context         the scoring context (winType, winningTile, seatWind,
 *                     roundWind, isLastTile, isKongReplacement, isRobbingKong,
 *                     isLastCopy, flowerCount, …)
 *   fans: [{ id, name, points }] — a fan counted twice appears twice. FLOWERS
 *   ARE NOT FANS: the engine adds them after the minimum check. The engine
 *   evaluates every interpretation and keeps the highest total (MCR: the
 *   arrangement worth the most points is the one scored).
 *
 * ── Combination rules implemented ──────────────────────────────────────
 *   NON-REPEAT: a fan's `excludes` are not counted when it is (e.g. Full
 *   Flush excludes No Honors). Applied highest fan first; a fan removed by
 *   exclusion doesn't exclude anything itself.
 *   NON-SEPARATION / NON-IDENTICAL for set groups: chows (pungs) combined
 *   into a three- or four-set fan are used up by it; the best way of
 *   grouping the sets is chosen (every grouping is tried).
 *   ACCOUNT ONCE (一次组合原则) for the pair relations (Pure / Mixed Double
 *   Chow, Short Straight, Two Terminal Chows, Double Pung): the counted
 *   relations form a spanning forest over the sets — no cycles, so n sets
 *   give at most n − 1 of them, and sets already used up by a three-set fan
 *   act as one set (the fourth chow relates to that group once).
 *   Wind pungs that carry a wind fan (seat / prevalent / Big Three Winds /
 *   Little or Big Four Winds) are not also Pungs of Terminals or Honors, and
 *   dragon pungs never are.
 *   WAIT FANS (Edge / Closed / Single Wait) count only when the hand was
 *   waiting on exactly one kind of tile.
 *   CHICKEN HAND: 8 points when nothing else scores (flowers aside).
 *   Concealed Hand / Fully Concealed Hand apply to standard and Knitted
 *   Straight hands; the special shapes (Seven Pairs, Thirteen Orphans,
 *   Honors and Knitted) exclude Concealed Hand and simply count Self-Drawn.
 */

import { HONOR_START, findWaits } from './ChineseOfficialHandAnalysis.js';

const SUIT_SIZE = 9;
const WIND_KIND = Object.freeze({ east: 27, south: 28, west: 29, north: 30 });
const DRAGON_KINDS = Object.freeze([31, 32, 33]);
const WIND_KINDS = Object.freeze([27, 28, 29, 30]);
const GREEN_KINDS = Object.freeze([10, 11, 12, 14, 16, 32]);              // 2 3 4 6 8 bamboo + green dragon
const REVERSIBLE_KINDS = Object.freeze([0, 1, 2, 3, 4, 7, 8, 10, 12, 13, 14, 16, 17, 33]); // 1234589 dots, 245689 bamboo, white

const suitOf = (k) => (k < HONOR_START ? Math.floor(k / SUIT_SIZE) : -1);
const numOf = (k) => (k < HONOR_START ? (k % SUIT_SIZE) + 1 : 0);
const isTerminal = (k) => k < HONOR_START && (numOf(k) === 1 || numOf(k) === 9);
const isHonor = (k) => k >= HONOR_START;
const isTermOrHonor = (k) => isHonor(k) || isTerminal(k);

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * The 81 MCR fans: id → { id, name, chinese, points, excludes[] }.
 * `excludes` lists the fans not counted with it (the rulebook's 不计).
 */
const T = [
  // 88
  ['big-four-winds', 'Big Four Winds', '大四喜', 88, ['big-three-winds', 'all-pungs', 'seat-wind', 'prevalent-wind', 'little-four-winds']],
  ['big-three-dragons', 'Big Three Dragons', '大三元', 88, ['dragon-pung', 'two-dragon-pungs', 'little-three-dragons']],
  ['all-green', 'All Green', '绿一色', 88, ['half-flush']],
  ['nine-gates', 'Nine Gates', '九莲宝灯', 88, ['full-flush', 'concealed-hand', 'fully-concealed', 'pung-terminals-honors', 'no-honors']],
  ['four-kongs', 'Four Kongs', '四杠', 88, ['three-kongs', 'two-melded-kongs', 'two-concealed-kongs', 'melded-kong', 'concealed-kong', 'single-wait', 'all-pungs']],
  ['seven-shifted-pairs', 'Seven Shifted Pairs', '连七对', 88, ['seven-pairs', 'full-flush', 'concealed-hand', 'single-wait', 'no-honors']],
  ['thirteen-orphans', 'Thirteen Orphans', '十三幺', 88, ['all-types', 'concealed-hand', 'single-wait']],
  // 64
  ['all-terminals', 'All Terminals', '清幺九', 64, ['all-pungs', 'outside-hand', 'pung-terminals-honors', 'no-honors', 'all-terminals-and-honors', 'double-pung']],
  ['little-four-winds', 'Little Four Winds', '小四喜', 64, ['big-three-winds']],
  ['little-three-dragons', 'Little Three Dragons', '小三元', 64, ['dragon-pung', 'two-dragon-pungs']],
  ['all-honors', 'All Honors', '字一色', 64, ['all-pungs', 'outside-hand', 'pung-terminals-honors', 'all-terminals-and-honors']],
  ['four-concealed-pungs', 'Four Concealed Pungs', '四暗刻', 64, ['all-pungs', 'concealed-hand', 'three-concealed-pungs', 'two-concealed-pungs']],
  ['pure-terminal-chows', 'Pure Terminal Chows', '一色双龙会', 64, ['full-flush', 'seven-pairs', 'all-chows', 'pure-double-chow', 'two-terminal-chows', 'no-honors']],
  // 48
  ['quadruple-chow', 'Quadruple Chow', '一色四同顺', 48, ['pure-triple-chow', 'pure-double-chow', 'tile-hog', 'pure-shifted-pungs']],
  ['four-pure-shifted-pungs', 'Four Pure Shifted Pungs', '一色四节高', 48, ['pure-shifted-pungs', 'all-pungs', 'pure-triple-chow']],
  // 32
  ['four-pure-shifted-chows', 'Four Pure Shifted Chows', '一色四步高', 32, ['pure-shifted-chows', 'short-straight', 'two-terminal-chows']],
  ['three-kongs', 'Three Kongs', '三杠', 32, ['two-melded-kongs', 'two-concealed-kongs', 'melded-kong', 'concealed-kong']],
  ['all-terminals-and-honors', 'All Terminals and Honors', '混幺九', 32, ['all-pungs', 'outside-hand', 'pung-terminals-honors']],
  // 24
  ['seven-pairs', 'Seven Pairs', '七对', 24, ['concealed-hand', 'single-wait']],
  ['greater-honors-knitted', 'Greater Honors and Knitted Tiles', '七星不靠', 24, ['lesser-honors-knitted', 'concealed-hand', 'all-types', 'single-wait']],
  ['all-even-pungs', 'All Even Pungs', '全双刻', 24, ['all-pungs', 'all-simples', 'no-honors']],
  ['full-flush', 'Full Flush', '清一色', 24, ['no-honors']],
  ['pure-triple-chow', 'Pure Triple Chow', '一色三同顺', 24, ['pure-shifted-pungs', 'pure-double-chow']],
  ['pure-shifted-pungs', 'Pure Shifted Pungs', '一色三节高', 24, ['pure-triple-chow']],
  ['upper-tiles', 'Upper Tiles', '全大', 24, ['upper-four', 'no-honors']],
  ['middle-tiles', 'Middle Tiles', '全中', 24, ['all-simples', 'no-honors']],
  ['lower-tiles', 'Lower Tiles', '全小', 24, ['lower-four', 'no-honors']],
  // 16
  ['pure-straight', 'Pure Straight', '清龙', 16, ['short-straight', 'two-terminal-chows']],
  ['three-suited-terminal-chows', 'Three-Suited Terminal Chows', '三色双龙会', 16, ['all-chows', 'two-terminal-chows', 'no-honors', 'mixed-double-chow']],
  ['pure-shifted-chows', 'Pure Shifted Chows', '一色三步高', 16, []],
  ['all-fives', 'All Fives', '全带五', 16, ['all-simples']],
  ['triple-pung', 'Triple Pung', '三同刻', 16, ['double-pung']],
  ['three-concealed-pungs', 'Three Concealed Pungs', '三暗刻', 16, ['two-concealed-pungs']],
  // 12
  ['lesser-honors-knitted', 'Lesser Honors and Knitted Tiles', '全不靠', 12, ['concealed-hand', 'all-types', 'single-wait']],
  ['knitted-straight', 'Knitted Straight', '组合龙', 12, []],
  ['upper-four', 'Upper Four', '大于五', 12, ['no-honors']],
  ['lower-four', 'Lower Four', '小于五', 12, ['no-honors']],
  ['big-three-winds', 'Big Three Winds', '三风刻', 12, []],
  // 8
  ['mixed-straight', 'Mixed Straight', '花龙', 8, []],
  ['reversible-tiles', 'Reversible Tiles', '推不倒', 8, ['one-voided-suit']],
  ['mixed-triple-chow', 'Mixed Triple Chow', '三色三同顺', 8, ['mixed-double-chow']],
  ['mixed-shifted-pungs', 'Mixed Shifted Pungs', '三色三节高', 8, []],
  ['chicken-hand', 'Chicken Hand', '无番和', 8, []],
  ['last-tile-draw', 'Last Tile Draw', '妙手回春', 8, ['self-drawn']],
  ['last-tile-claim', 'Last Tile Claim', '海底捞月', 8, []],
  ['out-with-replacement', 'Out with Replacement Tile', '杠上开花', 8, ['self-drawn']],
  ['robbing-the-kong', 'Robbing the Kong', '抢杠和', 8, ['last-tile']],
  ['two-concealed-kongs', 'Two Concealed Kongs', '双暗杠', 8, ['concealed-kong']],
  // 6
  ['all-pungs', 'All Pungs', '碰碰和', 6, []],
  ['half-flush', 'Half Flush', '混一色', 6, []],
  ['mixed-shifted-chows', 'Mixed Shifted Chows', '三色三步高', 6, []],
  ['all-types', 'All Types', '五门齐', 6, []],
  ['melded-hand', 'Melded Hand', '全求人', 6, ['single-wait']],
  ['two-dragon-pungs', 'Two Dragon Pungs', '双箭刻', 6, ['dragon-pung']],
  // 4
  ['outside-hand', 'Outside Hand', '全带幺', 4, []],
  ['fully-concealed', 'Fully Concealed Hand', '不求人', 4, ['self-drawn', 'concealed-hand']],
  ['two-melded-kongs', 'Two Melded Kongs', '双明杠', 4, ['melded-kong']],
  ['last-tile', 'Last Tile', '和绝张', 4, []],
  // 2
  ['dragon-pung', 'Dragon Pung', '箭刻', 2, []],
  ['prevalent-wind', 'Prevalent Wind', '圈风刻', 2, []],
  ['seat-wind', 'Seat Wind', '门风刻', 2, []],
  ['concealed-hand', 'Concealed Hand', '门前清', 2, []],
  ['all-chows', 'All Chows', '平和', 2, ['no-honors']],
  ['tile-hog', 'Tile Hog', '四归一', 2, []],
  ['double-pung', 'Double Pung', '双同刻', 2, []],
  ['two-concealed-pungs', 'Two Concealed Pungs', '双暗刻', 2, []],
  ['concealed-kong', 'Concealed Kong', '暗杠', 2, []],
  ['all-simples', 'All Simples', '断幺', 2, ['no-honors']],
  // 1
  ['pure-double-chow', 'Pure Double Chow', '一般高', 1, []],
  ['mixed-double-chow', 'Mixed Double Chow', '喜相逢', 1, []],
  ['short-straight', 'Short Straight', '连六', 1, []],
  ['two-terminal-chows', 'Two Terminal Chows', '老少副', 1, []],
  ['pung-terminals-honors', 'Pung of Terminals or Honors', '幺九刻', 1, []],
  ['melded-kong', 'Melded Kong', '明杠', 1, []],
  ['one-voided-suit', 'One Voided Suit', '缺一门', 1, []],
  ['no-honors', 'No Honors', '无字', 1, []],
  ['edge-wait', 'Edge Wait', '边张', 1, []],
  ['closed-wait', 'Closed Wait', '坎张', 1, []],
  ['single-wait', 'Single Wait', '单钓将', 1, []],
  ['self-drawn', 'Self-Drawn', '自摸', 1, []],
  ['flower-tiles', 'Flower Tiles', '花牌', 1, []],
];

export const MCR_FANS = Object.freeze(Object.fromEntries(T.map(([id, name, chinese, points, excludes]) => [
  id, Object.freeze({ id, name, chinese, points, excludes: Object.freeze(excludes) }),
])));

/** Fan ids in table order. */
const FAN_ORDER = Object.freeze(T.map((r) => r[0]));

/** Points per flower / season tile (added after the minimum check). */
export const FLOWER_POINTS = MCR_FANS['flower-tiles'].points;

/** Fan ids detected by detectFans (all but Flower Tiles, which the engine adds). */
export const DETECTED_FAN_IDS = Object.freeze(Object.values(MCR_FANS).filter((f) => f.id !== 'flower-tiles').map((f) => f.id));

// ---------------------------------------------------------------------------
// The hand model
// ---------------------------------------------------------------------------

/**
 * Builds the model one interpretation is scored on.
 *   sets: [{ type: 'chow'|'pung', kind, kong: bool, melded: bool, concealed: bool }]
 *         (a pung's `concealed` = concealed pung for the Concealed Pungs fans;
 *          a Pung completed by a discard is not)
 *   pair: kind | null; kinds: every standard tile's kind (kongs give 4)
 */
export function buildModel({ interpretation, counts, melds = [], kindOf, context = {} }) {
  const kinds = [];
  for (let k = 0; k < counts.length; k++) for (let i = 0; i < counts[k]; i++) kinds.push(k);
  const sets = [];
  const ron = context.winType === 'discard';
  (interpretation.sets ?? []).forEach((s, i) => {
    sets.push({ type: s.type, kind: s.kind, kong: false, melded: false, concealed: s.type === 'pung' && !(ron && interpretation.winningPart === i) });
  });
  for (const m of melds) {
    const mk = m.tiles.map((t) => kindOf(t.id));
    kinds.push(...mk);
    if (m.type === 'chi') sets.push({ type: 'chow', kind: Math.min(...mk), kong: false, melded: true, concealed: false });
    else sets.push({ type: 'pung', kind: mk[0], kong: m.type === 'kong', melded: !m.concealed, concealed: m.concealed === true });
  }
  return {
    structure: interpretation.structure,
    interpretation,
    sets,
    chows: sets.filter((s) => s.type === 'chow'),
    pungs: sets.filter((s) => s.type === 'pung'),
    pair: interpretation.pair ?? null,
    kinds,
    counts,
    melds,
    isClosed: melds.every((m) => m.concealed),
  };
}

// ---------------------------------------------------------------------------
// Set-group combinations (chows / pungs)
// ---------------------------------------------------------------------------

const sameSuit = (xs) => xs.every((s) => suitOf(s.kind) === suitOf(xs[0].kind) && suitOf(s.kind) >= 0);
const distinctSuits = (xs) => new Set(xs.map((s) => suitOf(s.kind))).size === xs.length && xs.every((s) => suitOf(s.kind) >= 0);
const nums = (xs) => xs.map((s) => numOf(s.kind)).sort((a, b) => a - b);
const stepBy = (ns, d) => ns.every((n, i) => i === 0 || n - ns[i - 1] === d);

/** Three-chow fans, best first. Each: (chows[3]) → boolean. Task 95 adds the 8 / 6 point ones. */
export const THREE_CHOW_FANS = [
  ['pure-triple-chow', (c) => sameSuit(c) && stepBy(nums(c), 0)],
  ['pure-straight', (c) => sameSuit(c) && nums(c).join() === '1,4,7'],
  ['pure-shifted-chows', (c) => sameSuit(c) && (stepBy(nums(c), 1) || stepBy(nums(c), 2))],
  ['mixed-straight', (c) => distinctSuits(c) && nums(c).join() === '1,4,7'],
  ['mixed-triple-chow', (c) => distinctSuits(c) && stepBy(nums(c), 0)],
  ['mixed-shifted-chows', (c) => distinctSuits(c) && stepBy(nums(c), 1)],
];

/** Three-pung fans, best first. */
export const THREE_PUNG_FANS = [
  ['pure-shifted-pungs', (p) => sameSuit(p) && stepBy(nums(p), 1)],
  ['triple-pung', (p) => distinctSuits(p) && stepBy(nums(p), 0)],
  ['mixed-shifted-pungs', (p) => distinctSuits(p) && stepBy(nums(p), 1)],
];

/** Pair-relation fans between two chows / two pungs (Task 95). Each: (a, b) → fan id | null. */
export const CHOW_PAIR_FANS = [
  (a, b) => {
    const sa = suitOf(a.kind); const sb = suitOf(b.kind); const na = numOf(a.kind); const nb = numOf(b.kind);
    if (sa === sb && na === nb) return 'pure-double-chow';
    if (sa !== sb && na === nb) return 'mixed-double-chow';
    if (sa === sb && Math.abs(na - nb) === 3) return 'short-straight';
    if (sa === sb && Math.min(na, nb) === 1 && Math.max(na, nb) === 7) return 'two-terminal-chows';
    return null;
  },
];
export const PUNG_PAIR_FANS = [
  (a, b) => (suitOf(a.kind) >= 0 && suitOf(b.kind) >= 0 && suitOf(a.kind) !== suitOf(b.kind) && numOf(a.kind) === numOf(b.kind) ? 'double-pung' : null),
];

function subsets3(xs) {
  const out = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) for (let k = j + 1; k < xs.length; k++) out.push([i, j, k]);
  return out;
}

/**
 * Best grouping of a set list: an optional four-set fan, or an optional
 * three-set fan whose sets are then one unit, plus pair-relation fans as a
 * spanning forest over the units (account once: no cycles — Task 95).
 * @returns {string[]} fan ids
 */
function bestGrouping(sets, { four = [], three = [], pairFans = [] }) {
  const options = [];
  const forest = (units) => {
    // units: arrays of set indexes; union-find over units, edges = best pair fan between any two members.
    const parent = units.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const out = [];
    const edges = [];
    for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
      let best = null;
      for (const ia of units[a]) for (const ib of units[b]) {
        for (const f of pairFans) { const id = f(sets[ia], sets[ib]); if (id && (!best || MCR_FANS[id].points > MCR_FANS[best].points)) best = id; }
      }
      if (best) edges.push([a, b, best]);
    }
    // Higher points first; on a tie, the fan listed first in the table (Pure before Mixed Double Chow).
    edges.sort((x, y) => MCR_FANS[y[2]].points - MCR_FANS[x[2]].points || FAN_ORDER.indexOf(x[2]) - FAN_ORDER.indexOf(y[2]));
    for (const [a, b, id] of edges) { const ra = find(a); const rb = find(b); if (ra !== rb) { parent[ra] = rb; out.push(id); } }
    return out;
  };
  const singles = sets.map((_, i) => [i]);
  options.push(forest(singles));
  if (sets.length === 4) {
    for (const [id, test] of four) if (test(sets)) { options.push([id]); break; }
  }
  for (const idx of subsets3(sets)) {
    const trio = idx.map((i) => sets[i]);
    const hit = three.find(([, test]) => test(trio));
    if (!hit) continue;
    const rest = sets.map((_, i) => i).filter((i) => !idx.includes(i)).map((i) => [i]);
    options.push([hit[0], ...forest([idx, ...rest])]);
  }
  const value = (ids) => ids.reduce((s, id) => s + MCR_FANS[id].points, 0);
  return options.reduce((a, b) => (value(b) > value(a) ? b : a), []);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Kind of a wind given as a WIND object ({ id }) or a face id / id string. */
export const windKind = (w) => (w && typeof w === 'object' ? WIND_KIND[w.id] : typeof w === 'string' ? WIND_KIND[w.replace(/^wind-/, '')] : undefined);

/** Raw fans of one model (before exclusions). @returns {string[]} ids, repeated when counted twice */
export function rawFans(model, context = {}) {
  const out = [];
  const add = (id, n = 1) => { for (let i = 0; i < n; i++) out.push(id); };
  const { structure, sets, chows, pungs, pair, kinds } = model;
  const standardLike = structure === 'standard' || structure === 'knitted-straight';
  const has = (pred) => kinds.some(pred);
  const all = (pred) => kinds.every(pred);

  // ── Shape fans ─────────────────────────────────────────────────────────
  if (structure === 'thirteen-orphans') add('thirteen-orphans');
  if (structure === 'seven-pairs') {
    const ks = [...new Set(kinds)].sort((a, b) => a - b);
    if (ks.length === 7 && sameSuit(ks.map((kind) => ({ kind }))) && ks.every((k, i) => i === 0 || k - ks[i - 1] === 1)) add('seven-shifted-pairs');
    else add('seven-pairs');
  }
  if (structure === 'honors-knitted') add(model.interpretation.greater ? 'greater-honors-knitted' : 'lesser-honors-knitted');
  if (structure === 'knitted-straight') add('knitted-straight');

  // ── Tile fans ──────────────────────────────────────────────────────────
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  const honors = has(isHonor);
  if (all((k) => GREEN_KINDS.includes(k))) add('all-green');
  // All Terminals / All Honors / All Terminals and Honors are pung (or pair) hands:
  // standard or Seven Pairs — never Thirteen Orphans.
  if (structure === 'standard' || structure === 'seven-pairs') {
    if (all(isTerminal)) add('all-terminals');
    else if (all(isHonor)) add('all-honors');
    else if (all(isTermOrHonor)) add('all-terminals-and-honors');
  }
  if (!honors && suits.size === 1) add('full-flush');
  if (!honors) {
    const ns = kinds.map(numOf);
    if (ns.every((n) => n >= 7)) add('upper-tiles');
    else if (ns.every((n) => n >= 4 && n <= 6)) add('middle-tiles');
    else if (ns.every((n) => n <= 3)) add('lower-tiles');
    else if (ns.every((n) => n >= 6)) add('upper-four');
    else if (ns.every((n) => n <= 4)) add('lower-four');
  }

  // Nine Gates: closed, one suit, the 13 tiles before the win are 1112345678999.
  if (structure === 'standard' && model.melds.length === 0 && !honors && suits.size === 1 && context.winningTile) {
    const base = [...suits][0] * SUIT_SIZE;
    const before = model.counts.slice(base, base + SUIT_SIZE);
    const wk = model.kindOf(context.winningTile.id);
    before[wk - base]--;
    if (before.join() === '3,1,1,1,1,1,1,1,3') add('nine-gates');
  }

  if (!standardLike) return out;

  // ── Pung / kong fans ───────────────────────────────────────────────────
  const windPungs = pungs.filter((p) => WIND_KINDS.includes(p.kind));
  const dragonPungs = pungs.filter((p) => DRAGON_KINDS.includes(p.kind));
  const pairWind = pair !== null && WIND_KINDS.includes(pair);
  const pairDragon = pair !== null && DRAGON_KINDS.includes(pair);
  if (windPungs.length === 4) add('big-four-winds');
  else if (windPungs.length === 3 && pairWind) add('little-four-winds');
  else if (windPungs.length === 3) add('big-three-winds');
  if (dragonPungs.length === 3) add('big-three-dragons');
  else if (dragonPungs.length === 2 && pairDragon) add('little-three-dragons');

  const kongs = pungs.filter((p) => p.kong);
  if (kongs.length === 4) add('four-kongs');
  else if (kongs.length === 3) add('three-kongs');

  const concealedPungs = pungs.filter((p) => p.concealed).length;
  if (concealedPungs === 4) add('four-concealed-pungs');
  else if (concealedPungs === 3) add('three-concealed-pungs');

  if (pungs.length === 4 && pair !== null && [...pungs.map((p) => p.kind), pair].every((k) => !isHonor(k) && numOf(k) % 2 === 0)) add('all-even-pungs');
  if (sets.length === 4 && pair !== null && [...sets.map((s) => s.type === 'chow' ? [s.kind, s.kind + 1, s.kind + 2] : [s.kind]), [pair]].every((g) => g.some((k) => !isHonor(k) && numOf(k) === 5))) add('all-fives');

  // ── Chow groups (four-chow fans, three-chow fans, Task 95 pair relations) ──
  if (structure === 'standard') {
    const four = [
      ['pure-terminal-chows', (c) => sameSuit(c) && nums(c).join() === '1,1,7,7' && pair !== null && suitOf(pair) === suitOf(c[0].kind) && numOf(pair) === 5],
      ['quadruple-chow', (c) => sameSuit(c) && stepBy(nums(c), 0)],
      ['four-pure-shifted-chows', (c) => sameSuit(c) && (stepBy(nums(c), 1) || stepBy(nums(c), 2))],
      ['three-suited-terminal-chows', (c) => {
        if (pair === null || isHonor(pair) || numOf(pair) !== 5) return false;
        const bySuit = new Map();
        for (const s of c) bySuit.set(suitOf(s.kind), [...(bySuit.get(suitOf(s.kind)) ?? []), numOf(s.kind)]);
        return bySuit.size === 2 && [...bySuit.values()].every((ns) => ns.sort().join() === '1,7') && !bySuit.has(suitOf(pair));
      }],
    ];
    for (const id of bestGrouping(chows, { four, three: THREE_CHOW_FANS, pairFans: CHOW_PAIR_FANS })) add(id);
  }
  for (const id of bestGrouping(pungs, { four: [['four-pure-shifted-pungs', (p) => sameSuit(p) && stepBy(nums(p), 1)]], three: THREE_PUNG_FANS, pairFans: PUNG_PAIR_FANS })) add(id);

  // ── Task 95: sets, honours, kongs ───────────────────────────────────────
  if (structure === 'standard' && pungs.length === 4) add('all-pungs');
  if (structure === 'standard' && chows.length === 4 && pair !== null && !isHonor(pair)) add('all-chows');
  if (structure === 'standard' && [...sets.map((x) => (x.type === 'chow' ? [x.kind, x.kind + 2] : [x.kind])), [pair]].every((g) => g.some(isTermOrHonor))) add('outside-hand');
  if (dragonPungs.length === 2) add('two-dragon-pungs');
  add('dragon-pung', dragonPungs.length);
  const seat = windKind(context.seatWind); const prevalent = windKind(context.roundWind);
  if (seat !== undefined && windPungs.some((p) => p.kind === seat)) add('seat-wind');
  if (prevalent !== undefined && windPungs.some((p) => p.kind === prevalent)) add('prevalent-wind');
  const windGroup = windPungs.length >= 3;
  add('pung-terminals-honors', pungs.filter((p) => isTerminal(p.kind) || (WIND_KINDS.includes(p.kind) && !windGroup && p.kind !== seat && p.kind !== prevalent)).length);
  if (concealedPungs === 2) add('two-concealed-pungs');
  if (kongs.length === 2 || kongs.length === 1) {
    const hidden = kongs.filter((p) => !p.melded).length;
    if (kongs.length === 2 && hidden === 2) add('two-concealed-kongs');
    else if (kongs.length === 2 && hidden === 0) add('two-melded-kongs');
    else { add('concealed-kong', hidden); add('melded-kong', kongs.length - hidden); }
  }
  const exposed = model.melds.filter((m) => !m.concealed);
  if (exposed.length === 4 && model.melds.length === 4 && context.winType === 'discard') add('melded-hand');

  return out;
}

/** Task 95 — fans that don't depend on the set structure (any shape). */
function generalFans(model, context, add) {
  const { structure, kinds, sets } = model;
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  const hasHonor = kinds.some(isHonor);
  if (kinds.every((k) => REVERSIBLE_KINDS.includes(k))) add('reversible-tiles');
  if (suits.size === 1 && hasHonor) add('half-flush');
  if (suits.size === 3 && kinds.some((k) => WIND_KINDS.includes(k)) && kinds.some((k) => DRAGON_KINDS.includes(k))) add('all-types');
  if (suits.size === 2) add('one-voided-suit');
  if (!hasHonor) add('no-honors');
  if (kinds.every((k) => !isTermOrHonor(k))) add('all-simples');
  // Tile Hog: all four copies of a kind used, not as a Kong.
  const total = new Array(34).fill(0);
  for (const k of kinds) total[k]++;
  const kongKinds = new Set(sets.filter((x) => x.kong).map((x) => x.kind));
  add('tile-hog', total.filter((v, k) => v === 4 && !kongKinds.has(k)).length);

  // Concealment + self-draw.
  const self = context.winType === 'self';
  const closed = model.melds.every((m) => m.concealed);
  const regular = structure === 'standard' || structure === 'knitted-straight';
  if (regular && closed && self) add('fully-concealed');
  else if (regular && closed && !self) add('concealed-hand');
  if (self) add('self-drawn');

  // Situational.
  if (context.isLastTile && self) add('last-tile-draw');
  if (context.isLastTile && !self) add('last-tile-claim');
  if (context.isKongReplacement && self) add('out-with-replacement');
  if (context.isRobbingKong) add('robbing-the-kong');
  if (context.isLastCopy) add('last-tile');

  // Waits — only when the hand waited on exactly one kind.
  const w = model.interpretation.wait;
  if ((w === 'edge' || w === 'closed' || w === 'single') && context.winningTile) {
    const before = model.counts.slice();
    before[model.kindOf(context.winningTile.id)]--;
    if (findWaits(before, model.melds.length).length === 1) add(w === 'edge' ? 'edge-wait' : w === 'closed' ? 'closed-wait' : 'single-wait');
  }
}

/**
 * Applies the non-repeat rule: highest fans first; a counted fan's
 * `excludes` are dropped; a dropped fan excludes nothing.
 * @param {string[]} ids
 * @returns {string[]}
 */
export function applyExclusions(ids) {
  const sorted = ids.slice().sort((a, b) => MCR_FANS[b].points - MCR_FANS[a].points);
  const excluded = new Set();
  const out = [];
  for (const id of sorted) {
    if (excluded.has(id)) continue;
    out.push(id);
    for (const x of MCR_FANS[id].excludes) excluded.add(x);
  }
  return out;
}

/**
 * The fan provider (contract above).
 * @returns {{ id: string, name: string, points: number }[]}
 */
export function detectFans(input) {
  const { interpretation, counts, melds = [], kindOf, context = {} } = input;
  if (!interpretation || !Array.isArray(counts) || typeof kindOf !== 'function') {
    throw new TypeError('[ChineseOfficialScoring] detectFans needs { interpretation, counts, melds, kindOf }.');
  }
  const model = { ...buildModel({ interpretation, counts, melds, kindOf, context }), kindOf };
  const raw = rawFans(model, context);
  generalFans(model, context, (id, n = 1) => { for (let i = 0; i < n; i++) raw.push(id); });
  let ids = applyExclusions(raw);
  if (ids.length === 0) ids = ['chicken-hand'];
  return ids.map((id) => ({ id, name: MCR_FANS[id].name, points: MCR_FANS[id].points }));
}


// ---------------------------------------------------------------------------
// Settlement (Task 97)
// ---------------------------------------------------------------------------

/** MCR base payment every loser pays a winner on top of the hand's points. */
export const MCR_BASE_PAYMENT = 8;

/**
 * Point transfers for a finished hand (MCR):
 *   discard win  the discarder pays base + points; every other player pays base
 *   self-drawn   every other player pays base + points
 *   draw / none  nothing
 * `points` is the winner record's total (fans + flowers). Winners below the
 * minimum are skipped (the engine never offers such a win).
 * @param {{ outcome: Object|null, playerCount: number, basePayment?: number }} args
 * @returns {{ from: number, to: number, amount: number, reason: string }[]}
 */
export function settleChineseOfficialHand({ outcome, playerCount, basePayment = MCR_BASE_PAYMENT }) {
  if (!Number.isInteger(playerCount) || playerCount < 2) throw new RangeError('[ChineseOfficialScoring] settle: playerCount must be ≥ 2.');
  if (!Number.isInteger(basePayment) || basePayment < 0) throw new RangeError('[ChineseOfficialScoring] settle: basePayment must be a non-negative integer.');
  const transfers = [];
  if (!outcome || outcome.type !== 'win') return transfers;
  for (const w of outcome.winners) {
    if (!w.meetsMinimum) continue;
    const points = w.points;
    if (!Number.isInteger(points) || points < 0) throw new TypeError('[ChineseOfficialScoring] settle: a winner needs integer points.');
    for (let s = 0; s < playerCount; s++) {
      if (s === w.seatIndex) continue;
      if (w.winType === 'self') transfers.push({ from: s, to: w.seatIndex, amount: basePayment + points, reason: 'self-drawn' });
      else if (s === w.calledFrom) transfers.push({ from: s, to: w.seatIndex, amount: basePayment + points, reason: 'discarder' });
      else transfers.push({ from: s, to: w.seatIndex, amount: basePayment, reason: 'base' });
    }
  }
  return transfers;
}

/**
 * RiichiYaku.js — yaku detection for the Riichi ruleset.
 *
 * Task 82 created the provider contract with the two state yaku (Riichi,
 * Menzen Tsumo). Task 83 adds the common hand-composition yaku:
 *   1 han  Tanyao (open allowed with openTanyao), Pinfu, Iipeikou, Yakuhai
 *          (each dragon Pung, seat wind, round wind — a double wind counts twice)
 *   2 han  Chanta (1 open), Ittsu (1 open), Sanshoku Doujun (1 open),
 *          Sanshoku Doukou, Toitoi, Sanankou, Sankantsu, Chiitoitsu,
 *          Honroutou, Shousangen
 *   3 han  Honitsu (2 open), Junchan (2 open), Ryanpeikou
 *   6 han  Chinitsu (5 open)
 * Task 84 adds the situational yaku — Double Riichi 2 (replaces Riichi),
 * Ippatsu 1, Haitei 1 (Tsumo on the last tile), Houtei 1 (Ron on the last
 * discard), Rinshan Kaihou 1 (Tsumo on a Kan replacement — never also
 * Haitei), Chankan 1 (Ron on a robbed Kan) — and the YAKUMAN: Thirteen
 * Orphans, Suuankou, Daisangen, Shousuushii, Daisuushii, Tsuuiisou,
 * Chinroutou, Ryuuiisou, Chuuren Poutou, Suukantsu, Tenhou, Chiihou. A
 * yakuman replaces every ordinary yaku; several yakuman add up; with
 * options.doubleYakuman (default on, Tenhou / Mahjong Soul style) the
 * 13-sided Thirteen Orphans, single-wait Suuankou, Pure Nine Gates and
 * Daisuushii count double. Yakuman entries carry `yakuman: 1|2` and
 * han = 13 × that (Task 85 scores them as yakuman, not by han).
 * Not included: Nagashi Mangan (a draw outcome, not a winning hand —
 * Tasks 86/89) and the local-rule Renhou. Tenhou vs Chiihou is decided by
 * context.seatWind (East = dealer) and needs context.isFirstUninterruptedTurn.
 *
 * ONE READING PER WIN. A hand can often be read several ways (e.g.
 * 111222333 as three Pungs or three runs); yaku must all come from the SAME
 * interpretation. evaluateYaku() scores every interpretation (from
 * RiichiHandAnalysis.interpretWin) and ranks them by han; detectYaku()
 * returns the best one's yaku. Task 85 breaks han ties by fu.
 *
 * CONTRACT — a yaku provider is a function
 *   detectYaku({ hand, interpretations, melds, isClosed, winType, winningTile, context, options })
 *     → [{ id, name, han }]
 * `melds` are validateWin's descriptors [{ type: 'chi'|'pon'|'kong', kind, open, kongType }];
 * `options` = { openTanyao, doubleYakuman } from RiichiRules. Dora are NOT yaku (Task 88).
 *
 * Exclusions applied: Ryanpeikou replaces Iipeikou; Junchan replaces
 * Chanta; Chinitsu replaces Honitsu. A shanpon wait completed by Ron makes
 * that Pung OPEN for Sanankou (it was finished with another player's tile).
 */

import { WIN_SOURCE } from '../../utils/constants.js';
import { HONOR_START, KIND_COUNT, kindOfFaceId, isTerminalOrHonorKind } from './RiichiHandAnalysis.js';

const SUIT_SIZE = 9;
const DRAGON_KINDS = Object.freeze({ red: 31, green: 32, white: 33 });
const WIND_KIND = Object.freeze({ east: 27, south: 28, west: 29, north: 30 });

/** Yaku table: id → { name, closedHan, openHan (0 = closed only) }. */
export const RIICHI_YAKU = Object.freeze(Object.fromEntries([
  ['riichi', 'Riichi', 1, 0],
  ['menzen-tsumo', 'Fully Concealed Hand', 1, 0],
  ['pinfu', 'Pinfu', 1, 0],
  ['tanyao', 'All Simples', 1, 1],
  ['iipeikou', 'Pure Double Sequence', 1, 0],
  ['yakuhai-white', 'White Dragon', 1, 1],
  ['yakuhai-green', 'Green Dragon', 1, 1],
  ['yakuhai-red', 'Red Dragon', 1, 1],
  ['seat-wind', 'Seat Wind', 1, 1],
  ['round-wind', 'Round Wind', 1, 1],
  ['chanta', 'Half Outside Hand', 2, 1],
  ['ittsu', 'Pure Straight', 2, 1],
  ['sanshoku-doujun', 'Mixed Triple Sequence', 2, 1],
  ['sanshoku-doukou', 'Triple Triplets', 2, 2],
  ['toitoi', 'All Triplets', 2, 2],
  ['sanankou', 'Three Concealed Triplets', 2, 2],
  ['sankantsu', 'Three Quads', 2, 2],
  ['chiitoitsu', 'Seven Pairs', 2, 0],
  ['honroutou', 'All Terminals and Honours', 2, 2],
  ['shousangen', 'Little Three Dragons', 2, 2],
  ['honitsu', 'Half Flush', 3, 2],
  ['junchan', 'Fully Outside Hand', 3, 2],
  ['ryanpeikou', 'Twice Pure Double Sequence', 3, 0],
  ['chinitsu', 'Full Flush', 6, 5],
  // Task 84 — situational
  ['double-riichi', 'Double Riichi', 2, 0],
  ['ippatsu', 'Ippatsu', 1, 0],
  ['haitei', 'Under the Sea', 1, 1],
  ['houtei', 'Under the River', 1, 1],
  ['rinshan', 'After a Kan', 1, 1],
  ['chankan', 'Robbing a Kan', 1, 1],
].map(([id, name, closedHan, openHan]) => [id, Object.freeze({ id, name, closedHan, openHan })])));

/**
 * Task 84 — yakuman: id → { name, closedOnly, double (when doubleYakuman is on) }.
 * A yakuman is reported as { id, name, han: 13 × multiplier, yakuman: multiplier }.
 */
export const RIICHI_YAKUMAN = Object.freeze(Object.fromEntries([
  ['kokushi', 'Thirteen Orphans', true],
  ['kokushi-13', 'Thirteen Orphans (13-sided wait)', true],
  ['suuankou', 'Four Concealed Triplets', true],
  ['suuankou-tanki', 'Four Concealed Triplets (single wait)', true],
  ['daisangen', 'Big Three Dragons', false],
  ['shousuushii', 'Little Four Winds', false],
  ['daisuushii', 'Big Four Winds', false],
  ['tsuuiisou', 'All Honours', false],
  ['chinroutou', 'All Terminals', false],
  ['ryuuiisou', 'All Green', false],
  ['chuuren', 'Nine Gates', true],
  ['junsei-chuuren', 'Pure Nine Gates', true],
  ['suukantsu', 'Four Quads', false],
  ['tenhou', 'Blessing of Heaven', true],
  ['chiihou', 'Blessing of Earth', true],
].map(([id, name, closedOnly]) => [id, Object.freeze({ id, name, closedOnly })])));

/** Yakuman worth double when options.doubleYakuman is on (Tenhou / Mahjong Soul style). */
export const DOUBLE_YAKUMAN = Object.freeze(['kokushi-13', 'suuankou-tanki', 'junsei-chuuren', 'daisuushii']);

const GREEN_KINDS = Object.freeze([10, 11, 12, 14, 16, 32]); // 2 3 4 6 8 bamboo + green dragon
const CHUUREN_BASE = Object.freeze([3, 1, 1, 1, 1, 1, 1, 1, 3]);

const isTerminalKind = (k) => k < HONOR_START && (k % SUIT_SIZE === 0 || k % SUIT_SIZE === 8);
const isSimpleKind = (k) => k < HONOR_START && !isTerminalKind(k);
const windKind = (w) => (w ? WIND_KIND[typeof w === 'string' ? w : w.id] ?? null : null);

/**
 * The hand's sets as groups, pair first: { type: 'run'|'triplet'|'quad'|'pair', kind, concealed }.
 * A Pung completed by Ron counts as open. Exported for fu (Task 85).
 */
export function groupsOf(interp, melds, winType) {
  const groups = [{ type: 'pair', kind: interp.pair, concealed: true }];
  interp.sets.forEach((s, i) => {
    // A Pung completed by Ron (shanpon) counts as open.
    const ronPung = s.type === 'triplet' && winType === WIN_SOURCE.DISCARD && interp.winningPart === i;
    groups.push({ type: s.type, kind: s.kind, concealed: !ronPung });
  });
  for (const m of melds) {
    const type = m.type === 'chi' ? 'run' : m.type === 'kong' ? 'quad' : 'triplet';
    groups.push({ type, kind: m.kind, concealed: m.open === false });
  }
  return groups;
}

const groupHasTerminalOrHonor = (g) => (g.type === 'run' ? g.kind % SUIT_SIZE === 0 || g.kind % SUIT_SIZE === 6 : isTerminalOrHonorKind(g.kind));
const groupHasTerminal = (g) => (g.type === 'run' ? g.kind % SUIT_SIZE === 0 || g.kind % SUIT_SIZE === 6 : isTerminalKind(g.kind));
const isPung = (g) => g.type === 'triplet' || g.type === 'quad';

/** Yaku that depend only on the tiles, not the reading. @private */
function tileYaku(allKinds, push, { isClosed, openTanyao }) {
  if (allKinds.every(isSimpleKind) && (isClosed || openTanyao)) push('tanyao');
  const suits = new Set(allKinds.filter((k) => k < HONOR_START).map((k) => Math.floor(k / SUIT_SIZE)));
  const honors = allKinds.some((k) => k >= HONOR_START);
  if (suits.size === 1 && !honors) push('chinitsu');
  else if (suits.size === 1 && honors) push('honitsu');
  if (allKinds.every(isTerminalOrHonorKind)) push('honroutou');
}

/** Yaku of one STANDARD interpretation. @private */
function standardYaku(interp, input, push) {
  const { melds, isClosed, winType, context } = input;
  const groups = groupsOf(interp, melds, winType);
  const sets = groups.filter((g) => g.type !== 'pair');
  const pair = groups[0];
  const runs = sets.filter((g) => g.type === 'run');
  const pungs = sets.filter(isPung);
  const seat = windKind(context.seatWind);
  const round = windKind(context.roundWind);

  // Pinfu: closed, four runs, a pair that earns no fu, an open (ryanmen) wait.
  const valuablePair = pair.kind >= HONOR_START + 4 || pair.kind === seat || pair.kind === round;
  if (isClosed && melds.length === 0 && runs.length === 4 && !valuablePair && interp.wait === 'ryanmen') push('pinfu');

  // Iipeikou / Ryanpeikou (closed): identical runs.
  if (isClosed) {
    const byKind = new Map();
    for (const r of runs) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    const pairsOfRuns = [...byKind.values()].reduce((a, n) => a + Math.floor(n / 2), 0);
    if (pairsOfRuns >= 2) push('ryanpeikou');
    else if (pairsOfRuns === 1) push('iipeikou');
  }

  // Yakuhai.
  for (const g of pungs) {
    if (g.kind === DRAGON_KINDS.white) push('yakuhai-white');
    if (g.kind === DRAGON_KINDS.green) push('yakuhai-green');
    if (g.kind === DRAGON_KINDS.red) push('yakuhai-red');
    if (g.kind === seat) push('seat-wind');
    if (g.kind === round) push('round-wind');
  }

  // Outside hands (need at least one run; all-Pung outside hands are Honroutou).
  if (runs.length > 0 && groups.every(groupHasTerminalOrHonor)) {
    if (groups.every(groupHasTerminal)) push('junchan');
    else push('chanta');
  }

  // Ittsu: 123 456 789 in one suit.
  for (let suit = 0; suit < 3; suit++) {
    const b = suit * SUIT_SIZE;
    if ([b, b + 3, b + 6].every((k) => runs.some((r) => r.kind === k))) { push('ittsu'); break; }
  }
  // Sanshoku: the same run / Pung in all three suits.
  for (let n = 0; n < SUIT_SIZE; n++) {
    if (n <= 6 && [0, 1, 2].every((s) => runs.some((r) => r.kind === s * SUIT_SIZE + n))) { push('sanshoku-doujun'); break; }
  }
  for (let n = 0; n < SUIT_SIZE; n++) {
    if ([0, 1, 2].every((s) => pungs.some((p) => p.kind === s * SUIT_SIZE + n))) { push('sanshoku-doukou'); break; }
  }

  if (pungs.length === 4) push('toitoi');
  if (pungs.filter((g) => g.concealed).length === 3) push('sanankou'); // four → Suuankou (Task 84)
  if (sets.filter((g) => g.type === 'quad').length === 3) push('sankantsu');

  const dragonPungs = pungs.filter((g) => g.kind >= HONOR_START + 4).length;
  if (dragonPungs === 2 && pair.kind >= HONOR_START + 4) push('shousangen');
}

/** Yakuman ids of one interpretation (Task 84). @private */
function yakumanIds(interp, input, allKinds, counts) {
  const { melds, isClosed, winType, context, winningKind } = input;
  const out = [];
  if (isClosed && winType === WIN_SOURCE.SELF && context.isFirstUninterruptedTurn === true) {
    out.push(windKind(context.seatWind) === WIND_KIND.east ? 'tenhou' : 'chiihou');
  }
  if (interp.structure === 'thirteen-orphans') {
    out.push(interp.wait === 'thirteen-sided' ? 'kokushi-13' : 'kokushi');
    return out;
  }
  if (allKinds.every((k) => k >= HONOR_START)) out.push('tsuuiisou');
  if (allKinds.every(isTerminalKind)) out.push('chinroutou');
  if (allKinds.every((k) => GREEN_KINDS.includes(k))) out.push('ryuuiisou');
  if (interp.structure !== 'standard') return out;

  const groups = groupsOf(interp, melds, winType);
  const pair = groups[0];
  const pungs = groups.slice(1).filter(isPung);
  if (pungs.filter((g) => g.concealed).length === 4) out.push(interp.winningPart === 'pair' ? 'suuankou-tanki' : 'suuankou');
  if (pungs.filter((g) => g.kind >= HONOR_START + 4).length === 3) out.push('daisangen');
  const windPungs = pungs.filter((g) => g.kind >= HONOR_START && g.kind < HONOR_START + 4).length;
  if (windPungs === 4) out.push('daisuushii');
  else if (windPungs === 3 && pair.kind >= HONOR_START && pair.kind < HONOR_START + 4) out.push('shousuushii');
  if (melds.filter((m) => m.type === 'kong').length === 4) out.push('suukantsu');

  // Nine Gates: closed, one suit, 1112345678999 + one more of that suit.
  if (isClosed && melds.length === 0) {
    const suit = Math.floor(allKinds[0] / SUIT_SIZE);
    if (allKinds.every((k) => k < HONOR_START && Math.floor(k / SUIT_SIZE) === suit)) {
      const c = counts.slice(suit * SUIT_SIZE, suit * SUIT_SIZE + SUIT_SIZE);
      if (c.every((v, i) => v >= CHUUREN_BASE[i])) {
        const before = c.slice(); before[winningKind - suit * SUIT_SIZE]--;
        out.push(before.every((v, i) => v === CHUUREN_BASE[i]) ? 'junsei-chuuren' : 'chuuren');
      }
    }
  }
  return out;
}

/** Situational yaku (Task 84) — added to every non-yakuman reading. @private */
function situationalYaku(push, { isClosed, winType, context }) {
  if (isClosed && context.isRiichi === true) {
    push(context.isDoubleRiichi === true ? 'double-riichi' : 'riichi');
    if (context.isIppatsu === true) push('ippatsu');
  }
  if (isClosed && winType === WIN_SOURCE.SELF) push('menzen-tsumo');
  if (winType === WIN_SOURCE.SELF && context.isKongReplacement === true) push('rinshan');
  else if (winType === WIN_SOURCE.SELF && context.isLastTile === true) push('haitei');
  if (winType === WIN_SOURCE.DISCARD && context.isChankan === true) push('chankan');
  else if (winType === WIN_SOURCE.DISCARD && context.isLastTile === true) push('houtei');
}

/**
 * Scores every interpretation; best first (most yakuman, then most han,
 * then input order).
 * @returns {{ interpretation: Object, yaku: { id, name, han, yakuman? }[], han: number, yakuman: number }[]}
 */
export function evaluateYaku(input) {
  const { hand, interpretations = [], melds = [], isClosed, winType, context = {}, options = {} } = input ?? {};
  const openTanyao = options.openTanyao !== false;
  const allKinds = hand ? [...hand.concealedTiles, ...hand.melds.flatMap((m) => m.tiles)].map((t) => kindOfFaceId(t.id)) : [];
  const counts = new Array(KIND_COUNT).fill(0);
  for (const k of allKinds) counts[k]++;
  const winningKind = input?.winningTile ? kindOfFaceId(input.winningTile.id) : null;
  const doubleYakuman = options.doubleYakuman !== false;
  const ranked = interpretations.map((interpretation, order) => {
    // Yakuman replace every ordinary yaku; several yakuman add up.
    const ym = yakumanIds(interpretation, { melds, isClosed, winType, context, winningKind }, allKinds, counts)
      .filter((id) => isClosed || !RIICHI_YAKUMAN[id].closedOnly);
    if (ym.length) {
      const yaku = ym.map((id) => {
        const mult = doubleYakuman && DOUBLE_YAKUMAN.includes(id) ? 2 : 1;
        return { id, name: RIICHI_YAKUMAN[id].name, han: 13 * mult, yakuman: mult };
      });
      return { interpretation, yaku, han: yaku.reduce((a, y) => a + y.han, 0), yakuman: yaku.reduce((a, y) => a + y.yakuman, 0), order };
    }
    const ids = [];
    const push = (id) => ids.push(id);
    situationalYaku(push, { isClosed, winType, context });
    if (interpretation.structure === 'standard') {
      standardYaku(interpretation, { melds, isClosed, winType, context }, push);
      tileYaku(allKinds, push, { isClosed, openTanyao });
    } else if (interpretation.structure === 'seven-pairs') {
      push('chiitoitsu');
      tileYaku(allKinds, push, { isClosed, openTanyao });
    }
    const yaku = ids.map((id) => {
      const y = RIICHI_YAKU[id];
      return { id, name: y.name, han: isClosed ? y.closedHan : y.openHan };
    }).filter((y) => y.han > 0);
    return { interpretation, yaku, han: yaku.reduce((a, y) => a + y.han, 0), yakuman: 0, order };
  });
  ranked.sort((a, b) => b.yakuman - a.yakuman || b.han - a.han || a.order - b.order);
  return ranked.map(({ order, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

/**
 * Default yaku provider: the yaku of the best interpretation.
 * @returns {{ id: string, name: string, han: number }[]}
 */
export function detectYaku(input) {
  const best = evaluateYaku(input)[0];
  return best ? best.yaku : [];
}

/** Kinds 0–33, exported for tests. */
export const _internals = Object.freeze({ KIND_COUNT, DRAGON_KINDS, WIND_KIND, groupsOf });

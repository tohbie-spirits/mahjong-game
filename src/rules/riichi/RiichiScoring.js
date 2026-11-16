/**
 * RiichiScoring.js — Riichi han / fu scoring (Task 85) and point transfers
 * (Task 86).
 *
 * ── Task 85: han / fu ─────────────────────────────────────────────────────
 * FU (standard Japanese rules):
 *   Seven Pairs: 25, never rounded.     Yakuman / Thirteen Orphans: no fu needed.
 *   Base 20; closed Ron +10 (menzen kafu); Tsumo +2 except with Pinfu;
 *   Pinfu Tsumo is exactly 20, Pinfu Ron 30.
 *   Pungs:   simple open 2 / closed 4 · terminal-honour open 4 / closed 8
 *   Kans:    four times the Pung value (8 / 16 / 16 / 32)
 *            (a Pung completed by Ron counts as open)
 *   Pair:    dragon 2, seat wind 2, round wind 2 (a double-wind pair 4 —
 *            option doubleWindPairFu)
 *   Wait:    kanchan / penchan / tanki +2
 *   An open hand worth only 20 fu is raised to 30; the total is rounded up
 *   to the next 10.
 * HAN = yaku han + dora (dora only on a valid win with no yakuman — Task 88
 * supplies the counts as context.dora).
 * BASE POINTS: fu × 2^(han + 2), capped at 2000 (Mangan); 5 han Mangan 2000,
 *   6–7 Haneman 3000, 8–10 Baiman 4000, 11–12 Sanbaiman 6000, 13+ counted
 *   yakuman 8000 (option kazoeYakuman, else Sanbaiman); yakuman 8000 each.
 *   Option kiriageMangan rounds 4 han 30 fu and 3 han 60 fu up to Mangan.
 * BEST READING: every interpretation is scored (its own yaku + its own fu)
 *   and the one worth the most base points wins (then more han, then more
 *   fu, then reading order).
 * PAYMENTS (before honba / riichi sticks): Ron — the discarder pays base × 6
 *   to a dealer, × 4 to a non-dealer. Tsumo — a dealer winner gets base × 2
 *   from everyone; a non-dealer winner gets base × 2 from the dealer and
 *   base × 1 from the others. Each payment is rounded up to 100. Three-player
 *   Tsumo simply has one payer fewer ("tsumo loss").
 */

import { evaluateYaku, groupsOf } from './RiichiYaku.js';
import { HONOR_START, isTerminalOrHonorKind } from './RiichiHandAnalysis.js';
import { WIN_SOURCE } from '../../utils/constants.js';

/** Scoring options (RiichiRules passes its own). */
export const DEFAULT_SCORING_OPTIONS = Object.freeze({
  kazoeYakuman: true,
  kiriageMangan: false,
  doubleWindPairFu: 4,
  playerCount: 4,
});

export const LIMIT = Object.freeze({
  MANGAN: 'mangan', HANEMAN: 'haneman', BAIMAN: 'baiman', SANBAIMAN: 'sanbaiman',
  KAZOE_YAKUMAN: 'kazoe-yakuman', YAKUMAN: 'yakuman',
});

const WIND_KIND = Object.freeze({ east: 27, south: 28, west: 29, north: 30 });
const windKind = (w) => (w ? WIND_KIND[typeof w === 'string' ? w : w.id] ?? null : null);
const ceil100 = (n) => Math.ceil(n / 100) * 100;

/**
 * Fu of one interpretation.
 * @param {Object} interp     an interpretWin() interpretation
 * @param {Object} input      { melds, isClosed, winType, context, yakuIds: string[] }
 * @param {Object} [options]
 * @returns {{ fu: number, rawFu: number, breakdown: { id: string, fu: number }[] }}
 */
export function calculateFu(interp, { melds = [], isClosed, winType, context = {}, yakuIds = [] }, options = {}) {
  const o = { ...DEFAULT_SCORING_OPTIONS, ...options };
  if (interp.structure === 'seven-pairs') return { fu: 25, rawFu: 25, breakdown: [{ id: 'seven-pairs', fu: 25 }] };
  if (interp.structure !== 'standard') return { fu: 0, rawFu: 0, breakdown: [] };
  const isPinfu = yakuIds.includes('pinfu');
  const isTsumo = winType === WIN_SOURCE.SELF;
  if (isPinfu && isTsumo) return { fu: 20, rawFu: 20, breakdown: [{ id: 'base', fu: 20 }] };

  const breakdown = [{ id: 'base', fu: 20 }];
  if (isClosed && !isTsumo) breakdown.push({ id: 'closed-ron', fu: 10 });
  if (isTsumo) breakdown.push({ id: 'tsumo', fu: 2 });

  const groups = groupsOf(interp, melds, winType);
  for (const g of groups.slice(1)) {
    if (g.type === 'run') continue;
    let fu = isTerminalOrHonorKind(g.kind) ? 4 : 2;
    if (g.concealed) fu *= 2;
    if (g.type === 'quad') fu *= 4;
    breakdown.push({ id: `${g.type}${g.concealed ? '-closed' : '-open'}`, fu });
  }
  const pair = groups[0].kind;
  const seat = windKind(context.seatWind);
  const round = windKind(context.roundWind);
  if (pair >= HONOR_START + 4) breakdown.push({ id: 'dragon-pair', fu: 2 });
  if (pair === seat && pair === round) breakdown.push({ id: 'double-wind-pair', fu: o.doubleWindPairFu });
  else if (pair === seat || pair === round) breakdown.push({ id: 'wind-pair', fu: 2 });
  if (['kanchan', 'penchan', 'tanki'].includes(interp.wait)) breakdown.push({ id: `wait-${interp.wait}`, fu: 2 });

  let raw = breakdown.reduce((a, b) => a + b.fu, 0);
  if (!isClosed && raw === 20) { breakdown.push({ id: 'open-pinfu-minimum', fu: 10 }); raw = 30; }
  return { fu: Math.ceil(raw / 10) * 10, rawFu: raw, breakdown };
}

/**
 * Base points and limit name.
 * @returns {{ basePoints: number, limit: string|null }}
 */
export function basePoints(han, fu, yakuman = 0, options = {}) {
  const o = { ...DEFAULT_SCORING_OPTIONS, ...options };
  if (!Number.isInteger(han) || han < 0 || !Number.isInteger(fu) || fu < 0 || !Number.isInteger(yakuman) || yakuman < 0) {
    throw new TypeError('[RiichiScoring] basePoints needs non-negative integers.');
  }
  if (yakuman > 0) return { basePoints: 8000 * yakuman, limit: LIMIT.YAKUMAN };
  if (han >= 13) return o.kazoeYakuman ? { basePoints: 8000, limit: LIMIT.KAZOE_YAKUMAN } : { basePoints: 6000, limit: LIMIT.SANBAIMAN };
  if (han >= 11) return { basePoints: 6000, limit: LIMIT.SANBAIMAN };
  if (han >= 8) return { basePoints: 4000, limit: LIMIT.BAIMAN };
  if (han >= 6) return { basePoints: 3000, limit: LIMIT.HANEMAN };
  if (han === 5) return { basePoints: 2000, limit: LIMIT.MANGAN };
  if (o.kiriageMangan && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) return { basePoints: 2000, limit: LIMIT.MANGAN };
  const b = fu * 2 ** (han + 2);
  return b >= 2000 ? { basePoints: 2000, limit: LIMIT.MANGAN } : { basePoints: b, limit: null };
}

/**
 * What each payer owes for a win (before honba and riichi sticks).
 * @returns {{ ron?: number, dealer?: number, nonDealer?: number, total: number }}
 */
export function winPayments(base, { winType, isDealer, playerCount = 4 }) {
  if (winType === WIN_SOURCE.DISCARD) {
    const ron = ceil100(base * (isDealer ? 6 : 4));
    return { ron, total: ron };
  }
  const others = playerCount - 1;
  if (isDealer) {
    const each = ceil100(base * 2);
    return { nonDealer: each, total: each * others };
  }
  const dealer = ceil100(base * 2);
  const nonDealer = ceil100(base);
  return { dealer, nonDealer, total: dealer + nonDealer * (others - 1) };
}

/**
 * Scores a VALID win (validateWin result) — every interpretation with its
 * own yaku and fu; the best one is returned.
 * @param {Object} validation   RiichiRules#validateWin result (must be valid)
 * @param {Object} input        { hand, winType, winningTile, context, yakuOptions, yakuProvider }
 * @param {Object} [options]    scoring options
 */
export function scoreValidatedWin(validation, input, options = {}) {
  const o = { ...DEFAULT_SCORING_OPTIONS, ...options };
  const { hand, winType, winningTile, context = {}, yakuOptions = {}, yakuProvider = null } = input;
  const base = { hand, interpretations: validation.interpretations, melds: validation.melds, isClosed: validation.isClosed, winType, winningTile, context, options: yakuOptions };
  // Default provider: per-interpretation yaku. A custom provider's yaku apply to every reading.
  const perReading = yakuProvider
    ? validation.interpretations.map((interpretation) => {
      const yaku = yakuProvider({ ...base, interpretations: [interpretation] });
      return { interpretation, yaku, han: yaku.reduce((a, y) => a + y.han, 0), yakuman: yaku.reduce((a, y) => a + (y.yakuman ?? 0), 0) };
    })
    : evaluateYaku(base);
  const dora = context.dora ?? {};
  const doraHan = ['dora', 'uraDora', 'akaDora'].reduce((a, k) => a + (Number.isInteger(dora[k]) && dora[k] > 0 ? dora[k] : 0), 0);
  const isDealer = context.isDealer ?? windKind(context.seatWind) === WIND_KIND.east;
  const playerCount = context.playerCount ?? o.playerCount;

  let best = null;
  for (const r of perReading) {
    if (!r.yaku.length) continue;
    const yakuman = r.yakuman ?? 0;
    const fuResult = yakuman ? { fu: 0, rawFu: 0, breakdown: [] } : calculateFu(r.interpretation, { melds: validation.melds, isClosed: validation.isClosed, winType, context, yakuIds: r.yaku.map((y) => y.id) }, o);
    const han = yakuman ? r.han : r.han + doraHan;
    const { basePoints: bp, limit } = basePoints(han, fuResult.fu, yakuman, o);
    const cand = { reading: r, han, fu: fuResult.fu, fuResult, yakuman, basePoints: bp, limit };
    if (!best || bp > best.basePoints || (bp === best.basePoints && (han > best.han || (han === best.han && fuResult.fu > best.fu)))) best = cand;
  }
  if (!best) return null;
  const breakdown = best.reading.yaku.map((y) => ({ ...y }));
  if (!best.yakuman) {
    for (const [k, name] of [['dora', 'Dora'], ['akaDora', 'Red Five'], ['uraDora', 'Ura Dora']]) {
      if (Number.isInteger(dora[k]) && dora[k] > 0) breakdown.push({ id: k, name, han: dora[k], isDora: true });
    }
  }
  const payments = winPayments(best.basePoints, { winType, isDealer, playerCount });
  return {
    han: best.han, fu: best.fu, yakuman: best.yakuman, basePoints: best.basePoints, limit: best.limit,
    isDealer, payments, points: payments.total,
    breakdown, fuBreakdown: best.fuResult.breakdown, interpretation: best.reading.interpretation,
  };
}

// ===========================================================================
// Task 86 — point transfers, honba, riichi sticks
// ===========================================================================

/**
 * Settlement options (RiichiRules / the turn flow pass their own).
 *   honbaRon          paid by the discarder per honba (300)
 *   honbaTsumoEach    paid by EACH payer per honba on a Tsumo (100)
 *   riichiStickValue  one riichi deposit (1000)
 *   tenpaiPool        noten penalty pool at an exhaustive draw (4P 3000, 3P 2000)
 *   nagashiMangan     a qualifying discard pile pays like a Mangan Tsumo
 */
export const DEFAULT_SETTLEMENT_OPTIONS = Object.freeze({
  honbaRon: 300,
  honbaTsumoEach: 100,
  riichiStickValue: 1000,
  tenpaiPool: { 3: 2000, 4: 3000 },
  nagashiMangan: true,
});

/**
 * Nagashi Mangan eligibility: every discard a terminal or honour, and none
 * of them claimed by another player.
 * @param {{ tile: { isTerminalOrHonor: boolean }, claimed: boolean }[]} entries  a DiscardPile's entries
 */
export function isNagashiEligible(entries) {
  return Array.isArray(entries) && entries.length > 0 && entries.every((e) => e.tile?.isTerminalOrHonor === true && e.claimed !== true);
}

/**
 * Settles one finished hand.
 *
 * WIN    — Ron: the discarder pays each winner its Ron value; Tsumo: each
 *          other player pays its share. Honba (300 per honba from the
 *          discarder / 100 per honba from each Tsumo payer) and every riichi
 *          stick on the table go to ONE winner: the Tsumo winner, or — for a
 *          double Ron — the winner first in turn order after the discarder.
 * DRAW   — exhaustive: noten players pay the tenpai pool to the tenpai players
 *          (nothing when all or none are tenpai); with Nagashi Mangan the
 *          eligible player(s) are paid a Mangan Tsumo instead and no tenpai
 *          payments are made. Sticks stay on the table.
 * ABORTIVE — no payments; sticks stay on the table.
 * NEXT HAND — the dealer keeps the deal after a dealer win, after an
 *          exhaustive draw with the dealer tenpai, and after an abortive
 *          draw; honba +1 after any draw or a dealer win, reset to 0 after a
 *          non-dealer win.
 *
 * @param {Object} p
 * @param {{ type: 'win', winners: Object[] } | { type: 'draw', results: { seatIndex, tenpai }[], nagashi?: number[] } | { type: 'abortive', reason?: string }} p.outcome
 *        winners: { seatIndex, winType, calledFrom, score: { basePoints, isDealer, payments } }
 * @param {number} p.playerCount   3 | 4
 * @param {number} p.dealerIndex
 * @param {number} [p.honba=0]
 * @param {number} [p.riichiSticks=0]  sticks on the table (incl. this hand's declarations)
 * @param {Object} [p.options]
 * @returns {{ transfers: { from: number|null, to: number|null, amount: number, reason: string }[],
 *   riichiSticks: number, honba: number, dealerKeeps: boolean, deltas: number[] }}
 */
export function settleRiichiHand({ outcome, playerCount, dealerIndex, honba = 0, riichiSticks = 0, options = {} }) {
  const o = { ...DEFAULT_SETTLEMENT_OPTIONS, ...options };
  if (playerCount !== 3 && playerCount !== 4) throw new RangeError('[RiichiScoring] playerCount must be 3 or 4.');
  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= playerCount) throw new RangeError('[RiichiScoring] dealerIndex out of range.');
  if (!Number.isInteger(honba) || honba < 0 || !Number.isInteger(riichiSticks) || riichiSticks < 0) throw new TypeError('[RiichiScoring] honba / riichiSticks must be non-negative integers.');
  if (!outcome || !['win', 'draw', 'abortive'].includes(outcome.type)) throw new TypeError('[RiichiScoring] outcome.type must be win, draw or abortive.');
  const transfers = [];
  const pay = (from, to, amount, reason) => { if (amount > 0) transfers.push({ from, to, amount, reason }); };
  let sticks = riichiSticks;
  let dealerKeeps;
  let nextHonba;

  if (outcome.type === 'win') {
    const winners = outcome.winners ?? [];
    if (!winners.length) throw new TypeError('[RiichiScoring] a win needs winners.');
    const ron = winners[0].winType === WIN_SOURCE.DISCARD;
    // The winner who collects honba + sticks.
    let bonusTo = winners[0].seatIndex;
    if (ron) {
      const from = winners[0].calledFrom;
      const dist = (s) => (s - from + playerCount) % playerCount;
      bonusTo = winners.map((w) => w.seatIndex).sort((a, b) => dist(a) - dist(b))[0];
    }
    for (const w of winners) {
      const base = w.score?.basePoints;
      if (!Number.isInteger(base) || base <= 0) throw new TypeError('[RiichiScoring] each winner needs score.basePoints.');
      const isDealer = w.seatIndex === dealerIndex;
      const pays = winPayments(base, { winType: w.winType, isDealer, playerCount });
      if (w.winType === WIN_SOURCE.DISCARD) {
        pay(w.calledFrom, w.seatIndex, pays.ron, 'ron');
        if (w.seatIndex === bonusTo) pay(w.calledFrom, w.seatIndex, honba * o.honbaRon, 'honba');
      } else {
        for (let s = 0; s < playerCount; s++) {
          if (s === w.seatIndex) continue;
          const share = isDealer ? pays.nonDealer : (s === dealerIndex ? pays.dealer : pays.nonDealer);
          pay(s, w.seatIndex, share, 'tsumo');
          pay(s, w.seatIndex, honba * o.honbaTsumoEach, 'honba');
        }
      }
    }
    pay(null, bonusTo, sticks * o.riichiStickValue, 'riichi-sticks');
    sticks = 0;
    dealerKeeps = winners.some((w) => w.seatIndex === dealerIndex);
    nextHonba = dealerKeeps ? honba + 1 : 0;
  } else if (outcome.type === 'draw') {
    const results = outcome.results ?? [];
    const tenpai = results.filter((r) => r.tenpai).map((r) => r.seatIndex);
    const noten = results.filter((r) => !r.tenpai).map((r) => r.seatIndex);
    const nagashi = o.nagashiMangan ? (outcome.nagashi ?? []) : [];
    if (nagashi.length) {
      for (const n of nagashi) {
        const isDealer = n === dealerIndex;
        const pays = winPayments(2000, { winType: WIN_SOURCE.SELF, isDealer, playerCount });
        for (let s = 0; s < playerCount; s++) {
          if (s === n) continue;
          pay(s, n, isDealer ? pays.nonDealer : (s === dealerIndex ? pays.dealer : pays.nonDealer), 'nagashi-mangan');
        }
      }
    } else if (tenpai.length && noten.length) {
      const pool = o.tenpaiPool[playerCount];
      // Each noten player pays an equal share, split equally among the tenpai players.
      const perNoten = pool / noten.length;
      for (const n of noten) for (const t of tenpai) pay(n, t, perNoten / tenpai.length, 'noten');
    }
    dealerKeeps = tenpai.includes(dealerIndex);
    nextHonba = honba + 1;
  } else {
    dealerKeeps = true;
    nextHonba = honba + 1;
  }

  const deltas = new Array(playerCount).fill(0);
  for (const t of transfers) {
    if (t.from !== null) deltas[t.from] -= t.amount;
    if (t.to !== null) deltas[t.to] += t.amount;
  }
  return { transfers, riichiSticks: sticks, honba: nextHonba, dealerKeeps, deltas };
}

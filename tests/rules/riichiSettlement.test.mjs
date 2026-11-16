/**
 * riichiSettlement.test.mjs — Task 86: Riichi point transfers, honba and
 * riichi sticks (settleRiichiHand).
 *
 * Sections:
 *   1. Ron — non-dealer / dealer, honba from the discarder, riichi sticks
 *   2. Tsumo — splits, honba from every payer, three-player tsumo loss
 *   3. Double Ron — each winner paid; honba + sticks to the first winner
 *      after the discarder
 *   4. Exhaustive draw — tenpai pool splits (4P 3000, 3P 2000), all / none
 *      tenpai, sticks stay; Nagashi Mangan (eligibility + payments)
 *   5. Abortive draw; dealer continuation and honba progression
 *   6. Zero-sum + validation
 *
 * Run: node tests/rules/riichiSettlement.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { tiles } from '../_helpers/tiles.mjs';
import { settleRiichiHand, isNagashiEligible, DEFAULT_SETTLEMENT_OPTIONS } from '../../src/rules/riichi/RiichiScoring.js';
import { WIN_SOURCE } from '../../src/utils/constants.js';

const ron = (seatIndex, calledFrom, basePoints) => ({ seatIndex, winType: WIN_SOURCE.DISCARD, calledFrom, score: { basePoints } });
const tsumo = (seatIndex, basePoints) => ({ seatIndex, winType: WIN_SOURCE.SELF, calledFrom: null, score: { basePoints } });
const settle = (outcome, extra = {}) => settleRiichiHand({ outcome, playerCount: 4, dealerIndex: 0, ...extra });
const sum = (r) => r.deltas.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
section('1. Ron', () => {
  const r = settle({ type: 'win', winners: [ron(2, 1, 480)] });
  assert(r.deltas.join() === '0,-2000,2000,0' && r.transfers.length === 1 && r.transfers[0].reason === 'ron', 'non-dealer 2 han 30 fu Ron: discarder pays 2000');
  const d = settle({ type: 'win', winners: [ron(0, 3, 480)] });
  assert(d.deltas.join() === '2900,0,0,-2900', 'dealer Ron 2900');
  const h = settle({ type: 'win', winners: [ron(2, 1, 480)] }, { honba: 2, riichiSticks: 3 });
  assert(h.deltas.join() === '0,-2600,5600,0', 'honba ×2 (+600 from the discarder) and three sticks (+3000) to the winner');
  assert(h.riichiSticks === 0 && h.transfers.find((t) => t.reason === 'riichi-sticks').from === null, 'sticks come off the table (from: null) and the table is cleared');
  assert(h.honba === 0 && h.dealerKeeps === false, 'non-dealer win: deal passes, honba resets');
});

// ---------------------------------------------------------------------------
section('2. Tsumo', () => {
  const t = settle({ type: 'win', winners: [tsumo(2, 640)] });
  assert(t.deltas.join() === '-1300,-700,2700,-700', 'non-dealer 3 han 20 fu Tsumo: dealer 1300, others 700');
  const td = settle({ type: 'win', winners: [tsumo(0, 2000)] }, { honba: 1 });
  assert(td.deltas.join() === '12300,-4100,-4100,-4100', 'dealer Mangan Tsumo with 1 honba: 4000 + 100 from each');
  assert(td.dealerKeeps && td.honba === 2, 'dealer win: keeps the deal, honba +1');
  const t3 = settleRiichiHand({ outcome: { type: 'win', winners: [tsumo(1, 2000)] }, playerCount: 3, dealerIndex: 0, honba: 1 });
  assert(t3.deltas.join() === '-4100,6200,-2100', 'three-player Mangan Tsumo: one payer fewer (tsumo loss), honba from both payers');
});

// ---------------------------------------------------------------------------
section('3. Double Ron', () => {
  // Discarder seat 1; winners seat 3 and seat 0. In turn order after seat 1: seat 2, 3, 0 → seat 3 first.
  const r = settle({ type: 'win', winners: [ron(0, 1, 480), ron(3, 1, 2000)] }, { honba: 1, riichiSticks: 2 });
  assert(r.deltas.join() === '2900,-11200,0,10300', 'discarder pays both (2900 + 8000); honba 300 + 2 sticks to seat 3 (first after the discarder)');
  assert(r.dealerKeeps && r.honba === 2, 'the dealer was one of the winners → keeps the deal');
  const r2 = settle({ type: 'win', winners: [ron(3, 2, 480), ron(1, 2, 480)] }, { riichiSticks: 1 });
  assert(r2.deltas[3] === 3000 && r2.deltas[1] === 2000, 'discarder seat 2 → seat 3 is next in turn order and collects the stick');
});

// ---------------------------------------------------------------------------
section('4. Exhaustive draw + Nagashi Mangan', () => {
  const draw = (tenpaiSeats, n = 4, extra = {}) => settleRiichiHand({ outcome: { type: 'draw', results: Array.from({ length: n }, (_, s) => ({ seatIndex: s, tenpai: tenpaiSeats.includes(s) })), ...extra }, playerCount: n, dealerIndex: 0, honba: 1, riichiSticks: 2 });
  assert(draw([1]).deltas.join() === '-1000,3000,-1000,-1000', '1 tenpai: +3000, each noten −1000');
  assert(draw([0, 2]).deltas.join() === '1500,-1500,1500,-1500', '2 tenpai: ±1500');
  assert(draw([0, 1, 2]).deltas.join() === '1000,1000,1000,-3000', '3 tenpai: noten pays 3000');
  assert(draw([]).transfers.length === 0 && draw([0, 1, 2, 3]).transfers.length === 0, 'nobody / everybody tenpai: no payments');
  assert(draw([1], 3).deltas.join() === '-1000,2000,-1000', 'three-player: 2000 pool');
  const d = draw([1]);
  assert(d.riichiSticks === 2 && d.honba === 2 && d.dealerKeeps === false, 'sticks stay on the table, honba +1, dealer noten → deal passes');
  assert(draw([0]).dealerKeeps === true, 'dealer tenpai → keeps the deal');
  const n = draw([1], 4, { nagashi: [2] });
  assert(n.deltas.join() === '-4000,-2000,8000,-2000' && n.transfers.every((t) => t.reason === 'nagashi-mangan'), 'Nagashi Mangan pays a non-dealer Mangan Tsumo and replaces the tenpai payments');
  assert(settleRiichiHand({ outcome: { type: 'draw', results: [{ seatIndex: 0, tenpai: false }, { seatIndex: 1, tenpai: true }, { seatIndex: 2, tenpai: false }, { seatIndex: 3, tenpai: false }], nagashi: [2] }, playerCount: 4, dealerIndex: 0, options: { nagashiMangan: false } }).transfers.every((t) => t.reason === 'noten'), 'nagashiMangan:false → ordinary tenpai payments');
  const dt = tiles('19d ESWN 9c');
  const entries = (ts, claimedAt = -1) => ts.map((tile, i) => ({ tile, claimed: i === claimedAt }));
  assert(isNagashiEligible(entries(dt)), 'all terminals / honours, none claimed → eligible');
  assert(!isNagashiEligible(entries(dt, 2)), 'a claimed discard → not eligible');
  assert(!isNagashiEligible(entries(tiles('19d 5b'))), 'a simple tile → not eligible');
  assert(!isNagashiEligible([]), 'no discards → not eligible');
});

// ---------------------------------------------------------------------------
section('5. Abortive draw + continuation', () => {
  const a = settle({ type: 'abortive', reason: 'four-winds' }, { honba: 0, riichiSticks: 1 });
  assert(a.transfers.length === 0 && a.riichiSticks === 1 && a.dealerKeeps && a.honba === 1, 'abortive: no payments, sticks stay, dealer repeats, honba +1');
});

// ---------------------------------------------------------------------------
section('6. Zero-sum + validation', () => {
  const cases = [
    settle({ type: 'win', winners: [ron(2, 1, 480)] }, { honba: 3 }),
    settle({ type: 'win', winners: [tsumo(1, 1920)] }, { honba: 2 }),
    settle({ type: 'win', winners: [ron(0, 1, 480), ron(3, 1, 2000)] }, { honba: 1 }),
  ];
  assert(cases.every((r) => sum(r) === 0), 'payments between players are zero-sum (no sticks involved)');
  const withSticks = settle({ type: 'win', winners: [tsumo(1, 640)] }, { riichiSticks: 2 });
  assert(sum(withSticks) === 2000, 'with sticks the players gain exactly the sticks taken off the table');
  assert(Object.isFrozen(DEFAULT_SETTLEMENT_OPTIONS) && DEFAULT_SETTLEMENT_OPTIONS.honbaRon === 300, 'defaults');
  assertThrows(() => settle({ type: 'nope' }), TypeError, 'unknown outcome throws');
  assertThrows(() => settle({ type: 'win', winners: [] }), TypeError, 'win without winners throws');
  assertThrows(() => settle({ type: 'win', winners: [{ seatIndex: 1, winType: WIN_SOURCE.SELF, score: {} }] }), TypeError, 'winner without basePoints throws');
  assertThrows(() => settleRiichiHand({ outcome: { type: 'abortive' }, playerCount: 5, dealerIndex: 0 }), RangeError, 'player count checked');
  assertThrows(() => settle({ type: 'abortive' }, { honba: -1 }), TypeError, 'negative honba throws');
});

summary();

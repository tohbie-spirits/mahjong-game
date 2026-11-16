/**
 * hintText.test.mjs — Tasks 116–117: src/ui/hintText.js, the hint advice in words.
 *
 * Sections:
 *   1. Discard hints — ready (waits + tiles left), not ready (tiles away, useful tiles), fold, balance, riichi lock
 *   2. Notes — value route (Hong Kong fan / Chinese Official points), dead waits, tsumo-only, furiten, no yaku, flowers
 *   3. Choices — win, riichi / not yet, nine terminals / play on, Kong / pass
 *   4. Helpers and guards — listOf, describeRoute for every route, wrong kinds refused
 *
 * Run: node tests/ui/hintText.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { formatDiscardHint, formatActionHint, formatClaimHint, listOf, describeRoute } from '../../src/ui/hintText.js';

const base = { kind: 'discard', faceId: 'wind-north', mode: 'push', shanten: 0, valueShanten: 0, waits: [], useful: [], usefulCount: 0, danger: null, threat: null, alternatives: [], notes: [] };
const H = (over) => ({ ...base, ...over });
const all = (r) => [r.headline, ...r.details].join(' ');

section('1. Discard hints', () => {
  const ready = formatDiscardHint(H({ waits: [{ faceId: 'bamboo-1', live: 2, ron: true, tsumo: true }, { faceId: 'bamboo-4', live: 4, ron: true, tsumo: true }] }));
  assert(ready.headline === 'Discard North Wind: you’ll be ready, waiting on 1 of Bamboo or 4 of Bamboo (6 tiles left).', `ready: "${ready.headline}"`);
  const far = formatDiscardHint(H({ shanten: 2, useful: [{ faceId: 'dots-3', remaining: 4 }, { faceId: 'dots-6', remaining: 3 }], usefulCount: 7 }));
  assert(far.headline === 'Discard North Wind: you’ll be 2 tiles away from ready.' && far.details[0] === '7 tiles would help — for example 3 of Dots or 6 of Dots.', `not ready: "${all(far)}"`);
  assert(formatDiscardHint(H({ shanten: 1 })).headline.includes('1 tile away'), 'singular');
  const fold = formatDiscardHint(H({ mode: 'fold', shanten: 3 }));
  assert(fold.headline === 'Play safe: discard North Wind.' && /least likely/.test(fold.details[0]), 'fold: play safe, and why');
  const bal = formatDiscardHint(H({ mode: 'balance', shanten: 1, danger: 0.05 }));
  assert(/fairly safe/.test(all(bal)), 'balance with a safe tile: says so');
  assert(!/fairly safe/.test(all(formatDiscardHint(H({ mode: 'balance', shanten: 1, danger: 0.6 })))), '…but not when it isn’t');
  const lock = formatDiscardHint(H({ mode: 'forced', notes: [{ code: 'riichi-lock' }] }));
  assert(lock.headline === 'You’re in riichi: discard North Wind, the tile you drew.', 'riichi lock');
  const dead = formatDiscardHint(H({ waits: [{ faceId: 'bamboo-1', live: 2, ron: false, tsumo: false }], notes: [{ code: 'dead-waits' }] }));
  assert(/waiting on 1 of Bamboo/.test(dead.headline) && /none of those tiles/.test(dead.details[0]), 'dead waits are still named, with the warning');
});

section('2. Notes', () => {
  const hk = formatDiscardHint(H({ shanten: 1, valueShanten: 2, notes: [{ code: 'value-route', ruleset: 'hong_kong', route: 'flush', suit: 1, fan: 3, minimum: 3 }] }));
  assert(/3 fan needed/.test(all(hk)) && /one suit — Bamboo \(plus honours\) \(3 fan\)/.test(all(hk)), `Hong Kong route: "${hk.details.at(-1)}"`);
  const co = formatDiscardHint(H({ shanten: 2, valueShanten: 3, notes: [{ code: 'value-route', ruleset: 'chinese_official', route: 'mixed-triple-chow', points: 10, minimum: 8 }] }));
  assert(/8 points needed/.test(all(co)) && /Mixed Triple Chow .* \(10 points\)/.test(all(co)), 'Chinese Official route in points');
  const ts = formatDiscardHint(H({ waits: [{ faceId: 'bamboo-1', live: 2, ron: false, tsumo: true }], notes: [{ code: 'tsumo-only', faceIds: ['bamboo-1'] }] }));
  assert(/1 of Bamboo only counts if you draw it yourself/.test(all(ts)), 'tsumo-only (singular)');
  const fu = formatDiscardHint(H({ waits: [{ faceId: 'bamboo-8', live: 2, ron: false, tsumo: true }], notes: [{ code: 'furiten', faceIds: ['bamboo-8'] }] }));
  assert(/Furiten: you already discarded 8 of Bamboo/.test(all(fu)), 'furiten');
  const ny = formatDiscardHint(H({ waits: [{ faceId: 'characters-3', live: 4, ron: false, tsumo: true }], notes: [{ code: 'no-yaku', fixedByRiichi: true }] }));
  assert(/no yaku yet/.test(all(ny)) && /Declare riichi/.test(all(ny)), 'no yaku → declare riichi');
  const fl = formatDiscardHint(H({ shanten: 2, valueShanten: 3, notes: [{ code: 'flowers', count: 2 }] }));
  assert(/Your 2 flowers won’t help/.test(all(fl)), 'flowers');
});

section('3. Choices', () => {
  const A = (o) => ({ kind: 'action', ...o });
  assert(formatActionHint(A({ reason: 'win' })).headline.startsWith('Declare the win'), 'win');
  const r = formatActionHint(A({ reason: 'riichi', faceId: 'characters-9', waits: ['bamboo-5', 'bamboo-8'] }));
  assert(r.headline === 'Declare riichi, discarding 9 of Characters.' && /5 of Bamboo or 8 of Bamboo/.test(r.details[0]), 'riichi with the discard and waits');
  assert(/Don’t declare/.test(formatActionHint(A({ reason: 'riichi-few-waits' })).headline), 'not yet');
  assert(/abortive draw/.test(formatActionHint(A({ reason: 'nine-terminals', kinds: 9 })).headline) && /Thirteen Orphans/.test(formatActionHint(A({ reason: 'go-for-orphans', kinds: 12 })).headline), 'nine terminals: redeal / play on');
  assert(/Declare the Kong of 1 of Dots/.test(formatActionHint(A({ reason: 'kong-concealed', faceId: 'dots-1' })).headline) && /Pass on the Kong/.test(formatActionHint(A({ reason: 'kong-slows', faceId: 'dots-1' })).headline), 'Kong / pass');
  assert(formatActionHint(A({ reason: 'nothing' })).headline === 'Pass.', 'nothing');
  // Task 118: calls on a discard, in the ruleset's own words.
  const C = (o) => ({ kind: 'claim', faceId: 'dots-4', ...o });
  assert(formatClaimHint(C({ reason: 'claim', type: 'chi', sequence: ['dots-3', 'dots-4', 'dots-5'] })).headline === 'Call Chow 3 of Dots – 4 of Dots – 5 of Dots.', 'call a Chow (default words)');
  assert(formatClaimHint(C({ reason: 'claim', type: 'pon' }), { callName: (t) => ({ pon: 'Pon' })[t] }).headline === 'Call Pon on 4 of Dots.', 'call a Pon (Riichi\u2019s word)');
  assert(formatClaimHint(C({ reason: 'claim', type: 'kong' }), { callName: (t) => ({ kong: 'Kan' })[t] }).headline === 'Call Kan on 4 of Dots.', 'call a Kan');
  const pc = formatClaimHint(C({ reason: 'pass-claim' }));
  assert(pc.headline === 'Pass on the 4 of Dots.' && /open your hand/.test(pc.details[0]), 'pass, and why');
  assertThrows(() => formatClaimHint({ kind: 'action', reason: 'win' }), TypeError, 'claim formatter refuses other kinds');
});

section('4. Helpers and guards', () => {
  assert(listOf(['a']) === 'a' && listOf(['a', 'b']) === 'a or b' && listOf(['a', 'b', 'c'], 'and') === 'a, b and c' && listOf([]) === '', 'listOf');
  const routes = ['plain', 'honor-pung', 'flush', 'all-pungs', 'mixed-straight', 'pure-straight', 'mixed-triple-chow', 'full-flush', 'half-flush', 'half-flush-honor', 'all-pungs-honor', 'seven-pairs', 'thirteen-orphans', 'honors-knitted', 'knitted-straight'];
  assert(routes.every((route) => { const d = describeRoute({ route, ruleset: 'chinese_official', points: 8, suit: 0, honorFaceId: 'dragon-red' }); return !d.startsWith(route) && !/undefined/.test(d); }), 'every route the advisors produce has words');
  assert(describeRoute({ route: 'honor-pung', ruleset: 'hong_kong', fan: 3, honorFaceId: 'dragon-red' }) === 'a Pung of Red Dragon (3 fan)', `honour Pung: "${describeRoute({ route: 'honor-pung', ruleset: 'hong_kong', fan: 3, honorFaceId: 'dragon-red' })}"`);
  assertThrows(() => formatDiscardHint({ kind: 'action' }), TypeError, 'discard formatter refuses other kinds');
  assertThrows(() => formatActionHint(null), TypeError, 'action formatter refuses nothing');
});

summary();

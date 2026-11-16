/**
 * scoreFormat.test.mjs — Task 102: src/ui/scoreFormat.js, the ruleset-aware
 * score wording used by ScoreScreen and the win button, checked against
 * REAL score objects from each rule engine.
 *
 * Run: node tests/ui/scoreFormat.test.mjs
 */
import { section, assert, summary } from '../_helpers/harness.mjs';
import { hand } from '../_helpers/tiles.mjs';
import { scoreFormatFor } from '../../src/ui/scoreFormat.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { RULESET_ID } from '../../src/utils/constants.js';

/** A winner-record-like object from a real scoreHand call. */
function winner(engine, spec, ctx = {}) {
  const h = hand(spec);
  const score = engine.scoreHand(h, { winType: 'self', winningTile: h.concealedTiles[13], seatWind: null, roundWind: null, ...ctx });
  return { seatIndex: 0, winType: 'self', fan: score.fan, points: score.points, breakdown: score.breakdown, meetsMinimum: score.meetsMinimum, score };
}
const noUndefined = (s) => typeof s === 'string' && !/undefined|NaN/.test(s);

section('1. Hong Kong (unchanged wording)', () => {
  const f = scoreFormatFor(RULESET_ID.HONG_KONG);
  const w = winner(new HongKongRules(), '123d 123d 456d 789d EE');
  assert(f.unit === 'fan' && w.breakdown.every((b) => /^\d+ fan$/.test(f.breakdownValue(b))), `breakdown in fan (${w.breakdown.map(f.breakdownValue).join(', ')})`);
  assert(f.total(w) === `${w.fan} fan · ${w.points} pts`, `total "${f.total(w)}"`);
  assert(f.winLabel(w.score) === ` · ${w.fan} fan` && /minimum fan/.test(f.belowMinimum), 'win button + minimum note');
  assert(scoreFormatFor('unknown').unit === 'fan' && scoreFormatFor(undefined).unit === 'fan', 'unknown ruleset → the Hong Kong format');
});

section('2. Riichi', () => {
  const f = scoreFormatFor(RULESET_ID.RIICHI);
  const w = winner(new RiichiRules(), '234d 456b 678c 22d 345b');
  assert(w.breakdown.every((b) => /^\d+ han$/.test(f.breakdownValue(b))), `each yaku in han, never "undefined fan" (${w.breakdown.map(f.breakdownValue).join(', ')})`);
  assert(f.total(w) === `${w.score.han} han ${w.score.fu} fu · ${w.points} pts`, `total "${f.total(w)}"`);
  const mangan = { points: 8000, fan: 5, score: { han: 5, fu: 30, limit: 'mangan', yakuman: 0 } };
  assert(f.total(mangan) === '5 han 30 fu (Mangan) · 8000 pts', `limit named (${f.total(mangan)})`);
  const ykm = { points: 32000, score: { yakuman: 1 } };
  assert(f.total(ykm) === 'Yakuman · 32000 pts' && f.breakdownValue({ name: 'Thirteen Orphans', yakuman: 1 }) === 'yakuman', 'yakuman wording');
  assert(f.winLabel(w.score) === ` · ${w.score.han} han` && /yaku/.test(f.belowMinimum), 'win button + "no yaku" note');
});

section('3. Chinese Official', () => {
  const f = scoreFormatFor(RULESET_ID.CHINESE_OFFICIAL);
  const w = winner(new ChineseOfficialRules(), '123d 456b 789c 111d EE', { flowerCount: 2 });
  assert(w.breakdown.every((b) => /^\d+ pts$/.test(f.breakdownValue(b))), `each fan in points (${w.breakdown.map(f.breakdownValue).join(', ')})`);
  assert(f.total(w) === `${w.score.validation.points} + 2 flowers = ${w.points} pts`, `total with flowers "${f.total(w)}"`);
  const w0 = winner(new ChineseOfficialRules(), '123d 456b 789c 111d EE');
  assert(f.total(w0) === `${w0.points} pts`, `total without flowers "${f.total(w0)}"`);
  assert(f.winLabel(w.score) === ` · ${w.score.points} pts` && /8 points/.test(f.belowMinimum), 'win button + minimum note');
});

section('4. Outcomes', () => {
  const f = scoreFormatFor(RULESET_ID.RIICHI);
  assert(f.outcomeTitle({ type: 'win' }) === 'Round Over — Win!' && f.outcomeTitle({ type: 'draw' }) === 'Round Over — Draw' && f.outcomeTitle(null) === 'Round Over — Draw', 'win / draw titles');
  assert(f.outcomeTitle({ type: 'abortive', reason: 'four-winds' }) === 'Round Over — Abortive Draw', 'abortive title');
  assert(/same wind/.test(f.abortiveNote({ type: 'abortive', reason: 'four-winds' })) && /nine different/.test(f.abortiveNote({ reason: 'nine-terminals' })), 'abortive reasons explained');
  assert(f.abortiveNote({ reason: 'mystery' }) === 'The hand was abandoned.', 'unknown reason → a plain note');
  const all = [RULESET_ID.HONG_KONG, RULESET_ID.RIICHI, RULESET_ID.CHINESE_OFFICIAL].map(scoreFormatFor);
  assert(all.every((x) => noUndefined(x.total({})) && noUndefined(x.breakdownValue({})) && noUndefined(x.winLabel(null) || 'ok')), 'missing fields never print "undefined" / "NaN"');
});

summary();

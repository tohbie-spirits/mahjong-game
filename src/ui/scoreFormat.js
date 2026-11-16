/**
 * scoreFormat.js — Task 102: how each ruleset's scores read in the UI.
 *
 * The three rulesets count different things — Hong Kong fan, Riichi han + fu,
 * Chinese Official points (+ flowers) — and their winner records differ to
 * match (a Riichi breakdown line carries `han`, an MCR line `points`). This
 * UI-owned module turns any of them into display text, keyed by RULESET_ID
 * only (no rule-module imports — ruleset isolation).
 *
 *   scoreFormatFor(rulesetId) → {
 *     rulesetId, unit,                       'fan' | 'han' | 'pts'
 *     breakdownValue(line)                   one breakdown row's value
 *     total(winner)                          the winner card's total line
 *     winLabel(score)                        " · 3 han" for the win button
 *     belowMinimum                           note for a winner below the minimum
 *     outcomeTitle(outcome)                  the round-over heading
 *     abortiveNote(outcome)                  the text for an abortive draw
 *   }
 * Unknown ruleset ids get the Hong Kong format (the original behaviour).
 */

import { RULESET_ID } from '../utils/constants.js';

const num = (x) => (Number.isFinite(x) ? x : 0);

const LIMIT_NAMES = Object.freeze({
  mangan: 'Mangan', haneman: 'Haneman', baiman: 'Baiman', sanbaiman: 'Sanbaiman', yakuman: 'Yakuman',
  'kazoe-yakuman': 'Counted Yakuman', 'double-yakuman': 'Double Yakuman',
});

const ABORTIVE_NAMES = Object.freeze({
  'nine-terminals': 'nine different terminals and honours were declared',
  'four-winds': 'all four players discarded the same wind on the first go-round',
  'four-riichi': 'all four players declared riichi',
  'four-kans': 'four Kongs were declared by different players',
  'triple-ron': 'three players called Ron on the same discard',
});

const HONG_KONG = Object.freeze({
  rulesetId: RULESET_ID.HONG_KONG,
  unit: 'fan',
  breakdownValue: (b) => `${num(b.fan)} fan`,
  total: (w) => `${num(w.fan)} fan · ${num(w.points)} pts`,
  winLabel: (s) => (s && Number.isFinite(s.fan) ? ` · ${s.fan} fan` : ''),
  belowMinimum: 'Below the minimum fan — no points paid.',
});

const RIICHI = Object.freeze({
  rulesetId: RULESET_ID.RIICHI,
  unit: 'han',
  breakdownValue: (b) => (b.yakuman ? (b.yakuman > 1 ? `${b.yakuman}× yakuman` : 'yakuman') : `${num(b.han ?? b.fan)} han`),
  total: (w) => {
    const s = w.score ?? {};
    const pts = `${num(w.points)} pts`;
    if (s.yakuman > 0) return `${LIMIT_NAMES[s.yakuman > 1 ? 'double-yakuman' : 'yakuman']} · ${pts}`;
    const han = num(s.han ?? w.fan);
    const base = `${han} han${Number.isFinite(s.fu) ? ` ${s.fu} fu` : ''}`;
    return `${base}${s.limit ? ` (${LIMIT_NAMES[s.limit] ?? s.limit})` : ''} · ${pts}`;
  },
  winLabel: (s) => (!s ? '' : s.yakuman > 0 ? ' · yakuman' : Number.isFinite(s.han ?? s.fan) ? ` · ${s.han ?? s.fan} han` : ''),
  belowMinimum: 'No yaku — not a winning hand.',
});

const CHINESE_OFFICIAL = Object.freeze({
  rulesetId: RULESET_ID.CHINESE_OFFICIAL,
  unit: 'pts',
  breakdownValue: (b) => `${num(b.points ?? b.fan)} pts`,
  total: (w) => {
    const v = w.score?.validation ?? null;
    const flowers = num(v?.flowerPoints ?? w.score?.flowerPoints);
    const fans = num(v?.points ?? w.fan);
    return flowers ? `${fans} + ${flowers} flower${flowers === 1 ? '' : 's'} = ${num(w.points)} pts` : `${num(w.points)} pts`;
  },
  winLabel: (s) => (s && Number.isFinite(s.points) ? ` · ${s.points} pts` : ''),
  belowMinimum: 'Below 8 points (flowers don\'t count) — not a winning hand.',
});

const BY_ID = Object.freeze({ [RULESET_ID.HONG_KONG]: HONG_KONG, [RULESET_ID.RIICHI]: RIICHI, [RULESET_ID.CHINESE_OFFICIAL]: CHINESE_OFFICIAL });

/** The round-over heading for any outcome. */
function outcomeTitle(outcome) {
  if (outcome?.type === 'win') return 'Round Over — Win!';
  if (outcome?.type === 'abortive') return 'Round Over — Abortive Draw';
  return 'Round Over — Draw';
}

/** The explanation shown for an abortive draw. */
function abortiveNote(outcome) {
  const why = ABORTIVE_NAMES[outcome?.reason];
  return why ? `The hand was abandoned: ${why}.` : 'The hand was abandoned.';
}

/**
 * @param {string} [rulesetId]
 * @returns {Object} the format for that ruleset (Hong Kong when unknown)
 */
export function scoreFormatFor(rulesetId) {
  return { ...(BY_ID[rulesetId] ?? HONG_KONG), outcomeTitle, abortiveNote };
}

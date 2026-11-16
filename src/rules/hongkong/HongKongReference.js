/**
 * HongKongReference.js — Task 114: the Hong Kong rules reference, as data.
 *
 * Read by RuleReferenceScreen (and the in-game Rules panel) through main.js,
 * the composition root — the UI never imports a ruleset (crossRuleset test).
 * Written for THIS game's Hong Kong engine, not Hong Kong mahjong in
 * general: facts that the engine decides (minimum / limit fan, which hands
 * count, who pays what) are read from its own tables and defaults, so the
 * reference can't drift from the rules actually played. Tests check that
 * every scoring pattern the engine knows is listed with its real value.
 *
 * The shape (shared by the three reference modules — see RuleReferenceScreen):
 *   { rulesetId, title, native, summary,
 *     facts: [{ label, value }],
 *     sections: [{ id, title, blocks: [{ type: 'p', text } | { type: 'list', items } | { type: 'tiles', tiles: [faceId], caption }] }],
 *     scoring: { title, intro, unit, groups: [{ title, rows: [{ id, name, native, value, note? }] }] },
 *     glossary: [{ term, native, meaning }] }
 */

import { HONG_KONG_FAN, HONG_KONG_POINTS, DEFAULT_HONG_KONG_SCORING_OPTIONS } from './HongKongScoring.js';
import { HONG_KONG_PATTERN_NAMES, HONG_KONG_TERMINOLOGY } from './HongKongTerminology.js';
import { RULESET_ID } from '../../utils/constants.js';

/** Which group each scoring pattern belongs to in the reference. */
const GROUPS = [
  ['How you won', ['self-drawn', 'last-tile', 'kong-replacement']],
  ['Hand shape', ['concealed-hand', 'all-chows', 'all-pungs', 'mixed-one-suit', 'pure-one-suit']],
  ['Honour sets', ['dragon-pung', 'seat-wind', 'round-wind', 'small-three-dragons', 'big-three-dragons', 'small-four-winds', 'big-four-winds']],
  ['Special hands', ['all-honors', 'all-terminals', 'thirteen-orphans', 'seven-pairs', 'chicken-hand']],
];

const NOTES = {
  'dragon-pung': 'per Pung or Kong of dragons',
  'seat-wind': 'Pung or Kong of your own seat wind',
  'round-wind': 'Pung or Kong of the prevailing (round) wind',
  'concealed-hand': 'no Chow, Pung or Kong claimed from a discard',
  'seven-pairs': 'only when the Seven Pairs house rule is on (off in this game)',
  'chicken-hand': 'a hand with no scoring pattern — below the minimum',
  'last-tile': 'winning on the very last tile of the wall',
  'kong-replacement': 'winning on the replacement tile drawn after a Kong',
};

export function getHongKongReference() {
  const { minimumFan, limitFan, allowSevenPairs } = DEFAULT_HONG_KONG_SCORING_OPTIONS;
  const T = HONG_KONG_TERMINOLOGY;
  const groups = GROUPS.map(([title, ids]) => ({
    title,
    rows: ids.map((id) => ({
      id,
      name: HONG_KONG_PATTERN_NAMES[id]?.name ?? id,
      native: HONG_KONG_PATTERN_NAMES[id]?.chinese ?? '',
      value: id === 'thirteen-orphans' || HONG_KONG_FAN[id] >= limitFan ? `${HONG_KONG_FAN[id]} fan (limit)` : `${HONG_KONG_FAN[id]} fan`,
      ...(NOTES[id] ? { note: NOTES[id] } : {}),
    })),
  }));
  const pointsRows = HONG_KONG_POINTS.map((pts, fan) => ({ id: `points-${fan}`, name: `${fan}${fan === HONG_KONG_POINTS.length - 1 ? '+' : ''} fan`, native: '', value: `${pts} pts` }))
    .filter((r, fan) => fan >= minimumFan);

  return {
    rulesetId: RULESET_ID.HONG_KONG,
    title: 'Hong Kong Mahjong',
    native: '廣東麻雀',
    summary: `The classic, fast-paced family game. Build four sets and a pair; your hand must be worth at least ${minimumFan} fan to win.`,
    facts: [
      { label: 'Players', value: '4 (or 3)' },
      { label: 'Tiles', value: '136 — no flowers' },
      { label: 'To win', value: `${minimumFan} fan minimum` },
      { label: 'Limit', value: `${limitFan} fan` },
    ],
    sections: [
      { id: 'tiles', title: 'The tiles', blocks: [
        { type: 'p', text: 'Three suits — Dots, Bamboo and Characters — numbered 1 to 9, four copies of each. Then the honours: four Winds (East, South, West, North) and three Dragons (Red, Green, White), also four of each. Hong Kong play here uses no flower tiles.' },
        { type: 'tiles', tiles: ['dots-1', 'dots-5', 'bamboo-1', 'bamboo-7', 'characters-3', 'characters-9'], caption: 'Suits: Dots, Bamboo, Characters' },
        { type: 'tiles', tiles: ['wind-east', 'wind-south', 'wind-west', 'wind-north', 'dragon-red', 'dragon-green', 'dragon-white'], caption: 'Honours: Winds and Dragons' },
      ] },
      { id: 'hand', title: 'A winning hand', blocks: [
        { type: 'p', text: `Fourteen tiles: four sets and a pair (the "${T.pair}"). A set is a ${T.chi} (three in a row in one suit), a ${T.pon} (three identical tiles) or a ${T.kong} (four identical tiles — it counts as one set, and you draw a replacement tile).` },
        { type: 'tiles', tiles: ['bamboo-2', 'bamboo-3', 'bamboo-4', 'dots-7', 'dots-7', 'dots-7', 'characters-5', 'characters-6', 'characters-7', 'dragon-red', 'dragon-red', 'dragon-red', 'wind-east', 'wind-east'], caption: 'Chow · Pung · Chow · Pung · Pair' },
        { type: 'p', text: `One special hand is also complete: Thirteen Orphans (one of each 1, 9, Wind and Dragon, plus a pair of any of them). Seven Pairs ${allowSevenPairs ? 'is' : 'is not'} allowed in this game.` },
        { type: 'p', text: `Being complete is not enough: the hand must score at least ${minimumFan} fan. A complete hand below that (a "${T.chickenHand}") cannot be declared.` },
      ] },
      { id: 'play', title: 'How a hand is played', blocks: [
        { type: 'list', items: [
          'Everyone is dealt 13 tiles; the dealer (East) draws a 14th and discards first. Play passes to the next seat each turn.',
          'On your turn draw one tile from the wall, then discard one. You may declare a concealed Kong, add a fourth tile to an exposed Pung, or win on the tile you drew (Self-drawn).',
          `Any player may claim a discard: to win, or for a ${T.pon} or ${T.kong}. Only the next player in turn may claim it for a ${T.chi}. Priority: a win beats a Pung or Kong, which beats a Chow; several players may win on the same discard.`,
          'A claimed set is placed face up (exposed); the claimer then discards. A Kong draws a replacement tile first.',
          'The hand ends when someone wins or the wall runs out (a draw game).',
        ] },
        { type: 'p', text: 'When another player’s discard is one you can call for a Chow, Pung or Kong, the game stops and asks you (Pass or Escape declines; Hint says what the computer would do). A winning discard is taken for you automatically. Your own draws offer Kong and Win.' },
      ] },
      { id: 'scoring', title: 'Scoring and payment', blocks: [
        { type: 'p', text: `Count the fan of every pattern your hand has (see the table below), capped at ${limitFan}. Fan converts to points on a doubling table.` },
        { type: 'list', items: [
          'Self-drawn win: every other player pays you the points.',
          'Win on a discard: the player who discarded it pays.',
          'Draw game: nobody pays.',
        ] },
      ] },
      { id: 'session', title: 'Dealer and rounds', blocks: [
        { type: 'p', text: 'The dealer keeps the deal after winning or after a draw game; otherwise the deal passes to the next seat. A game is one round: the deal goes round the table once (extra hands when the dealer repeats). The highest score at the end wins.' },
      ] },
    ],
    scoring: {
      title: 'Scoring patterns',
      intro: `Every pattern the engine scores, with its value. Minimum ${minimumFan} fan to win; ${limitFan} fan is the limit.`,
      unit: 'fan',
      groups: [...groups, { title: 'Points by fan', rows: pointsRows }],
    },
    glossary: [
      ['chi', 'A sequence of three in one suit; can be claimed only from the player before you.'],
      ['pon', 'Three identical tiles.'],
      ['kong', 'Four identical tiles; you draw a replacement.'],
      ['pair', 'The pair in a winning hand.'],
      ['win', 'Declaring a winning hand.'],
      ['selfDraw', 'Winning on a tile you drew yourself.'],
      ['fan', 'The unit of hand value.'],
      ['chickenHand', 'A complete hand with no scoring pattern.'],
      ['roundWind', 'The wind of the current round (East for a one-round game).'],
      ['seatWind', 'Your own wind; the dealer is East.'],
      ['exhaustiveDraw', 'The wall ran out with no winner.'],
    ].map(([key, meaning]) => ({ term: T[key], native: T.chinese[key] ?? '', meaning })),
  };
}

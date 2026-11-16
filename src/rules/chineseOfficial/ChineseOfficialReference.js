/**
 * ChineseOfficialReference.js — Task 114: the Chinese Official (MCR / Guobiao)
 * rules reference, as data (shape: see src/rules/hongkong/HongKongReference.js).
 * All 81 fans come from MCR_FANS (name, Chinese, points) with pinyin from
 * CO_FAN_NAMES and the "doesn't also count" lists from MCR_FANS[id].excludes,
 * grouped by value; the minimum, flower and payment rules from the engine's
 * defaults. Read by the UI only through main.js.
 */

import { MCR_FANS, FLOWER_POINTS } from './ChineseOfficialScoring.js';
import { CO_FAN_NAMES, CHINESE_OFFICIAL_TERMINOLOGY } from './ChineseOfficialTerminology.js';
import { DEFAULT_CHINESE_OFFICIAL_OPTIONS } from './ChineseOfficialRules.js';
import { RULESET_ID } from '../../utils/constants.js';

export function getChineseOfficialReference() {
  const o = DEFAULT_CHINESE_OFFICIAL_OPTIONS;
  const T = CHINESE_OFFICIAL_TERMINOLOGY;
  const fans = Object.values(MCR_FANS);
  const values = [...new Set(fans.map((f) => f.points))].sort((a, b) => b - a);
  const groups = values.map((pts) => ({
    title: `${pts} point${pts === 1 ? '' : 's'}`,
    rows: fans.filter((f) => f.points === pts).map((f) => ({
      id: f.id,
      name: f.name,
      native: [f.chinese, CO_FAN_NAMES[f.id]?.pinyin].filter(Boolean).join(' · '),
      value: `${f.points}`,
      ...(f.id === 'flower-tiles' ? { note: 'per flower or season; added after the minimum check' }
        : f.excludes.length ? { note: `not also: ${f.excludes.map((x) => MCR_FANS[x]?.name ?? x).join(', ')}` } : {}),
    })),
  }));

  return {
    rulesetId: RULESET_ID.CHINESE_OFFICIAL,
    title: 'Chinese Official',
    native: '国标麻将',
    summary: `The international competition rules (MCR): 81 scoring fans, and a hand must be worth at least ${o.minimumPoints} points — not counting flowers — to win.`,
    facts: [
      { label: 'Players', value: '4 (or 3)' },
      { label: 'Tiles', value: '144 — with 8 flowers' },
      { label: 'To win', value: `${o.minimumPoints} points minimum` },
      { label: 'Fans', value: `${fans.length}` },
    ],
    sections: [
      { id: 'tiles', title: 'The tiles', blocks: [
        { type: 'p', text: 'Dots, Bamboo and Characters 1–9, four Winds and three Dragons — four of each — plus eight bonus tiles: four Flowers and four Seasons.' },
        { type: 'tiles', tiles: ['dots-3', 'bamboo-8', 'characters-6', 'wind-south', 'dragon-green', 'flower-1', 'season-2'], caption: 'Suits, honours, a flower and a season' },
        { type: 'p', text: `A flower or season is never kept in the hand: when you draw one (or are dealt one) it is set aside and you draw a replacement. Each is worth ${FLOWER_POINTS} point, added AFTER the ${o.minimumPoints}-point minimum is checked.` },
      ] },
      { id: 'hand', title: 'A winning hand', blocks: [
        { type: 'p', text: `Four sets and a ${T.pair.toLowerCase()} — or one of the special shapes: Seven Pairs, Thirteen Orphans, Lesser or Greater Honors and Knitted Tiles, or a Knitted Straight. Unlike Hong Kong, the same four tiles may count as two pairs in Seven Pairs.` },
        { type: 'tiles', tiles: ['bamboo-1', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'bamboo-5', 'bamboo-6', 'bamboo-7', 'bamboo-8', 'bamboo-9', 'dots-2', 'dots-2', 'dots-2', 'characters-8', 'characters-8'], caption: 'Pure Straight (16 points)' },
        { type: 'p', text: `It must score at least ${o.minimumPoints} points from fans, flowers not included. A complete hand with no fan at all is a Chicken Hand (8 points).` },
      ] },
      { id: 'play', title: 'How a hand is played', blocks: [
        { type: 'list', items: [
          `${T.chi} only from the player before you; ${T.pon} and ${T.kong} from anyone; win on anyone’s discard. Only ONE player may win on a discard — the first in turn order.`,
          'There is no furiten: you may win on a discard even if you threw that tile away earlier.',
          'An added Kong (a fourth tile on an exposed Pung) can be robbed by a player who wins on that tile; a concealed Kong cannot.',
          'The deal passes to the next player after every hand.',
        ] },
        { type: 'p', text: 'When another player’s discard is one you can call for a Chow, Pung or Kong, the game stops and asks you (Pass or Escape declines; Hint says what the computer would do). A winning discard is taken for you automatically. Your own draws offer Kong and Win.' },
      ] },
      { id: 'scoring', title: 'Counting fans', blocks: [
        { type: 'list', items: [
          'Add up every fan the hand contains; arrange the tiles in the way that scores most.',
          'A fan that is implied by a bigger one is not counted again (the "not also" notes below) — for example Full Flush already implies No Honors.',
          'Each set may combine with the others only once when counting pair relationships (Pure Double Chow, Mixed Double Chow, Short Straight…).',
        ] },
      ] },
      { id: 'payment', title: 'Payment', blocks: [
        { type: 'list', items: [
          `Win on a discard: the discarder pays ${o.basePayment} + the hand’s points; every other player pays ${o.basePayment}.`,
          `Self-drawn win: every other player pays ${o.basePayment} + the hand’s points.`,
          `Draw game: nobody pays. Everyone starts at ${o.startingScore}.`,
        ] },
      ] },
    ],
    scoring: {
      title: `The ${fans.length} fans`,
      intro: `Grouped by value. Minimum ${o.minimumPoints} points (flowers excluded).`,
      unit: 'points',
      groups,
    },
    glossary: [
      ['chi', 'Three in a row in one suit.'],
      ['pon', 'Three identical tiles.'],
      ['kong', 'Four identical tiles; draw a replacement.'],
      ['pair', 'The pair in a winning hand.'],
      ['win', 'Declaring a winning hand.'],
      ['selfDraw', 'Winning on a tile you drew.'],
      ['minimumFan', 'A hand must score 8 points from fans to win.'],
      ['flower', 'A bonus tile, set aside when drawn.'],
      ['basePayment', 'What every loser pays the winner.'],
      ['chickenHand', 'A complete hand with no other fan.'],
      ['falseWin', 'Declaring a win that isn’t valid.'],
      ['replacementTile', 'The tile drawn after a flower or a Kong.'],
    ].map(([key, meaning]) => ({ term: T[key], native: [T.chinese[key], T.pinyin[key]].filter(Boolean).join(' · '), meaning })),
  };
}

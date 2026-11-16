/**
 * RiichiReference.js — Task 114: the Riichi rules reference, as data (shape:
 * see src/rules/hongkong/HongKongReference.js). Written for THIS game's
 * Riichi engine: every yaku and yakuman comes from RiichiYaku.js's tables
 * with its real han (closed / open), names from RiichiTerminology.js, and the
 * options that change the rules (red fives, open All Simples, double yakuman,
 * starting scores, honba / riichi stick / tenpai payments) from the engine's
 * own defaults. Read by the UI only through main.js.
 */

import { RIICHI_YAKU, RIICHI_YAKUMAN, DOUBLE_YAKUMAN } from './RiichiYaku.js';
import { RIICHI_YAKU_NAMES, RIICHI_TERMINOLOGY, RIICHI_LIMIT_NAMES, RIICHI_ABORTIVE_DRAW_NAMES } from './RiichiTerminology.js';
import { DEFAULT_RIICHI_OPTIONS } from './RiichiRules.js';
import { DEFAULT_SETTLEMENT_OPTIONS } from './RiichiScoring.js';
import { RULESET_ID } from '../../utils/constants.js';

const YAKU_GROUPS = [
  ['Concealed hand & riichi', ['riichi', 'double-riichi', 'ippatsu', 'menzen-tsumo', 'pinfu', 'iipeikou', 'ryanpeikou']],
  ['Sequences & suits', ['tanyao', 'ittsu', 'sanshoku-doujun', 'chanta', 'junchan', 'honitsu', 'chinitsu']],
  ['Triplets & honours', ['yakuhai-white', 'yakuhai-green', 'yakuhai-red', 'seat-wind', 'round-wind', 'toitoi', 'sanankou', 'sanshoku-doukou', 'sankantsu', 'shousangen', 'honroutou']],
  ['Special shape', ['chiitoitsu']],
  ['Luck & timing', ['haitei', 'houtei', 'rinshan', 'chankan']],
];

const LIMITS = [
  ['mangan', '5 han (or 4 han 40+ fu, 3 han 70+ fu)', 8000, 12000],
  ['haneman', '6–7 han', 12000, 18000],
  ['baiman', '8–10 han', 16000, 24000],
  ['sanbaiman', '11–12 han', 24000, 36000],
  ['yakuman', '13+ han, or a yakuman hand', 32000, 48000],
];

export function getRiichiReference() {
  const o = DEFAULT_RIICHI_OPTIONS;
  const s = DEFAULT_SETTLEMENT_OPTIONS;
  const T = RIICHI_TERMINOLOGY;
  const J = T.japanese;
  const nameOf = (id) => RIICHI_YAKU_NAMES[id] ?? { name: RIICHI_YAKU[id]?.name ?? RIICHI_YAKUMAN[id]?.name ?? id, romaji: '', japanese: '' };
  const hanText = ({ id, closedHan, openHan }) => {
    if (id === 'tanyao' && !o.openTanyao) return `${closedHan} han (closed only)`;
    if (!openHan) return `${closedHan} han (closed only)`;
    return openHan === closedHan ? `${closedHan} han` : `${closedHan} han (${openHan} open)`;
  };
  const yakuGroups = YAKU_GROUPS.map(([title, ids]) => ({
    title,
    rows: ids.map((id) => {
      const y = RIICHI_YAKU[id];
      const n = nameOf(id);
      return { id, name: n.name, native: [n.romaji, n.japanese].filter(Boolean).join(' · '), value: hanText(y) };
    }),
  }));
  const yakumanRows = Object.values(RIICHI_YAKUMAN).map((y) => {
    const n = nameOf(y.id);
    const double = o.doubleYakuman && DOUBLE_YAKUMAN.includes(y.id);
    return { id: y.id, name: n.name, native: [n.romaji, n.japanese].filter(Boolean).join(' · '), value: double ? 'Double yakuman' : 'Yakuman', ...(y.closedOnly ? { note: 'closed hand only' } : {}) };
  });
  const limitRows = LIMITS.map(([id, when, nonDealer, dealer]) => ({
    id: `limit-${id}`, name: RIICHI_LIMIT_NAMES[id].name, native: RIICHI_LIMIT_NAMES[id].japanese, value: `${nonDealer.toLocaleString('en-US')} / ${dealer.toLocaleString('en-US')}`, note: `${when}; non-dealer / dealer`,
  }));

  return {
    rulesetId: RULESET_ID.RIICHI,
    title: 'Riichi Mahjong',
    native: 'リーチ麻雀',
    summary: 'Japanese mahjong: every win needs at least one yaku (a scoring condition), and you can declare riichi when your closed hand is one tile from winning.',
    facts: [
      { label: 'Players', value: '4, or 3 (sanma)' },
      { label: 'Tiles', value: '136 (sanma: 108)' },
      { label: 'To win', value: 'at least 1 yaku' },
      { label: 'Start', value: '25,000 (sanma 35,000)' },
    ],
    sections: [
      { id: 'tiles', title: 'The tiles', blocks: [
        { type: 'p', text: 'Dots (pin), Bamboo (sou) and Characters (man) 1–9, four Winds and three Dragons, four copies of each — no flowers. Three-player games (sanma) remove the 2–8 of Characters.' },
        { type: 'tiles', tiles: ['dots-1', 'bamboo-5', 'characters-9', 'wind-east', 'dragon-white', 'dragon-green', 'dragon-red'], caption: 'Pin, sou, man, winds and dragons' },
        { type: 'p', text: o.redFives ? 'One red five per suit counts as an extra dora.' : 'Red fives are not used in this game.' },
      ] },
      { id: 'hand', title: 'A winning hand', blocks: [
        { type: 'p', text: `Four sets (${T.chi}, ${T.pon} or ${T.kong}) and a pair — or Seven Pairs (seven different pairs), or Thirteen Orphans. A complete hand also needs at least one yaku from the table below; dora alone are not a yaku.` },
        { type: 'tiles', tiles: ['characters-2', 'characters-3', 'characters-4', 'dots-4', 'dots-5', 'dots-6', 'bamboo-6', 'bamboo-7', 'bamboo-8', 'dots-6', 'dots-7', 'dots-8', 'bamboo-5', 'bamboo-5'], caption: 'All Simples (Tanyao): no 1s, 9s or honours' },
      ] },
      { id: 'riichi', title: 'Riichi', blocks: [
        { type: 'list', items: [
          `With a closed hand that is one tile from winning (${T.tenpai}), at least ${o.riichiMinimumScore.toLocaleString('en-US')} points and tiles left in the wall, you may declare riichi with your discard and put a ${s.riichiStickValue.toLocaleString('en-US')}-point stick on the table.`,
          'From then on your hand is locked: you discard every tile you draw unless it wins (a closed Kan is allowed only if it changes nothing about your wait).',
          'Riichi is itself a yaku (1 han), and winning within one go-around of declaring adds Ippatsu. Declaring on your very first discard is Double Riichi.',
          'The winner of the hand collects every riichi stick on the table.',
        ] },
      ] },
      { id: 'play', title: 'Calls, furiten and dora', blocks: [
        { type: 'list', items: [
          `${T.chi} only from the player on your left; ${T.pon} and ${T.kong} from anyone; ${T.ron} on anyone’s discard. ${o.kuikae ? 'You may not discard the tile you just called with (no swap-calling, kuikae).' : ''}`,
          `${T.furiten}: if any tile you are waiting on is in your own discards — or you passed it up since your last turn, or since declaring riichi — you can’t win by ${T.ron}, only by ${T.tsumo}.`,
          `The ${T.deadWall} holds 14 tiles. One ${T.doraIndicator} is turned face up: the NEXT tile in order is the dora, worth 1 han each in a winning hand. ${o.kanDora ? 'Every Kan turns over another indicator.' : ''} ${o.uraDora ? 'A riichi winner also counts the ura dora under the indicators.' : ''}`,
          'Calling any tile opens your hand: some yaku are then worth less or not available (see "closed only" below).',
        ] },
        { type: 'p', text: 'When another player’s discard is one you can call for a Chi, Pon or Kan, the game stops and asks you (Pass or Escape declines; Hint says what the computer would do) — never once you are in riichi. A winning discard (Ron) is taken for you automatically. Your own draws offer Tsumo, Kan, Riichi and (when allowed) the nine-terminals draw.' },
      ] },
      { id: 'scoring', title: 'Han, fu and payment', blocks: [
        { type: 'p', text: `Add the han of every yaku (plus dora). Below a limit hand, points come from han and fu (fu counts the hand’s sets and wait, rounded up to 10): base = fu × 2^(han + 2). From 5 han the limits below apply${o.kazoeYakuman ? '; 13+ han counts as a yakuman' : ''}.` },
        { type: 'list', items: [
          'Ron: the discarder pays it all — 4 × base for a non-dealer, 6 × base for the dealer.',
          'Tsumo: a non-dealer gets base from each non-dealer and 2 × base from the dealer; a dealer gets 2 × base from everyone.',
          `Each counter (${T.honba}) adds ${s.honbaRon} to a Ron and ${s.honbaTsumoEach} per payer to a Tsumo.`,
          `Exhaustive draw: players not ready pay ${s.tenpaiPool[4].toLocaleString('en-US')} in total (sanma ${s.tenpaiPool[3].toLocaleString('en-US')}) to those who are ready.${o.nagashiMangan ? ' A discard pile of only terminals and honours, never called from, pays a Mangan (Nagashi Mangan).' : ''}`,
        ] },
      ] },
      { id: 'session', title: 'Dealer, draws and the end', blocks: [
        { type: 'list', items: [
          'The dealer keeps the deal after winning, after being ready at a draw, or after an abortive draw; each time a counter is added.',
          `Abortive draws: ${Object.values(RIICHI_ABORTIVE_DRAW_NAMES).map((n) => n.name).join(', ')}.`,
          `A game is one round (East). ${o.bustEndsGame ? 'It ends early if a player drops below zero.' : ''} ${o.leftoverSticksToTop ? 'Riichi sticks still on the table go to the leader.' : ''}`,
        ] },
      ] },
    ],
    scoring: {
      title: 'Yaku, yakuman and limits',
      intro: 'Every yaku the engine knows, with its han closed (and open, when calls change it).',
      unit: 'han',
      groups: [...yakuGroups, { title: 'Yakuman', rows: yakumanRows }, { title: 'Limit hands', rows: limitRows }],
    },
    glossary: [
      ['riichi', 'Declaring a ready closed hand with a 1000-point stick.'],
      ['tsumo', 'Winning on a tile you drew.'],
      ['ron', 'Winning on another player’s discard.'],
      ['yaku', 'A scoring condition; every win needs one.'],
      ['han', 'Hand value from yaku and dora.'],
      ['fu', 'Minipoints from the hand’s sets and wait.'],
      ['dora', 'Bonus tiles worth 1 han each.'],
      ['tenpai', 'One tile away from winning.'],
      ['furiten', 'Waiting on a tile you discarded: no Ron.'],
      ['honba', 'A counter added after the dealer repeats or a draw.'],
      ['yakuman', 'The highest limit hand.'],
      ['deadWall', 'The 14 tiles kept aside for dora and replacements.'],
    ].map(([key, meaning]) => ({ term: T[key], native: J[key] ?? '', meaning })),
  };
}

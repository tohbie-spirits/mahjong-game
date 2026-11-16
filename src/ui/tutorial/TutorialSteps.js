/**
 * TutorialSteps.js — Task 113: the content of the interactive tutorial, and
 * the small pure helpers its exercises use.
 *
 * Each step: { id, title, paragraphs[], show?: [{ caption, groups: [[faceId]] }],
 *              exercise?: { id, kind, prompt, … } }
 *
 * Exercise kinds (TutorialScreen renders them):
 *   'name-tiles'  tap tiles to hear their names              done after `need` different tiles
 *   'pick-set'    pick tiles that form a set                 checked by `check(faceIds)`
 *   'complete'    which option completes these 13 tiles?    checked by the RULE ENGINE
 *   'discard'     which discard leaves the hand ready?       checked by the RULE ENGINE
 *                 (any ready discard is right; the one with the most waits is "best")
 *   'can-win'     may this complete hand win?               checked by the RULE ENGINE's scoring
 *   'choice'      a multiple-choice question                 `answer` index
 *
 * The rule-engine checks are NOT decided here: TutorialScreen is given
 * `checkHand(hand)` / `scoreHand(hand, context)` by main.js (the Hong Kong
 * engine), so the tutorial can never teach something the game disagrees
 * with. Tests run every exercise against the real engine.
 */

const SUITS = ['dots', 'bamboo', 'characters'];
const SUIT_NAME = { dots: 'Dots', bamboo: 'Bamboo', characters: 'Characters' };

/** All 34 face ids. */
export const ALL_FACE_IDS = Object.freeze([
  ...SUITS.flatMap((s) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${s}-${n}`)),
  'wind-east', 'wind-south', 'wind-west', 'wind-north', 'dragon-red', 'dragon-green', 'dragon-white',
]);

const parse = (id) => { const [suit, v] = String(id).split('-'); return { suit, n: Number(v) }; };
const isSuited = (id) => SUITS.includes(parse(id).suit);

/** Three tiles in a row in one suit (any order). */
export function isChow(ids) {
  if (!Array.isArray(ids) || ids.length !== 3 || !ids.every(isSuited)) return false;
  const p = ids.map(parse);
  if (!p.every((x) => x.suit === p[0].suit)) return false;
  const n = p.map((x) => x.n).sort((a, b) => a - b);
  return n[1] === n[0] + 1 && n[2] === n[1] + 1;
}

/** Three identical tiles. */
export function isPung(ids) {
  return Array.isArray(ids) && ids.length === 3 && ids.every((id) => id === ids[0]);
}

/** Why three tiles are NOT a Chow, in words (for feedback). */
export function chowProblem(ids) {
  if (!Array.isArray(ids) || ids.length !== 3) return 'Pick exactly three tiles.';
  if (!ids.every(isSuited)) return 'Winds and dragons can never form a Chow — only numbered suit tiles can.';
  const p = ids.map(parse);
  if (!p.every((x) => x.suit === p[0].suit)) return 'A Chow must be all one suit.';
  if (isPung(ids)) return 'Three identical tiles are a Pung, not a Chow.';
  return 'The numbers must follow on from each other, like 3-4-5.';
}

/** Face ids → tiles with fresh instance ids (Tile class injected so this file stays pure). */
export function makeTiles(TileClass, ids, tag = 'tut') {
  return ids.map((id, i) => TileClass.fromId(id, `${id}#${tag}${i}`));
}

/**
 * Every face that would complete `ids` (13 face ids), per `isCompleteIds(faceIds14)`;
 * a fifth copy is never considered.
 */
export function waitsOf(ids, isCompleteIds) {
  return ALL_FACE_IDS.filter((f) => ids.filter((x) => x === f).length < 4 && isCompleteIds([...ids, f]));
}

/** "1 or 4 of Bamboo", "East Wind", … */
export function describeFaces(faceIds, labelOf) {
  const names = faceIds.map(labelOf);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

export const SUIT_NAMES = SUIT_NAME;

/** A Chow in words: "3-4-5 of Dots". */
export function describeChow(ids) {
  const p = ids.map(parse).sort((a, b) => a.n - b.n);
  return `${p.map((x) => x.n).join('-')} of ${SUIT_NAME[p[0].suit] ?? p[0].suit}`;
}

/** The steps. Hong Kong rules (the simplest to start with); later steps point to the other rulesets. */
export const TUTORIAL_STEPS = Object.freeze([
  {
    id: 'welcome',
    title: 'Welcome to Mahjong',
    paragraphs: [
      'Mahjong is played with tiles instead of cards. Like rummy, you draw and discard to build a hand of sets — and the first player to complete one wins.',
      'A winning hand is usually four sets and a pair: 14 tiles. This short walkthrough teaches the basics with Hong Kong rules, then shows you the table. It takes about five minutes; you can leave any time and pick up where you stopped.',
    ],
    show: [{ caption: 'A winning hand: four sets and a pair', groups: [['bamboo-2', 'bamboo-3', 'bamboo-4'], ['dots-7', 'dots-7', 'dots-7'], ['characters-5', 'characters-6', 'characters-7'], ['dragon-red', 'dragon-red', 'dragon-red'], ['wind-east', 'wind-east']] }],
  },
  {
    id: 'tiles',
    title: 'The tiles',
    paragraphs: [
      'There are three suits numbered 1 to 9: Dots (circles), Bamboo (sticks) and Characters (the Chinese numerals 一 to 九 above 萬). Then the honour tiles: four Winds and three Dragons. Every tile has four identical copies.',
      'Chinese Official games also use eight flower tiles; they are set aside when drawn and simply add points.',
    ],
    exercise: {
      id: 'name-tiles', kind: 'name-tiles', need: 3,
      prompt: 'Tap three different tiles to see what they are called.',
      tiles: ['dots-1', 'dots-5', 'bamboo-1', 'bamboo-7', 'characters-2', 'characters-9', 'wind-east', 'wind-north', 'dragon-red', 'dragon-green', 'dragon-white'],
    },
  },
  {
    id: 'sets',
    title: 'Sets: Chow, Pung, Kong and the pair',
    paragraphs: [
      'A Chow is three tiles in a row in one suit, like 3-4-5 of Dots. A Pung is three identical tiles — any tile, honours included. A Kong is four identical tiles; it counts as one set, and you draw an extra tile to make up for it.',
      'The pair (two identical tiles) completes the hand. Honours can only be used in Pungs, Kongs and pairs, never in a Chow.',
    ],
    show: [{ caption: 'Chow · Pung · Kong · Pair', groups: [['dots-3', 'dots-4', 'dots-5'], ['bamboo-8', 'bamboo-8', 'bamboo-8'], ['dragon-green', 'dragon-green', 'dragon-green', 'dragon-green'], ['wind-west', 'wind-west']] }],
    exercise: {
      id: 'pick-chow', kind: 'pick-set', size: 3,
      prompt: 'Build a Chow: pick three tiles that form a sequence, then press Check.',
      tiles: ['dots-3', 'bamboo-4', 'wind-south', 'dots-7', 'dots-4', 'characters-5', 'dots-5', 'dots-4'],
      check: isChow,
      explain: chowProblem,
      answer: ['dots-3', 'dots-4', 'dots-5'],
    },
  },
  {
    id: 'winning-hand',
    title: 'Completing a hand',
    paragraphs: [
      'You are always one tile short of a winning hand: you hold 13 tiles, and the 14th — drawn from the wall or claimed from another player’s discard — completes it.',
      'When only one tile is missing you are "ready" (waiting). Here, three sets are finished and a fourth is nearly there.',
    ],
    exercise: {
      id: 'complete', kind: 'complete',
      prompt: 'Which tile completes this hand?',
      hand: ['bamboo-1', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'bamboo-5', 'bamboo-6', 'dots-9', 'dots-9', 'dots-9', 'wind-east', 'wind-east', 'characters-6', 'characters-7'],
      options: ['characters-6', 'wind-east', 'characters-8', 'bamboo-7', 'dots-8'],
    },
  },
  {
    id: 'turn',
    title: 'Your turn: draw, then discard',
    paragraphs: [
      'Each turn you draw a tile from the wall, then discard one face up in front of you. Play passes to the next player. The dealer (East) starts with 14 tiles and simply discards.',
      'A good discard is a tile that doesn’t help any set. Throw away the loner and keep the tiles that work together.',
    ],
    exercise: {
      id: 'discard', kind: 'discard',
      prompt: 'You just drew. Discard a tile that leaves your hand ready to win — ideally waiting on as many different tiles as possible.',
      hand: ['dots-1', 'dots-2', 'dots-3', 'dots-4', 'dots-5', 'dots-6', 'dots-7', 'dots-8', 'dots-9', 'bamboo-1', 'bamboo-1', 'bamboo-2', 'bamboo-3', 'wind-north'],
    },
  },
  {
    id: 'calls',
    title: 'Calling a discard',
    paragraphs: [
      'You can also take a tile someone else just discarded. Pung and Kong may be called from anyone; a Chow only from the player just before you. Calling a winning tile ("Mahjong!") beats every other call. A called set is placed face up and you then discard.',
      'At the table, when a discard is one you can call, the game stops and asks — choose the call, or Pass (Escape). Hint tells you what the computer would do. A winning discard is taken for you automatically.',
    ],
    exercise: {
      id: 'call-quiz', kind: 'choice',
      prompt: 'The player just before you discards 6 of Dots. You hold 4-5 of Dots and two 6s of Dots. What may you call?',
      choices: ['Only a Chow', 'Only a Pung', 'Either a Chow or a Pung', 'Nothing'],
      answer: 2,
      explanation: '4-5 + 6 makes a Chow (allowed: the tile comes from the player before you), and your two 6s + 6 make a Pung.',
    },
  },
  {
    id: 'scoring',
    title: 'Scoring: is it worth enough?',
    paragraphs: [
      'A complete hand also has to be worth enough. In Hong Kong rules you count fan (patterns like All Pungs, a Pung of dragons, one suit only) and need at least 3 to win. Riichi needs at least one yaku; Chinese Official needs 8 points.',
      'The game counts for you and only offers Win when your hand qualifies; the Rule Reference lists every pattern.',
    ],
    exercise: {
      id: 'can-win', kind: 'can-win',
      prompt: 'This hand is complete — you won it on a discard. May you declare it in Hong Kong rules?',
      hand: ['bamboo-1', 'bamboo-2', 'bamboo-3', 'dots-4', 'dots-5', 'dots-6', 'characters-7', 'characters-8', 'characters-9', 'bamboo-2', 'bamboo-3', 'bamboo-4', 'characters-5', 'characters-5'],
      context: { winType: 'discard', seatWind: 'south', roundWind: 'east' },
    },
  },
  {
    id: 'table',
    title: 'At the table',
    paragraphs: [
      'Your hand is at the bottom; the opponents’ hidden tiles sit at the other three sides, and every player’s discards are in the middle around the wall counter (tiles left to draw).',
    ],
    list: [
      'Click a tile in your hand (or Tab to it and press Enter) to discard it. The tile you just drew sits at the right end.',
      'Point at any tile to light up its other copies on the table; your own tiles show how many are held, seen and still left.',
      'Greyed-out tiles can’t be discarded right now (for example after declaring riichi) — click one to see why.',
      'Pause (top left) lets you resume, read the rules, restart or quit. Your game is saved as you play.',
      'The buttons at the top right switch sound (M) and fullscreen (F). Volumes are in Settings.',
    ],
  },
  {
    id: 'done',
    title: 'You’re ready',
    paragraphs: [
      'That’s everything you need for a first game. Hong Kong rules against Basic opponents are a gentle start; the Rule Reference covers all three rulesets whenever you need it.',
    ],
    finish: true,
  },
]);

/**
 * constants.js
 *
 * Shared enums and fixed values used by core, rules, AI, persistence and UI.
 *
 * REBUILT (after Task 77): the original Task 7 file was lost. This version was
 * reconstructed from the project plan and from every place the surviving
 * files use these names (main.js, GameScreen.js, the persistence layer, the
 * leaderboard/statistics screens and tests). Values are plain strings so
 * they serialise cleanly into save snapshots and test fixtures (e.g.
 * 'hong_kong', 'basic').
 *
 * Keep this file free of UI copy beyond short labels: core modules import it.
 */

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** Tile suits. The three numbered suits plus honour and bonus groups. */
export const SUIT = Object.freeze({
  DOTS: 'dots',
  BAMBOO: 'bamboo',
  CHARACTERS: 'characters',
  WIND: 'wind',
  DRAGON: 'dragon',
  FLOWER: 'flower',
  SEASON: 'season',
});

/** Numbered suits, in conventional sort order. */
export const NUMBERED_SUITS = Object.freeze([SUIT.DOTS, SUIT.BAMBOO, SUIT.CHARACTERS]);

/** Display labels for suits ("5 of Dots"). */
export const SUIT_LABEL = Object.freeze({
  [SUIT.DOTS]: 'Dots',
  [SUIT.BAMBOO]: 'Bamboo',
  [SUIT.CHARACTERS]: 'Characters',
  [SUIT.WIND]: 'Wind',
  [SUIT.DRAGON]: 'Dragon',
  [SUIT.FLOWER]: 'Flower',
  [SUIT.SEASON]: 'Season',
});

/**
 * Winds as frozen objects (seat winds and the round wind are stored as these
 * objects; snapshots store `wind.id`). `order` is the turn/rotation order.
 */
export const WIND = Object.freeze({
  EAST: Object.freeze({ id: 'east', label: 'East', char: '東', order: 0 }),
  SOUTH: Object.freeze({ id: 'south', label: 'South', char: '南', order: 1 }),
  WEST: Object.freeze({ id: 'west', label: 'West', char: '西', order: 2 }),
  NORTH: Object.freeze({ id: 'north', label: 'North', char: '北', order: 3 }),
});

/** Winds in rotation order (East → South → West → North). */
export const WIND_ORDER = Object.freeze([WIND.EAST, WIND.SOUTH, WIND.WEST, WIND.NORTH]);

/** Dragon values. */
export const DRAGON = Object.freeze({
  RED: 'red',
  GREEN: 'green',
  WHITE: 'white',
});

/** Dragons in conventional sort order. */
export const DRAGON_ORDER = Object.freeze([DRAGON.RED, DRAGON.GREEN, DRAGON.WHITE]);

/** Display labels for dragons. */
export const DRAGON_LABEL = Object.freeze({
  [DRAGON.RED]: 'Red Dragon',
  [DRAGON.GREEN]: 'Green Dragon',
  [DRAGON.WHITE]: 'White Dragon',
});

/** Copies of each standard tile face in a set. */
export const COPIES_PER_TILE = 4;

/** Concealed tiles in a waiting hand with no melds. */
export const HAND_SIZE = 13;

/** Size of the dead wall in rulesets that reserve one (Riichi). 0 = none. */
export const DEAD_WALL_SIZE = 14;

// ---------------------------------------------------------------------------
// Actions, melds, turns
// ---------------------------------------------------------------------------

/** Action types produced by RuleEngine#getLegalActions() and chosen by players/AI. */
export const ACTION_TYPE = Object.freeze({
  DRAW: 'draw',
  DISCARD: 'discard',
  CHI: 'chi',
  PON: 'pon',
  KONG: 'kong',
  WIN: 'win',
  PASS: 'pass',
  // Task 81 (Riichi special calls; other rulesets never offer these)
  RIICHI: 'riichi',               // declare riichi with a discard
  ABORTIVE_DRAW: 'abortive-draw', // e.g. nine terminals/honours on the first draw
});

/** Meld types (same strings as the claim actions that create them). */
export const MELD_TYPE = Object.freeze({
  CHI: 'chi',
  PON: 'pon',
  KONG: 'kong',
});

/** How a Kong was formed. */
export const KONG_TYPE = Object.freeze({
  EXPOSED: 'exposed',     // claimed from another player's discard
  CONCEALED: 'concealed', // four drawn tiles declared on own turn
  ADDED: 'added',         // fourth tile added to an existing exposed Pon
});

/** Win types recorded on winner records. */
export const WIN_SOURCE = Object.freeze({
  SELF: 'self',       // Tsumo — drew the winning tile
  DISCARD: 'discard', // Ron — claimed another player's discard
});

/** Turn phases tracked by TurnManager. */
export const TURN_PHASE = Object.freeze({
  AWAITING_DRAW: 'awaiting-draw',
  AWAITING_DISCARD: 'awaiting-discard',
  ROUND_OVER: 'round-over',
});

/** Why a round ended. */
export const ROUND_END_REASON = Object.freeze({
  WIN: 'win',
  WALL_EXHAUSTED: 'wall-exhausted',
  ABORTIVE: 'abortive-draw', // Task 89 (Riichi): nine terminals, four winds, four riichi, four kans, triple ron
});

// ---------------------------------------------------------------------------
// Players, sessions, rulesets, AI
// ---------------------------------------------------------------------------

/** Who controls a seat. */
export const SEAT_KIND = Object.freeze({
  HUMAN: 'human',
  AI: 'ai',
});

/** Supported player counts. */
export const PLAYER_COUNT = Object.freeze({
  THREE: 3,
  FOUR: 4,
});

/** Ruleset identifiers (also stored in saves and leaderboard entries). */
export const RULESET_ID = Object.freeze({
  RIICHI: 'riichi',
  HONG_KONG: 'hong_kong',
  CHINESE_OFFICIAL: 'chinese_official',
});

/** Ruleset display names. */
export const RULESET_LABEL = Object.freeze({
  [RULESET_ID.RIICHI]: 'Riichi Mahjong',
  [RULESET_ID.HONG_KONG]: 'Hong Kong Mahjong',
  [RULESET_ID.CHINESE_OFFICIAL]: 'Chinese Official',
});

/** AI difficulty tiers — also the AIStrategy strategyId values. */
export const AI_DIFFICULTY = Object.freeze({
  BASIC: 'basic',
  ADVANCED: 'advanced',
});

/** AI difficulty display names. */
export const AI_DIFFICULTY_LABEL = Object.freeze({
  [AI_DIFFICULTY.BASIC]: 'Basic',
  [AI_DIFFICULTY.ADVANCED]: 'Advanced',
});

/** Score each player starts a session with. */
export const STARTING_SCORE = 0;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Colour themes. */
export const THEME = Object.freeze({
  DARK: 'dark',
  LIGHT: 'light',
});
